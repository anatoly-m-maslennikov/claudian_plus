# Feature 2 — Phase 1: Core Ledger + Codex

Reference spec: `Your Harness/1 - Spec/feature-2-usage-footer-spec.md`

## Summary

Build the provider-neutral `SessionUsageLedger`, the `SessionUsageService`,
rendering on the latest assistant message + status panel, persistence via
`ConversationController.save()`, and Codex ingestion using cumulative snapshot
deltas + `account/rateLimits` snapshots.

## Files to Change

### 1. `src/core/types/chat.ts` — ledger types + stream chunk

Add the ledger types (from spec "Data model"):

```ts
export interface SessionUsageContribution {
  id: string;
  source: 'provider-turn' | 'delegated-worker';
  turnId: string;
  inputTokens: number;
  outputTokens: number;
  reasoningTokens: number;
  cachedInputTokens?: number;
  completedAt: number;
}

export interface SessionUsageRow {
  providerId: string;
  modelId: string;
  displayName?: string;
  effort?: string;
  inputTokens: number;
  outputTokens: number;
  reasoningTokens: number;
  cachedInputTokens?: number;
  totalTokens: number;
  contributions: SessionUsageContribution[];
}

export interface FiveHourWindow {
  usedPercent: number;
  windowMinutes: 300;
  observedAt: number;
  providerId: string;
}

export interface SessionUsageLedger {
  version: 1;
  conversationId: string;
  rows: SessionUsageRow[];
  fiveHourWindow?: FiveHourWindow;
}

export interface SessionUsageContributionInput {
  providerId: string;
  modelId: string;
  displayName?: string;
  effort?: string;
  turnId: string;
  inputTokens: number;
  outputTokens: number;
  reasoningTokens: number;
  cachedInputTokens?: number;
  completedAt: number;
}
```

Add `sessionUsage?: SessionUsageLedger` to `Conversation` (line 65).

Add the new stream chunk variant to `StreamChunk` (line 137):

```ts
| {
    type: 'session_usage';
    contribution: SessionUsageContributionInput;
    fiveHourWindow?: FiveHourWindow;
    sessionId?: string | null;
  }
```

### 2. `src/features/chat/services/SessionUsageService.ts` — new file

The core ledger service. Responsibilities per spec "Ledger Service":

```ts
export class SessionUsageService {
  // Normalize a provider contribution into a ledger row update.
  // Row key: providerId + modelId + effort.
  // Idempotent by contribution.id — duplicate ignored.
  // Replacement: same turnId replaces prior contribution for that turn.
  applyContribution(
    ledger: SessionUsageLedger,
    contribution: SessionUsageContributionInput,
  ): { changed: boolean; ledger: SessionUsageLedger }

  // Update the five-hour window snapshot (sparse merge — don't erase prior
  // values on null fields).
  applyFiveHourWindow(
    ledger: SessionUsageLedger,
    window: FiveHourWindow,
  ): { changed: boolean; ledger: SessionUsageLedger }

  // Produce sorted display rows per spec "Sorting":
  // 1. orchestrator/current conversation provider
  // 2. delegated providers
  // 3. first-seen order within each class
  getDisplayRows(
    ledger: SessionUsageLedger,
    orchestratorProviderId: string,
  ): SessionUsageRow[]

  // Create an empty ledger for a new conversation.
  createLedger(conversationId: string): SessionUsageLedger
}
```

Arithmetic rules:
- `row.totalTokens = row.inputTokens + row.outputTokens + row.reasoningTokens`
  (recomputed from contributions — never stored stale).
- `row.cachedInputTokens` is a subset of `inputTokens`; never added to total.
- No zero/unavailable placeholders — if a field is absent, omit it.

### 3. `src/features/chat/utils/sessionUsageFormat.ts` — new file

Formatter for display rows:

```ts
export function formatSessionUsageRow(
  row: SessionUsageRow,
  providerDisplayName: string,
): string
```

Output format:
```text
- {providerDisplayName} {displayName ?? modelId}{, {effort}}: {compact(total)} tokens{; cost: {pct}%/5h}
```

- `compact(n)`: `<1000` → as-is; `<1_000_000` → `${round(n/1000)}k`;
  else `${round(n/1_000_000, 1)}M`.
