import type { SessionUsageContributionInput, SessionUsageLedger } from '../../../core/types';

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function getNum(v: unknown): number {
  return typeof v === 'number' ? v : 0;
}

/**
 * Scan a Codex transcript for `token_count` event_msg records and build a
 * session usage ledger from cumulative `total_token_usage` deltas.
 *
 * Returns null when the transcript has no token_count events (legacy or
 * incomplete transcripts). The caller should keep any persisted ledger in
 * that case.
 */
export function reconstructCodexSessionUsage(
  content: string,
  conversationId: string,
): SessionUsageLedger | null {
  const lines = content.split('\n');
  let previous: {
    inputTokens: number;
    outputTokens: number;
    reasoningTokens: number;
    cachedInputTokens: number;
    totalTokens: number;
  } | null = null;

  const contributions: SessionUsageContributionInput[] = [];
  let turnCounter = 0;

  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed) continue;

    let record: unknown;
    try {
      record = JSON.parse(trimmed);
    } catch {
      continue;
    }

    if (!isRecord(record)) continue;
    if (record.type !== 'event_msg') continue;

    const payload = record.payload;
    if (!isRecord(payload)) continue;
    if (payload.type !== 'token_count') continue;

    const info = isRecord(payload.info) ? payload.info : {};
    const totalTokenUsage = isRecord(info.total_token_usage) ? info.total_token_usage : {};
    const cumulative = {
      inputTokens: getNum(totalTokenUsage.input_tokens),
      outputTokens: getNum(totalTokenUsage.output_tokens),
      reasoningTokens: getNum(totalTokenUsage.reasoning_tokens),
      cachedInputTokens: getNum(totalTokenUsage.cached_input_tokens),
      totalTokens: getNum(totalTokenUsage.total_tokens),
    };

    if (cumulative.totalTokens <= 0) continue;

    const prev = previous;
    const delta = {
      inputTokens: cumulative.inputTokens - (prev?.inputTokens ?? 0),
      outputTokens: cumulative.outputTokens - (prev?.outputTokens ?? 0),
      reasoningTokens: cumulative.reasoningTokens - (prev?.reasoningTokens ?? 0),
      cachedInputTokens: cumulative.cachedInputTokens - (prev?.cachedInputTokens ?? 0),
      totalTokens: cumulative.totalTokens - (prev?.totalTokens ?? 0),
    };

    if (delta.totalTokens <= 0 && delta.inputTokens <= 0 && delta.outputTokens <= 0) {
      continue;
    }

    previous = cumulative;
    turnCounter += 1;

    contributions.push({
      providerId: 'codex',
      modelId: 'codex',
      turnId: `codex-reload-${turnCounter}`,
      inputTokens: delta.inputTokens,
      outputTokens: delta.outputTokens,
      reasoningTokens: delta.reasoningTokens,
      ...(delta.cachedInputTokens > 0 ? { cachedInputTokens: delta.cachedInputTokens } : {}),
      completedAt: Date.now(),
    });
  }

  if (contributions.length === 0) return null;

  const ledger: SessionUsageLedger = { version: 1, conversationId, rows: [] };
  const rowMap = new Map<string, {
    providerId: string;
    modelId: string;
    inputTokens: number;
    outputTokens: number;
    reasoningTokens: number;
    cachedInputTokens: number;
    totalTokens: number;
    contributions: SessionUsageContributionInput[];
  }>();

  for (const c of contributions) {
    const key = `${c.providerId}\u0000${c.modelId}\u0000${c.effort ?? ''}`;
    let row = rowMap.get(key);
    if (!row) {
      row = {
        providerId: c.providerId,
        modelId: c.modelId,
        inputTokens: 0,
        outputTokens: 0,
        reasoningTokens: 0,
        cachedInputTokens: 0,
        totalTokens: 0,
        contributions: [],
      };
      rowMap.set(key, row);
    }
    row.inputTokens += c.inputTokens;
    row.outputTokens += c.outputTokens;
    row.reasoningTokens += c.reasoningTokens;
    if (c.cachedInputTokens) row.cachedInputTokens += c.cachedInputTokens;
    row.totalTokens = row.inputTokens + row.outputTokens + row.reasoningTokens;
    row.contributions.push(c);
  }

  ledger.rows = Array.from(rowMap.values()).map(r => ({
    providerId: r.providerId,
    modelId: r.modelId,
    inputTokens: r.inputTokens,
    outputTokens: r.outputTokens,
    reasoningTokens: r.reasoningTokens,
    ...(r.cachedInputTokens > 0 ? { cachedInputTokens: r.cachedInputTokens } : {}),
    totalTokens: r.totalTokens,
    contributions: r.contributions.map(c => ({
      id: `${c.turnId}\u0000${c.providerId}\u0000${c.modelId}\u0000${c.effort ?? ''}`,
      source: 'provider-turn' as const,
      turnId: c.turnId,
      inputTokens: c.inputTokens,
      outputTokens: c.outputTokens,
      reasoningTokens: c.reasoningTokens,
      ...(c.cachedInputTokens ? { cachedInputTokens: c.cachedInputTokens } : {}),
      completedAt: c.completedAt,
    })),
  }));

  return ledger;
}
