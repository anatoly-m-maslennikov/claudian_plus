# Feature 2 — Phase 4: Future Provider Adapters (Claude, Pi)

Reference spec: `AM Patch/1 - Spec/feature-2-usage-footer-spec.md`
Depends on: Phase 1 (core ledger, `SessionUsageService`, `session_usage` chunk,
rendering, persistence)

## Summary

Wire Claude and Pi to emit `session_usage` contributions using the Phase 1
contract. No ledger/UI/service changes — the provider-neutral `session_usage`
chunk and `SessionUsageService` from Phase 1 cover everything. Each provider
only needs to populate a `SessionUsageContributionInput` and emit the chunk
before `done`.

## Provider Telemetry Availability

| Provider | input | output | reasoning | cached | rolling-window % | $ cost |
|----------|-------|--------|-----------|--------|------------------|--------|
| Claude   | yes   | yes (available, currently dropped) | no | yes | no | no |
| Pi       | yes (context-oriented) | no | no | yes | no | no |

Claude has no rolling five-hour window and no per-turn cost. Pi has only
context-oriented input tokens. Both omit the optional `fiveHourWindow` and
`cost` segments — the formatter (Phase 1) renders only the segments that exist.

## Files to Change

### 1. Claude — `src/providers/claude/stream/transformClaudeMessage.ts`

**Problem:** Today, `toPromptUsageSnapshot()` (line 269) extracts only
`input_tokens`, `cache_creation_input_tokens`, and `cache_read_input_tokens`
from `MessageUsage`. The `output_tokens` field (line 81 in `MessageUsage`
interface) is available on the assistant message's `usage` object but is
dropped — it is not needed for the context-window meter (`UsageInfo`), so it
was never carried through.

**Fix:** Extend `PromptUsageSnapshot` (line 86) to also carry `outputTokens`:

```ts
interface PromptUsageSnapshot {
  inputTokens: number;
  cacheCreationInputTokens: number;
  cacheReadInputTokens: number;
  outputTokens: number;  // <-- new
  contextTokens: number;
}
```

Update `toPromptUsageSnapshot()` (line 269) and `mergePromptUsage()` (line 283)
to carry `output_tokens` through. `EMPTY_PROMPT_USAGE` (line 248) gets
`outputTokens: 0`.

**Emit `session_usage`:** In the `result` case (line 554), after the final
context `usage` emission (line 556-562), emit a `session_usage` chunk:

```ts
case 'result':
  options?.streamState?.clearAll();
  if (options?.usageState) {
    const usageChunk = maybeEmitUsageFromPromptUsage(
      options.usageState.getPromptUsage(), options,
    );
    if (usageChunk) yield usageChunk;

    // NEW: emit session_usage contribution from cumulative prompt usage
    const sessionUsageChunk = maybeEmitSessionUsageFromPromptUsage(
      options.usageState.getPromptUsage(),
      options,
    );
    if (sessionUsageChunk) yield sessionUsageChunk;

    options.usageState.clear();
  }
  // ...existing error/context-window handling...
  break;
```

Add `maybeEmitSessionUsageFromPromptUsage()`:

```ts
function maybeEmitSessionUsageFromPromptUsage(
  promptUsage: PromptUsageSnapshot,
  options?: TransformOptions,
): StreamChunk | null {
  if (promptUsage.inputTokens <= 0 && promptUsage.outputTokens <= 0) {
    return null;
  }

  const model = options?.intendedModel ?? 'sonnet';
  const effort = options?.effortLevel;

  const contribution: SessionUsageContributionInput = {
    providerId: 'claude',
    modelId: model,
    displayName: resolveClaudeModelDisplayName(model),
    ...(effort && effort !== 'off' ? { effort } : {}),
    turnId: options?.turnId ?? `claude-turn-${Date.now()}`,
    inputTokens: promptUsage.inputTokens,
    outputTokens: promptUsage.outputTokens,
    reasoningTokens: 0,  // Claude does not expose reasoning tokens separately
    ...(promptUsage.cacheReadInputTokens > 0
      ? { cachedInputTokens: promptUsage.cacheReadInputTokens }
      : {}),
    completedAt: Date.now(),
  };

  return { type: 'session_usage', contribution };
}
```

**Cumulative attribution:** Claude's `PromptUsageSnapshot` is merged across
the turn via `mergePromptUsage()` (line 283), which takes
`Math.max(current.inputTokens, next.inputTokens)`. This is not a true
cumulative total — it is the max of the prompt usage snapshots seen during the
turn. For Claude, where the SDK reports input tokens at `message_start` and
refines at `message_delta`, the max is the authoritative per-turn input.

