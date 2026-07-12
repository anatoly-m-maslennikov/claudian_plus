# Feature 2 — Phase 2: Native OpenCode Ingestion

Reference spec: `Your Harness/1 - Spec/feature-2-usage-footer-spec.md`
Depends on: Phase 1 (core ledger, `SessionUsageService`, rendering, persistence)

## Summary

Emit `session_usage` from the OpenCode ACP runtime using
`AcpPromptResponse.usage`, and reconstruct the ledger from OpenCode SQLite on
reload. No ledger/UI changes — the Phase 1 contract covers everything.

## Files to Change

### 1. `src/providers/opencode/runtime/OpencodeChatRuntime.ts` — emit `session_usage`

In the `prompt()` `.then()` handler (line 408), after storing
`this.promptUsage` (line 412) and before pushing the context `usage` chunk
(line 420), build and emit a `session_usage` chunk:

```ts
const promptPromise = this.connection.prompt({
  // ...
}).then((response) => {
  if (response.userMessageId) {
    this.currentTurnMetadata.userMessageId = response.userMessageId;
  }
  this.promptUsage = response.usage ?? null;

  // NEW: emit session_usage contribution from ACP prompt usage
  if (this.promptUsage) {
    const contribution = this.buildSessionUsageContribution(this.promptUsage);
    if (contribution) {
      activeTurn.queue.push({
        type: 'session_usage',
        contribution,
        sessionId,
      });
    }
  }

  // existing context usage emission (unchanged)
  const usage = buildAcpUsageInfo({ ... });
  if (usage) {
    activeTurn.queue.push({ sessionId, type: 'usage', usage });
  }

  activeTurn.queue.push({ type: 'done' });
  activeTurn.queue.close();
}).catch((error) => {
  // ...
});
```

**Order:** `session_usage` is pushed before context `usage` and `done`. Since
`StreamController` handles each chunk independently and the ledger is updated
before the footer is upserted, ordering between `session_usage` and context
`usage` is not critical — but `session_usage` must precede `done` (the query
generator exits when `done` is consumed).

Add the contribution builder:

```ts
private buildSessionUsageContribution(
  usage: AcpUsage,
): SessionUsageContributionInput | null {
  const modelId = this.currentSessionModelId;
  if (!modelId) return null;

  const providerSettings = this.getProviderSettings();
  const effort = typeof providerSettings.effortLevel === 'string'
    ? providerSettings.effortLevel.trim()
    : undefined;

  return {
    providerId: 'opencode',
    modelId,
    displayName: this.resolveModelDisplayName(modelId),
    ...(effort && effort !== 'default' ? { effort } : {}),
    turnId: this.sessionId ?? `opencode-turn-${Date.now()}`,
    inputTokens: usage.inputTokens ?? 0,
    outputTokens: usage.outputTokens ?? 0,
    reasoningTokens: usage.thoughtTokens ?? 0,
    ...(usage.cachedReadTokens && usage.cachedReadTokens > 0
      ? { cachedInputTokens: usage.cachedReadTokens }
      : {}),
    completedAt: Date.now(),
  };
}

private resolveModelDisplayName(modelId: string): string {
  const settings = getOpencodeProviderSettings(this.plugin.settings);
  const model = settings.discoveredModels.find((m) => m.rawId === modelId);
  return model?.label ?? modelId;
}
```

**Idempotency:** The `turnId` uses the OpenCode session id. If the same prompt
response is replayed (e.g., on reconnect), the contribution id (derived from
`turnId`) is the same, so `SessionUsageService.applyContribution` ignores the
duplicate. If OpenCode retries within the same session, the same `turnId`
replaces the prior contribution — matching the spec's replacement rule.

**Cost:** `AcpUsageUpdate` (`src/providers/acp/types.ts:440`) carries an
optional `cost: { amount, currency }`. This is context-window cost, not
per-turn cost — do not emit it as a five-hour window. The spec's `cost: N%/5h`
segment is Codex-only (rolling account window). OpenCode has no equivalent
five-hour window, so `fiveHourWindow` is omitted for OpenCode contributions.

### 2. `src/providers/opencode/history/OpencodeSqliteReader.ts` — extend for usage aggregation

The existing reader loads `messageRows` and `partRows` for a session. Extend
it to also aggregate per-message token usage metadata for ledger
reconstruction.

Add a new query function:

```ts
export async function loadOpencodeSessionUsageAggregation(
  databasePath: string,
  sessionId: string,
  dependencies: OpencodeSqliteReaderDependencies = {},
): Promise<OpencodeUsageAggregation[] | null>
```

`OpencodeUsageAggregation` groups assistant message token metadata by
exact model/variant:

```ts
export interface OpencodeUsageAggregation {
  modelId: string;
  effort?: string;
  inputTokens: number;
  outputTokens: number;
  reasoningTokens: number;
  cachedInputTokens?: number;
  totalTokens: number;
  contributionCount: number;
}
```