- `, {effort}` — only when `row.effort` is set.
- `; cost: {pct}%/5h` — only when `ledger.fiveHourWindow` exists and
  `windowMinutes === 300` and `providerId` matches the row's provider.
- Never display `unavailable`.

### 4. `src/providers/codex/runtime/codexAppServerTypes.ts` — rate-limit types

Add official shapes:

```ts
export interface RateLimitWindow {
  usedPercent: number;
  windowDurationMins: number;
  // ...other fields per official schema
}

export interface RateLimitSnapshot {
  primary: RateLimitWindow;
  // ...other windows
}

export interface AccountRateLimitsUpdatedNotification {
  rateLimits: Partial<RateLimitSnapshot>;  // sparse — may not include all windows
  threadId: string;
  turnId: string;
}

export interface AccountRateLimitsReadResponse {
  rateLimits: RateLimitSnapshot;
}
```

### 5. `src/providers/codex/runtime/CodexChatRuntime.ts` — rate-limit state

After `initialize()` (handshake complete), call `account/rateLimits/read` to
seed the rate-limit snapshot. Register an `account/rateLimits/updated`
notification handler. Merge sparse updates without erasing previously known
values:

```ts
private rateLimitSnapshot: RateLimitSnapshot | null = null;

private async seedRateLimits(): Promise<void> {
  const response = await this.transport!.request('account/rateLimits/read', {});
  this.rateLimitSnapshot = response.rateLimits;
}

private onAccountRateLimitsUpdated(params: AccountRateLimitsUpdatedNotification): void {
  if (!this.rateLimitSnapshot) {
    // First sparse update before read completed — store what we have
    this.rateLimitSnapshot = params.rateLimits as RateLimitSnapshot;
    return;
  }
  // Sparse merge: only overwrite fields present in the update
  if (params.rateLimits.primary) {
    this.rateLimitSnapshot = {
      ...this.rateLimitSnapshot,
      primary: { ...this.rateLimitSnapshot.primary, ...params.rateLimits.primary },
    };
  }
}
```

Pass the resolved rate-limit snapshot + model display name + normalized effort
into the router's turn state so `onTurnCompleted` can emit `session_usage`.

### 6. `src/providers/codex/runtime/CodexNotificationRouter.ts` — emit `session_usage`

**Buffer cumulative `total` per turn.** Extend the existing
`onTokenUsageUpdated` handler (line 775) to also store the full `total`
`TokenUsage` struct (not just `last`):

```ts
private cumulativeTotalByTurn = new Map<string, TokenUsage>();
private previousCumulativeTotal: TokenUsage | null = null;

private onTokenUsageUpdated(params: TokenUsageUpdatedNotification): void {
  // ...existing context usage emission (unchanged)...

  // NEW: buffer cumulative total for session_usage delta calculation
  this.cumulativeTotalByTurn.set(params.turnId, params.tokenUsage.total);
}
```

**On `onTurnCompleted`** (line 793), emit `session_usage` **before** `done`
(critical: `query()` exits when `done` is consumed):