For cumulative session totals, the `SessionUsageService` (Phase 1) accumulates
across turns: each turn emits one `session_usage` contribution, and the
ledger sums them. Claude's per-turn contribution is
`inputTokens + outputTokens` (no reasoning tokens). The cumulative ledger
row for Claude is the sum of all turn contributions for that model+effort.

**Turn ID and effort:** `options.turnId` and `options.effortLevel` must be
passed into `transformSDKMessage` from `ClaudeChatRuntime`. Inspect how
`TransformOptions` is built in `ClaudeChatRuntime` and add these fields.

**No `fiveHourWindow`:** Claude has no rolling account window. Omit the
field — the formatter renders the row without `; cost: N%/5h`.

### 2. Claude — `src/providers/claude/runtime/ClaudeChatRuntime.ts`

Pass `turnId` and `effortLevel` into `TransformOptions` so
`transformClaudeMessage` can populate the contribution. The `result` message
is processed at line 554 of `transformClaudeMessage.ts`; the runtime drains
remaining chunks at line 1400 before `yield { type: 'done' }` at line 1417 —
so `session_usage` is yielded before `done`.

### 3. Claude — `src/providers/claude/history/ClaudeConversationHistoryService.ts`

Claude's history service merges Claudian-saved messages with SDK session
messages and dedupes by id (line 154 `dedupeMessages`). The ledger is
conversation metadata, not message metadata, so it survives message-array
replacement. **No reconstruction needed** — `conversation.sessionUsage`
persists via `ConversationController.save()` (Phase 1) and is not overwritten
by Claude's history hydration (which only touches `conversation.messages`).

Confirm: `hydrateConversationHistory()` (line 357) sets
`conversation.messages = merged` (line 430) but does not touch
`conversation.sessionUsage`. No change needed.

### 4. Pi — `src/providers/pi/runtime/PiChatRuntime.ts`

In `query()` (around line 570), after `fetchUsage()` (line 570) and before
pushing `done` (line 574), emit a `session_usage` chunk:

```ts
await this.refreshStateAndSessionTarget();
await this.updateTurnMetadataFromSessionFile(turnStartLeafId);
const usage = await this.fetchUsage(queryOptions).catch(() => null);
if (usage) {
  activeTurn.queue.push({ sessionId: this.sessionId, type: 'usage', usage });
}

// NEW: emit session_usage contribution from Pi usage
if (usage) {
  const contribution = this.buildSessionUsageContribution(usage, queryOptions);
  if (contribution) {
    activeTurn.queue.push({
      type: 'session_usage',
      contribution,
      sessionId: this.sessionId,
    });
  }
}

activeTurn.queue.push({ type: 'done' });
```

Add the contribution builder:

```ts
private buildSessionUsageContribution(
  usage: UsageInfo,
  queryOptions?: ChatRuntimeQueryOptions,
): SessionUsageContributionInput | null {
  const modelId = typeof queryOptions?.model === 'string'
    ? queryOptions.model
    : this.currentSessionModelId ?? 'unknown';
  if (!modelId) return null;

  const effort = typeof this.plugin.settings.effortLevel === 'string'
    ? this.plugin.settings.effortLevel.trim()
    : undefined;

  // Pi only exposes context-oriented input tokens (no output/reasoning)
  return {
    providerId: 'pi',
    modelId,
    displayName: this.resolveModelDisplayName(modelId),
    ...(effort && effort !== 'off' ? { effort } : {}),
    turnId: this.sessionId ?? `pi-turn-${Date.now()}`,
    inputTokens: usage.inputTokens ?? 0,
    outputTokens: 0,  // Pi does not expose output tokens
    reasoningTokens: 0,  // Pi does not expose reasoning tokens
    ...(usage.cacheReadInputTokens && usage.cacheReadInputTokens > 0
      ? { cachedInputTokens: usage.cacheReadInputTokens }
      : {}),
    completedAt: Date.now(),
  };
}
```

**Order:** `session_usage` is pushed after context `usage` and before `done`.
The query generator consumes chunks in order, so `session_usage` is handled
before `done` exits the loop.

**No `fiveHourWindow`:** Pi has no rolling account window. Omit the field.

### 5. Pi — `src/providers/pi/history/PiConversationHistoryService.ts`

Pi's history service replaces `conversation.messages` from the Pi session
file (line 39, 77). Like Claude, the ledger is conversation metadata and
survives message-array replacement. **No reconstruction needed** —
`conversation.sessionUsage` persists via `ConversationController.save()`
(Phase 1) and is not overwritten by Pi's history hydration.

