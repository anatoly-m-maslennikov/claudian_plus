export interface ParsedWorkerUsageMarker {
  version: 1;
  workerSessionId: string;
  providerId: string;
  modelId: string;
  effort?: string;
  lane?: string;
  phase?: string;
  inputTokens: number;
  outputTokens: number;
  reasoningTokens: number;
  cachedInputTokens?: number;
  totalTokens: number;
}

export const CLAUDIAN_USAGE_EVENT_PREFIX = 'CLAUDIAN_USAGE_EVENT=';

/**
 * Scans tool result content for CLAUDIAN_USAGE_EVENT= markers.
 * Returns all valid markers found (a worker run may emit one marker;
 * a multi-phase worker may emit multiple).
 *
 * Malformed markers are silently ignored — never throw.
 */
export function parseWorkerUsageMarkers(
  toolResultContent: string,
): ParsedWorkerUsageMarker[] {
  const markers: ParsedWorkerUsageMarker[] = [];
  const lines = toolResultContent.split('\n');

  for (const line of lines) {
    const trimmed = line.trim();
    const prefixIdx = trimmed.indexOf(CLAUDIAN_USAGE_EVENT_PREFIX);
    if (prefixIdx < 0) continue;

    const jsonPart = trimmed.slice(prefixIdx + CLAUDIAN_USAGE_EVENT_PREFIX.length);
    let parsed: unknown;
    try {
      parsed = JSON.parse(jsonPart);
    } catch {
      continue;
    }

    if (!isValidMarker(parsed)) continue;

    const m = parsed as Record<string, unknown>;
    const inputTokens = m.inputTokens as number;
    const outputTokens = m.outputTokens as number;
    const reasoningTokens = m.reasoningTokens as number;
    const computedTotal = inputTokens + outputTokens + reasoningTokens;

    markers.push({
      version: 1,
      workerSessionId: m.workerSessionId as string,
      providerId: m.providerId as string,
      modelId: m.modelId as string,
      ...(typeof m.effort === 'string' && m.effort ? { effort: m.effort } : {}),
      ...(typeof m.lane === 'string' && m.lane ? { lane: m.lane } : {}),
      ...(typeof m.phase === 'string' && m.phase ? { phase: m.phase } : {}),
      inputTokens,
      outputTokens,
      reasoningTokens,
      ...(typeof m.cachedInputTokens === 'number' && m.cachedInputTokens > 0
        ? { cachedInputTokens: m.cachedInputTokens }
        : {}),
      totalTokens: computedTotal,
    });
  }

  return markers;
}

/**
 * Strips CLAUDIAN_USAGE_EVENT= lines from tool result content so the
 * marker is never rendered as assistant content or sent back as prompt.
 */
export function stripWorkerUsageMarkers(
  toolResultContent: string,
): string {
  const lines = toolResultContent.split('\n');
  const filtered = lines.filter(line => {
    const trimmed = line.trim();
    return trimmed.indexOf(CLAUDIAN_USAGE_EVENT_PREFIX) < 0;
  });
  return filtered.join('\n');
}

function isValidMarker(value: unknown): value is Record<string, unknown> {
  if (typeof value !== 'object' || value === null) return false;
  const m = value as Record<string, unknown>;
  if (m.version !== 1) return false;
  if (typeof m.workerSessionId !== 'string' || !m.workerSessionId) return false;
  if (typeof m.providerId !== 'string' || !m.providerId) return false;
  if (typeof m.modelId !== 'string' || !m.modelId) return false;
  if (typeof m.inputTokens !== 'number' || m.inputTokens < 0) return false;
  if (typeof m.outputTokens !== 'number' || m.outputTokens < 0) return false;
  if (typeof m.reasoningTokens !== 'number' || m.reasoningTokens < 0) return false;
  return true;
}
