import type {
  FiveHourWindow,
  SessionUsageContribution,
  SessionUsageContributionInput,
  SessionUsageLedger,
  SessionUsageRow,
} from '../../../core/types';

type ContributionSource = SessionUsageContribution['source'];

function rowKey(providerId: string, modelId: string, effort?: string): string {
  return `${providerId}\u0000${modelId}\u0000${effort ?? ''}`;
}

function contributionId(turnId: string, providerId: string, modelId: string, effort?: string): string {
  return `${turnId}\u0000${providerId}\u0000${modelId}\u0000${effort ?? ''}`;
}

function recomputeRowTotals(row: SessionUsageRow): void {
  let inputTokens = 0;
  let outputTokens = 0;
  let reasoningTokens = 0;
  let cachedInputTokens: number | undefined;

  for (const c of row.contributions) {
    inputTokens += c.inputTokens;
    outputTokens += c.outputTokens;
    reasoningTokens += c.reasoningTokens;
    if (c.cachedInputTokens !== undefined) {
      cachedInputTokens = (cachedInputTokens ?? 0) + c.cachedInputTokens;
    }
  }

  row.inputTokens = inputTokens;
  row.outputTokens = outputTokens;
  row.reasoningTokens = reasoningTokens;
  row.cachedInputTokens = cachedInputTokens;
  row.totalTokens = inputTokens + outputTokens + reasoningTokens;
}

/**
 * Provider-neutral cumulative session usage ledger service.
 *
 * Responsibilities:
 * - normalize provider contributions into ledger rows (key: providerId + modelId + effort)
 * - idempotent by contribution id (duplicate ignored)
 * - replacement by turnId (same turn replaces prior contribution)
 * - cumulative arithmetic (totals recomputed from contributions, never stored stale)
 * - five-hour rolling window snapshot updates
 * - sorted display rows
 */
export class SessionUsageService {
  /** Create an empty ledger for a new conversation. */
  createLedger(conversationId: string): SessionUsageLedger {
    return { version: 1, conversationId, rows: [] };
  }

  /**
   * Normalize a provider contribution into a ledger row update.
   * Row key: providerId + modelId + effort.
   * Idempotent by contribution id — duplicate ignored.
   * Replacement: same turnId replaces prior contribution for that turn.
   */
  applyContribution(
    ledger: SessionUsageLedger,
    contribution: SessionUsageContributionInput,
    source: ContributionSource = 'provider-turn',
  ): { changed: boolean; ledger: SessionUsageLedger } {
    const key = rowKey(contribution.providerId, contribution.modelId, contribution.effort);
    const cId = contributionId(contribution.turnId, contribution.providerId, contribution.modelId, contribution.effort);

    const rows = ledger.rows.map(r => ({
      ...r,
      contributions: r.contributions.map(c => ({ ...c })),
    }));

    let row = rows.find(r => rowKey(r.providerId, r.modelId, r.effort) === key);

    if (!row) {
      row = {
        providerId: contribution.providerId,
        modelId: contribution.modelId,
        ...(contribution.displayName ? { displayName: contribution.displayName } : {}),
        ...(contribution.effort ? { effort: contribution.effort } : {}),
        inputTokens: 0,
        outputTokens: 0,
        reasoningTokens: 0,
        totalTokens: 0,
        contributions: [],
      };
      rows.push(row);
    }

    const existingIdx = row.contributions.findIndex(c => c.id === cId);
    const existingByTurn = row.contributions.findIndex(c => c.turnId === contribution.turnId);

    const stored: SessionUsageContribution = {
      id: cId,
      source,
      turnId: contribution.turnId,
      inputTokens: contribution.inputTokens,
      outputTokens: contribution.outputTokens,
      reasoningTokens: contribution.reasoningTokens,
      ...(contribution.cachedInputTokens !== undefined && contribution.cachedInputTokens > 0
        ? { cachedInputTokens: contribution.cachedInputTokens }
        : {}),
      completedAt: contribution.completedAt,
    };

    if (existingIdx >= 0) {
      if (
        row.contributions[existingIdx].inputTokens === stored.inputTokens &&
        row.contributions[existingIdx].outputTokens === stored.outputTokens &&
        row.contributions[existingIdx].reasoningTokens === stored.reasoningTokens
      ) {
        return { changed: false, ledger };
      }
      row.contributions[existingIdx] = stored;
    } else if (existingByTurn >= 0) {
      row.contributions[existingByTurn] = stored;
    } else {
      row.contributions.push(stored);
    }

    recomputeRowTotals(row);

    return { changed: true, ledger: { ...ledger, rows } };
  }

  /** Update the five-hour window snapshot (full replace — the struct is complete). */
  applyFiveHourWindow(
    ledger: SessionUsageLedger,
    window: FiveHourWindow,
  ): { changed: boolean; ledger: SessionUsageLedger } {
    if (
      ledger.fiveHourWindow &&
      ledger.fiveHourWindow.usedPercent === window.usedPercent &&
      ledger.fiveHourWindow.providerId === window.providerId
    ) {
      return { changed: false, ledger };
    }
    return { changed: true, ledger: { ...ledger, fiveHourWindow: window } };
  }

  /**
   * Produce sorted display rows per spec "Sorting":
   * 1. orchestrator/current conversation provider rows first
   * 2. delegated provider rows next
   * 3. first-seen order within each class
   */
  getDisplayRows(ledger: SessionUsageLedger, orchestratorProviderId: string): SessionUsageRow[] {
    const orchestrator: SessionUsageRow[] = [];
    const delegated: SessionUsageRow[] = [];

    for (const row of ledger.rows) {
      const isOrchestrator = row.providerId === orchestratorProviderId &&
        row.contributions.some(c => c.source === 'provider-turn');

      if (isOrchestrator) {
        orchestrator.push(row);
      } else {
        delegated.push(row);
      }
    }

    return [...orchestrator, ...delegated];
  }
}