Confirm: `hydrateConversationHistory()` sets `conversation.messages = messages`
but does not touch `conversation.sessionUsage`. No change needed.

If Pi session files contain per-turn token metadata that could be used for
reconciliation, that is a future enhancement — not required for Phase 4. The
persisted ledger is sufficient for reload.

## Tests

### `tests/unit/providers/claude/stream/transformClaudeMessage.test.ts` — extend

- **`output_tokens` carried through `PromptUsageSnapshot`:** assistant message
  with `usage.output_tokens: 500` → `PromptUsageSnapshot.outputTokens === 500`.
- **`result` case emits `session_usage`:** `result` message after assistant
  message with usage → `session_usage` chunk yielded before `done`.
- **Contribution fields correct:** `providerId: 'claude'`, `modelId` from
  `intendedModel`, `effort` from `effortLevel` (omitted when `'off'`).
- **`reasoningTokens: 0`:** Claude does not expose reasoning tokens.
- **`cachedInputTokens` populated when `cacheReadInputTokens > 0`.**
- **No `fiveHourWindow` in chunk.**
- **Empty usage → no `session_usage` chunk** (input and output both 0).

### `tests/unit/providers/claude/runtime/ClaudeChatRuntime.test.ts` — extend

- **`session_usage` yielded before `done`** in the query generator.
- **`turnId` and `effortLevel` passed into `TransformOptions`.**

### `tests/unit/providers/claude/history/ClaudeConversationHistoryService.test.ts` — extend

- **`conversation.sessionUsage` preserved across history hydration** —
  hydrate does not clear or overwrite the ledger.
- **Ledger persists through save → reload cycle.**

### `tests/unit/providers/pi/runtime/PiChatRuntime.test.ts` — extend

- **`session_usage` emitted after `usage` and before `done`.**
- **Contribution fields correct:** `providerId: 'pi'`, `modelId` from
  `queryOptions.model`, `effort` from settings (omitted when `'off'`).
- **`outputTokens: 0`, `reasoningTokens: 0`** (Pi does not expose these).
- **`cachedInputTokens` populated when `cacheReadInputTokens > 0`.**
- **No `fiveHourWindow` in chunk.**
- **`fetchUsage` returns null → no `session_usage` chunk.**

### `tests/unit/providers/pi/history/PiConversationHistoryService.test.ts` — extend

- **`conversation.sessionUsage` preserved across history hydration.**

### `tests/unit/features/chat/utils/sessionUsageFormat.test.ts` — extend

- **Claude row:** `- Claude Sonnet 4.6, high: 66k tokens` (no `cost` segment).
- **Pi row:** `- Pi Gemini 3.1 Pro, high: 12k tokens` (no `cost` segment,
  input-only total).

## Verification

```bash
npm run typecheck
npm run lint
npm test -- --runInBand \
  tests/unit/providers/claude/stream/transformClaudeMessage.test.ts \
  tests/unit/providers/claude/runtime/ClaudeChatRuntime.test.ts \
  tests/unit/providers/claude/history/ClaudeConversationHistoryService.test.ts \
  tests/unit/providers/pi/runtime/PiChatRuntime.test.ts \
  tests/unit/providers/pi/history/PiConversationHistoryService.test.ts \
  tests/unit/features/chat/utils/sessionUsageFormat.test.ts
npm run build
```

Manual acceptance:

1. Start a Claude conversation, complete a turn → footer shows
   `- Claude {model}, {effort}: {total} tokens` (input + output, no `cost`).
2. Complete a second turn → cumulative total in the footer.
3. Start a Pi conversation, complete a turn → footer shows
   `- Pi {model}, {effort}: {total} tokens` (input only, no `cost`).
4. Reload Obsidian → both ledgers restored from persisted metadata.
5. Continue either conversation → footer was not sent back as prompt content.
6. Mix providers across tabs → each conversation shows only its own ledger.

## Future Providers

Any future provider (ACP-based, custom, etc.) can emit `session_usage` using
the Phase 1 contract without changing ledger, service, formatter, renderer, or
persistence code. The provider adapter only needs to:

1. Populate a `SessionUsageContributionInput` with `providerId`, `modelId`,
   token fields, and optional `effort`/`cachedInputTokens`.
2. Emit `{ type: 'session_usage', contribution, ... }` before `done`.
3. Optionally populate `fiveHourWindow` if the provider has a rolling account
   window with `windowMinutes: 300`.

The formatter, `SessionUsageService`, `MessageRenderer`, `StatusPanel`, and
`ConversationController.save()` all work generically — no provider-specific
code is needed beyond the adapter.