```ts
private onTurnCompleted(params: TurnCompletedNotification): void {
  const turn = params.turn;

  if (turn.status === 'failed' && turn.error) {
    this.emit({ type: 'error', content: turn.error.message });
  }

  if (turn.status === 'completed') {
    this.emitSessionUsage(params.turnId);
    this.onTurnMetadata?.({
      assistantMessageId: turn.id,
      ...(this.isPlanTurn && this.sawPlanDelta ? { planCompleted: true } : {}),
    });
  }

  this.flushPendingRawToolOutputs();
  this.emit({ type: 'done' });
}

private emitSessionUsage(turnId: string): void {
  const cumulativeTotal = this.cumulativeTotalByTurn.get(turnId);
  if (!cumulativeTotal) return;

  // Delta = current cumulative - previous accepted cumulative
  const previous = this.previousCumulativeTotal;
  const delta: TokenUsage = {
    totalTokens: cumulativeTotal.totalTokens - (previous?.totalTokens ?? 0),
    inputTokens: cumulativeTotal.inputTokens - (previous?.inputTokens ?? 0),
    cachedInputTokens: cumulativeTotal.cachedInputTokens - (previous?.cachedInputTokens ?? 0),
    outputTokens: cumulativeTotal.outputTokens - (previous?.outputTokens ?? 0),
    reasoningOutputTokens: cumulativeTotal.reasoningOutputTokens - (previous?.reasoningOutputTokens ?? 0),
  };

  // Only emit if delta is meaningful (not all zeros)
  if (delta.totalTokens <= 0 && delta.inputTokens <= 0 && delta.outputTokens <= 0) {
    return;
  }

  this.previousCumulativeTotal = cumulativeTotal;

  const contribution: SessionUsageContributionInput = {
    providerId: 'codex',
    modelId: this.turnModelId ?? 'unknown',
    displayName: this.turnModelDisplayName,
    effort: this.turnEffort,
    turnId,
    inputTokens: delta.inputTokens,
    outputTokens: delta.outputTokens,
    reasoningTokens: delta.reasoningOutputTokens,
    ...(delta.cachedInputTokens > 0 ? { cachedInputTokens: delta.cachedInputTokens } : {}),
    completedAt: Date.now(),
  };

  const fiveHourWindow = this.buildFiveHourWindow();
  this.emit({ type: 'session_usage', contribution, fiveHourWindow, sessionId: this.threadId });
}

private buildFiveHourWindow(): FiveHourWindow | undefined {
  const primary = this.rateLimitSnapshot?.primary;
  if (!primary || primary.windowDurationMins !== 300) return undefined;
  return {
    usedPercent: primary.usedPercent,
    windowMinutes: 300,
    observedAt: Date.now(),
    providerId: 'codex',
  };
}
```

`turnModelId`, `turnModelDisplayName`, `turnEffort`, and `rateLimitSnapshot`
are passed into the router's turn state from `CodexChatRuntime` when the turn
starts.

### 7. `src/providers/codex/runtime/CodexSessionFileTail.ts` — transcript-tail parity

Extend `pendingUsageByTurn` (line 116) to also store the cumulative
`total_token_usage` snapshot for delta calculation:

```ts
pendingUsageByTurn: Map<string, {
  contextTokens: number;
  contextWindow: number;
  contextWindowIsAuthoritative: boolean;
  // NEW: cumulative total + rate limits for session_usage
  cumulativeTotal?: {
    inputTokens: number;
    outputTokens: number;
    reasoningTokens: number;
    cachedInputTokens: number;
    totalTokens: number;
  };
  previousCumulativeTotal?: { ...same shape... };
  fiveHourWindow?: { usedPercent: number; windowMinutes: number };
}>
```

In the `token_count` handler (line 300), parse `info.total_token_usage` and
`info.rate_limits.primary`:

```ts
case 'token_count': {
  const turnId = resolveTurnId(state, undefined);
  const info = isRecord(payload.info) ? payload.info : {};
  const lastTokenUsage = isRecord(info.last_token_usage) ? info.last_token_usage : {};
  const totalTokenUsage = isRecord(info.total_token_usage) ? info.total_token_usage : {};
  const rateLimits = isRecord(info.rate_limits) ? info.rate_limits : {};
  const primary = isRecord(rateLimits.primary) ? rateLimits.primary : {};

  // ...existing pendingUsageByTurn context fields...

  state.pendingUsageByTurn.set(turnId, {
    ...existing,
    cumulativeTotal: {
      inputTokens: getNumber(totalTokenUsage.input_tokens) ?? 0,
      outputTokens: getNumber(totalTokenUsage.output_tokens) ?? 0,
      reasoningTokens: getNumber(totalTokenUsage.reasoning_tokens) ?? 0,
      cachedInputTokens: getNumber(totalTokenUsage.cached_input_tokens) ?? 0,
      totalTokens: getNumber(totalTokenUsage.total_tokens) ?? 0,
    },
    fiveHourWindow: {
      usedPercent: getNumber(primary.used_percent) ?? 0,
      windowMinutes: getNumber(primary.window_minutes) ?? 0,
    },
  });
  return [];
}
```

On `task_complete` (line 244), emit `session_usage` (delta from cumulative)
**before** `done`, in this order:

1. existing context `usage` (if pending)
2. new `session_usage` (cumulative delta + five-hour window)
3. `done`

Track `previousCumulativeTotal` in `SessionTailState` for delta computation.

### 8. `src/providers/codex/history/CodexHistoryStore.ts` — reload reconstruction

Extend `TurnAccumulator` (line 277):

