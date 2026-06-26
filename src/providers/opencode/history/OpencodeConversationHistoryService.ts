import type { ProviderConversationHistoryService } from '../../../core/providers/types';
import type { Conversation, SessionUsageContributionInput, SessionUsageLedger } from '../../../core/types';
import { resolveExistingOpencodeDatabasePath } from '../runtime/OpencodePaths';
import { getOpencodeState, type OpencodeProviderState } from '../types';
import {
  isOpencodeSessionHydrationDiagnosticMessage,
  loadOpencodeSessionMessages,
} from './OpencodeHistoryStore';
import { loadOpencodeSessionUsageAggregation } from './OpencodeSqliteReader';

export class OpencodeConversationHistoryService implements ProviderConversationHistoryService {
  private hydratedKeys = new Map<string, string>();

  async hydrateConversationHistory(
    conversation: Conversation,
    _vaultPath: string | null,
  ): Promise<void> {
    const sessionId = conversation.sessionId;
    if (!sessionId) {
      this.hydratedKeys.delete(conversation.id);
      return;
    }

    const state = getOpencodeState(conversation.providerState);
    const hydrationKey = `${sessionId}::${state.databasePath ?? ''}`;
    if (
      conversation.messages.length > 0
      && this.hydratedKeys.get(conversation.id) === hydrationKey
    ) {
      return;
    }

    const messages = await loadOpencodeSessionMessages(sessionId, state);
    if (messages.length === 0) {
      this.hydratedKeys.delete(conversation.id);
      return;
    }

    conversation.messages = messages;
    if (
      messages.length === 1
      && isOpencodeSessionHydrationDiagnosticMessage(messages[0])
    ) {
      this.hydratedKeys.delete(conversation.id);
      return;
    }

    // Reconcile session usage ledger from SQLite if not already persisted
    if (!conversation.sessionUsage) {
      const databasePath = resolveExistingOpencodeDatabasePath(state.databasePath);
      if (databasePath && databasePath !== ':memory:') {
        try {
          const aggregation = await loadOpencodeSessionUsageAggregation(databasePath, sessionId);
          if (aggregation && aggregation.length > 0) {
            conversation.sessionUsage = this.buildLedgerFromAggregation(conversation.id, aggregation);
          }
        } catch {
          // SQLite read failure — leave ledger absent (no error)
        }
      }
    }

    this.hydratedKeys.set(conversation.id, hydrationKey);
  }

  private buildLedgerFromAggregation(
    conversationId: string,
    aggregation: { modelId: string; effort?: string; inputTokens: number; outputTokens: number; reasoningTokens: number; cachedInputTokens?: number; totalTokens: number; contributionCount: number }[],
  ): SessionUsageLedger {
    const ledger: SessionUsageLedger = { version: 1, conversationId, rows: [] };
    for (const agg of aggregation) {
      const contribution: SessionUsageContributionInput = {
        providerId: 'opencode',
        modelId: agg.modelId,
        ...(agg.effort ? { effort: agg.effort } : {}),
        turnId: `opencode-reload-${agg.modelId}`,
        inputTokens: agg.inputTokens,
        outputTokens: agg.outputTokens,
        reasoningTokens: agg.reasoningTokens,
        ...(agg.cachedInputTokens && agg.cachedInputTokens > 0 ? { cachedInputTokens: agg.cachedInputTokens } : {}),
        completedAt: Date.now(),
      };
      ledger.rows.push({
        providerId: 'opencode',
        modelId: agg.modelId,
        ...(agg.effort ? { effort: agg.effort } : {}),
        inputTokens: agg.inputTokens,
        outputTokens: agg.outputTokens,
        reasoningTokens: agg.reasoningTokens,
        ...(agg.cachedInputTokens && agg.cachedInputTokens > 0 ? { cachedInputTokens: agg.cachedInputTokens } : {}),
        totalTokens: agg.inputTokens + agg.outputTokens + agg.reasoningTokens,
        contributions: [{
          id: `${contribution.turnId}\u0000opencode\u0000${contribution.modelId}\u0000${contribution.effort ?? ''}`,
          source: 'provider-turn',
          turnId: contribution.turnId,
          inputTokens: contribution.inputTokens,
          outputTokens: contribution.outputTokens,
          reasoningTokens: contribution.reasoningTokens,
          ...(contribution.cachedInputTokens ? { cachedInputTokens: contribution.cachedInputTokens } : {}),
          completedAt: contribution.completedAt,
        }],
      });
    }
    return ledger;
  }

  async deleteConversationSession(
    _conversation: Conversation,
    _vaultPath: string | null,
  ): Promise<void> {
    // Never mutate OpenCode native history.
  }

  resolveSessionIdForConversation(conversation: Conversation | null): string | null {
    return conversation?.sessionId ?? null;
  }

  isPendingForkConversation(_conversation: Conversation): boolean {
    return false;
  }

  buildForkProviderState(
    _sourceSessionId: string,
    _resumeAt: string,
    _sourceProviderState?: Record<string, unknown>,
  ): Record<string, unknown> {
    return {};
  }

  buildPersistedProviderState(
    conversation: Conversation,
  ): Record<string, unknown> | undefined {
    const state = getOpencodeState(conversation.providerState);
    const providerState: OpencodeProviderState = {
      ...(state.databasePath ? { databasePath: state.databasePath } : {}),
    };

    return Object.keys(providerState).length > 0
      ? providerState as Record<string, unknown>
      : undefined;
  }
}