The query reads from the message/part tables where the message role is
`assistant` and token metadata is present. The exact schema depends on the
OpenCode SQLite layout — inspect the existing `OPENCODE_MESSAGE_ROW_SQL` /
`OPENCODE_PART_ROW_SQL` builders and extend with token columns.

**Read-only:** The existing reader uses `readonly: true` mode
(`OpencodeSqliteReader.ts:36`). The new query follows the same pattern. Do
not modify OpenCode schemas.

### 3. `src/providers/opencode/history/OpencodeHistoryStore.ts` — reload reconstruction

In `loadOpencodeSessionMessages()` (line 34), after loading messages, also
load the usage aggregation and attach it to the conversation's ledger during
hydration.

**Preferred approach:** `OpencodeConversationHistoryService` (line 12
`hydrateConversationHistory`) runs a reconciliation step after loading
messages:

```ts
async hydrateConversationHistory(
  conversation: Conversation,
  _vaultPath: string | null,
): Promise<void> {
  // ...existing message hydration...

  // NEW: reconcile session usage ledger from SQLite
  const state = getOpencodeState(conversation.providerState);
  const databasePath = resolveExistingOpencodeDatabasePath(state.databasePath);
  if (databasePath && databasePath !== ':memory:' && conversation.sessionId) {
    const aggregation = await loadOpencodeSessionUsageAggregation(
      databasePath,
      conversation.sessionId,
    );
    if (aggregation) {
      conversation.sessionUsage = this.reconcileLedgerFromAggregation(
        conversation,
        aggregation,
      );
    }
  }

  this.hydratedKeys.set(conversation.id, hydrationKey);
}
```

`reconcileLedgerFromAggregation`:

1. If `conversation.sessionUsage` already exists (persisted from a prior
   session), use it as the base. The SQLite aggregation is a reconciliation
   check, not a second contribution.
2. If no persisted ledger exists, build one from the aggregation: each
   `OpencodeUsageAggregation` row becomes a `SessionUsageRow` with a single
   synthetic contribution per model/effort.
3. If the persisted ledger's totals match the SQLite aggregation, no change.
4. If they differ, prefer the SQLite aggregation (authoritative) and rebuild
   the ledger rows. This handles cases where the persisted ledger was lost or
   partially saved.

**Do not double-count:** If the persisted ledger has contributions from the
live stream (Phase 1 `session_usage` chunks) and the SQLite aggregation
covers the same turns, the reconciliation replaces the contributions rather
than adding to them. The SQLite aggregation is the authoritative source on
reload; the live contributions are the authoritative source during the
session.

## Tests

### `tests/unit/providers/opencode/runtime/OpencodeChatRuntime.test.ts`

- `AcpPromptResponse.usage` → `session_usage` chunk emitted with correct
  fields (input, output, thought→reasoning, cached)
- `session_usage` emitted before `done`
- missing `usage` in response → no `session_usage` chunk
- model id + effort propagated from session state
- `cachedReadTokens` mapped to `cachedInputTokens` only when > 0
- `thoughtTokens` mapped to `reasoningTokens`
- duplicate prompt response (same sessionId) → contribution idempotent

### `tests/unit/providers/opencode/history/OpencodeSqliteReader.test.ts`

- `loadOpencodeSessionUsageAggregation` returns per-model aggregation
- aggregation groups by exact modelId + effort
- missing token metadata → aggregation row omitted (no zero placeholders)
- read-only mode (does not modify database)

### `tests/unit/providers/opencode/history/OpencodeHistoryStore.test.ts`

(or `OpencodeConversationHistoryService.test.ts`)

- reload reconstructs ledger from SQLite aggregation
- persisted ledger preserved when SQLite matches
- persisted ledger rebuilt when SQLite differs (authoritative)
- no persisted ledger → built from aggregation
- no SQLite database (memory or missing) → ledger unchanged
- aggregation does not double-count with live contributions

## Verification

```bash
npm run typecheck
npm run lint
npm test -- --runInBand \
  tests/unit/providers/opencode/runtime/OpencodeChatRuntime.test.ts \
  tests/unit/providers/opencode/history/OpencodeSqliteReader.test.ts \
  tests/unit/providers/opencode/history/OpencodeHistoryStore.test.ts
npm run build
```

Manual acceptance:

1. Open a native OpenCode conversation (not via Codex/OCG).
2. Complete a turn → footer shows one row with per-turn tokens.
3. Complete a second turn → footer shows cumulative total.
4. Switch OpenCode model → new row appears.
5. Reload Obsidian → footer restored from SQLite reconciliation.
6. Continue conversation → footer was not sent back as prompt content.
7. Confirm no `cost: N%/5h` segment (OpenCode has no rolling window).