```ts
interface TurnAccumulator {
  // ...existing fields...
  sessionUsageContribution?: SessionUsageContributionInput;
  fiveHourWindow?: FiveHourWindow;
}
```

When scanning transcript events, parse `token_count` events for the cumulative
total + rate limits (reuse the field extraction from `CodexSessionFileTail`).
Store in the turn accumulator. In `flushTurn()` (line 297), populate
`msg.sessionUsageContribution` — but since the ledger lives on `Conversation`,
not `ChatMessage`, emit it as a synthetic `session_usage` stream chunk during
hydration, or write directly to the conversation ledger during the history
service's reconciliation pass.

**Preferred approach:** `CodexConversationHistoryService` runs a
reconciliation step after loading messages: scan for `token_count` events,
compute cumulative deltas, and populate `conversation.sessionUsage` directly.
This avoids threading stream chunks through the history hydration path.

### 9. `src/features/chat/controllers/StreamController.ts` — handle `session_usage`

Add a new case in `handleStreamChunk` (after `case 'usage'` at line 217):

```ts
case 'session_usage': {
  const currentSessionId = this.deps.getAgentService?.()?.getSessionId() ?? null;
  const chunkSessionId = chunk.sessionId ?? null;
  if (
    (chunkSessionId && currentSessionId && chunkSessionId !== currentSessionId) ||
    (chunkSessionId && !currentSessionId)
  ) {
    break;
  }

  const conversation = this.deps.getConversationController()?.getCurrentConversation();
  if (!conversation) break;

  const service = this.deps.getSessionUsageService();
  let ledger = conversation.sessionUsage ?? service.createLedger(conversation.id);
  const contributionResult = service.applyContribution(ledger, chunk.contribution);
  if (chunk.fiveHourWindow) {
    const windowResult = service.applyFiveHourWindow(contributionResult.ledger, chunk.fiveHourWindow);
    ledger = windowResult.ledger;
  } else {
    ledger = contributionResult.ledger;
  }

  if (contributionResult.changed || chunk.fiveHourWindow) {
    conversation.sessionUsage = ledger;
    state.sessionUsageLedger = ledger;
    this.deps.getMessageRenderer()?.upsertSessionUsageFooter(
      state.currentAssistantMessageId,
      ledger,
      this.getOrchestratorProviderId(),
    );
    this.deps.getStatusPanel()?.renderSessionUsage(ledger);
  }
  break;
}
```

`state.sessionUsageLedger` is a new `ChatState` field tracking the current
ledger for the active conversation.

### 10. `src/features/chat/rendering/MessageRenderer.ts` — footer upsert

Add method:

```ts
upsertSessionUsageFooter(
  messageId: string | null,
  ledger: SessionUsageLedger,
  orchestratorProviderId: string,
): void {
  // Find the latest assistant message's content element.
  // Find or create .claudian-response-footer.
  // Build display text from service.getDisplayRows() + formatSessionUsageRow().
  // Replace footer text (never append a second footer).
  // Also render on restored messages in renderAssistantContent() when
  // msg is the latest assistant message and ledger is present.
}
```

In `renderAssistantContent()` (line 339), after the duration footer (line 402),
render the session usage footer **only for the latest assistant message** when
`conversation.sessionUsage` is present. The "latest" check is done by comparing
`msg.id` against the current assistant message id in `ChatState`.

### 11. `src/features/chat/ui/StatusPanel.ts` — ledger section

Add a "Session usage" section to the status panel:

```ts
renderSessionUsage(ledger: SessionUsageLedger): void {
  // Create or update a section in the panel showing the same rows as the
  // message footer. Use the same formatSessionUsageRow() helper.
  // Only render when ledger.rows.length > 0.
  // Replace, never duplicate.
}
```

### 12. `src/features/chat/controllers/ConversationController.ts` — persist ledger

In `save()` (line 394), add `sessionUsage` to the updates:

```ts
const updates: Partial<Conversation> = {
  ...sessionUpdates,
  messages: state.messages,
  currentNote: currentNote,
  externalContextPaths: ...,
  usage: state.usage ?? undefined,
  enabledMcpServers: ...,
  sessionUsage: state.sessionUsageLedger ?? undefined,  // <-- new
};
```

### 13. `src/features/chat/controllers/InputController.ts` — wire service deps

Ensure `StreamController` deps include `getSessionUsageService()` and that
`ChatState` carries `sessionUsageLedger`. The `finally` block (line 440)
already saves via `ConversationController.save()` — the ledger is persisted
there as long as `state.sessionUsageLedger` is set by the `session_usage`
handler.

## Tests (~8 files)

### `tests/unit/features/chat/services/SessionUsageService.test.ts` — new

- input + output + reasoning = total; cached not double-counted
- duplicate contribution id ignored
- replacement contribution (same turnId) replaces prior
- exact provider/model/effort grouping
- same modelId from different providers → separate rows
- unknown provider/model renders without code changes
- model switch creates new row
- no zero/unavailable placeholders (empty fields omitted)
- sorting: orchestrator first, delegated second, first-seen within

### `tests/unit/features/chat/utils/sessionUsageFormat.test.ts` — new

- compact: 999 → `999`, 12000 → `12k`, 66000 → `66k`, 1200000 → `1.2M`
- effort shown when present, omitted when absent
- `; cost: N%/5h` shown when 300-min window exists
- cost omitted when window absent or non-300-min
- provider display name prefixed

### `tests/unit/providers/codex/runtime/CodexNotificationRouter.test.ts`

- cumulative snapshot delta per turn (not `last_token_usage`)
- retry/replay replacement (same turnId replaces)
- `session_usage` emitted before `done` (ordering)
- 300-min window → `fiveHourWindow` populated
- missing/non-300-min window → `fiveHourWindow` undefined
- model display name + effort propagated into contribution
- sparse rate-limit merge does not erase prior fields

### `tests/unit/providers/codex/runtime/CodexSessionFileTail.test.ts`

- `token_count` parses `total_token_usage` (cumulative) + `rate_limits.primary`
- `task_complete` emits order: context `usage` → `session_usage` → `done`
- delta = cumulative - previous cumulative
- interrupted turn: emit only if authoritative `token_count` arrived
- dedup by turn id

### `tests/unit/providers/codex/history/CodexHistoryStore.test.ts`

- reload reconstructs ledger from `token_count` events
- cumulative deltas computed correctly across multiple turns
- legacy transcripts without `token_count` → ledger absent (no error)

### `tests/unit/features/chat/controllers/StreamController.test.ts`

- `session_usage` chunk applies contribution to ledger via service
- `session_usage` calls `MessageRenderer.upsertSessionUsageFooter` (replace)
- `session_usage` calls `StatusPanel.renderSessionUsage`
- chunk from wrong session ignored
- repeated `session_usage` replaces, never duplicates footer

### `tests/unit/features/chat/rendering/MessageRenderer.test.ts`

- `upsertSessionUsageFooter` creates footer on latest assistant message
- repeated calls replace, never append
- footer not added to `msg.content` or `contentBlocks`
- restored (reload) latest assistant message renders footer from persisted ledger
- non-latest assistant messages do not get the live footer

### `tests/unit/features/chat/controllers/ConversationController.test.ts`

- `save()` persists `sessionUsage` ledger
- ledger round-trips through save → reload

## Verification

```bash
npm run typecheck
npm run lint
npm test -- --runInBand \
  tests/unit/features/chat/services/SessionUsageService.test.ts \
  tests/unit/features/chat/utils/sessionUsageFormat.test.ts \
  tests/unit/providers/codex/runtime/CodexNotificationRouter.test.ts \
  tests/unit/providers/codex/runtime/CodexSessionFileTail.test.ts \
  tests/unit/providers/codex/history/CodexHistoryStore.test.ts \
  tests/unit/features/chat/controllers/StreamController.test.ts \
  tests/unit/features/chat/rendering/MessageRenderer.test.ts \
  tests/unit/features/chat/controllers/ConversationController.test.ts
npm run build
```

Manual acceptance:

1. Start a Codex conversation, complete turn 1 → footer shows one row with
   per-turn delta.
2. Complete turn 2 → footer shows cumulative total (turn 1 + turn 2).
3. Switch Codex model/effort, complete turn 3 → new row appears; first row
   keeps its cumulative total.
4. Status panel shows the same rows.
5. Reload Obsidian → footer restored from persisted ledger + Codex transcript
   reconciliation.
6. Continue conversation → footer was not sent back as prompt content.
7. Confirm `cost: N%/5h` appears only when Codex reports a 300-min window.
