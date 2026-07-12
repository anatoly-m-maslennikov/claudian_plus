# Autotest Plan — Your Harness Features

Reference specs:
- `Your Harness/1 - Spec/feature-1-tab-names-spec.md`
- `Your Harness/1 - Spec/feature-2-usage-footer-spec.md`

Reference implementation plans:
- `Your Harness/2 - Implementation Plan/feature-1-tab-names-plan.md`
- `Your Harness/2 - Implementation Plan/feature-2-usage-footer-phase-1-core-codex.md`
- `Your Harness/2 - Implementation Plan/feature-2-usage-footer-phase-2-opencode.md`
- `Your Harness/2 - Implementation Plan/feature-2-usage-footer-phase-3-ocg-workers.md`
- `Your Harness/2 - Implementation Plan/feature-2-usage-footer-phase-4-future-providers.md`

## Test Infrastructure

- **Runner:** Jest with `ts-jest` preset, two projects (`unit`, `integration`).
  Config: `jest.config.js`.
- **Test path convention:** `tests/unit/` mirrors `src/` layout. New tests go
  under the mirrored path, e.g. `src/features/chat/services/SessionUsageService.ts`
  → `tests/unit/features/chat/services/SessionUsageService.test.ts`.
- **Module aliases:** `@/` → `src/`, `@test/` → `tests/`. Obsidian and the
  Claude Agent SDK are mocked via `tests/__mocks__/`.
- **Setup:** `tests/setupWindow.ts` runs before each test file (installs
  `window`, `requestAnimationFrame`, etc.).
- **Helpers:** `tests/helpers/mockElement.ts` exports `createMockEl()`.
- **TDD workflow** (per `CLAUDE.md`): write the failing test first, make it
  pass, then refactor.

## Execution Commands

```bash
# Full unit suite
npm run test -- --selectProjects unit

# Specific test files (fast iteration)
npm run test -- --runInBand --selectProjects unit -- <path1> <path2> ...

# With coverage
npm run test:coverage -- --selectProjects unit

# Typecheck + lint (must pass before committing tests)
npm run typecheck
npm run lint
```

---

## Feature 1 — Tab Names Instead of Numbers

### Files to Create / Update

| File | Action | Purpose |
|------|--------|---------|
| `tests/unit/features/chat/tabs/TabBar.test.ts` | **Update** | Add `showTitle` cases; update `createTabBarItem` helper |
| `tests/unit/features/chat/tabs/TabManager.test.ts` | **Update** | Add `showTitle` propagation from settings |

### TDD Order

Write tests **before** the implementation changes. Each test below should fail
against the current code (red), then pass after the change (green).

#### Step 1.1 — Update `createTabBarItem` helper

In `tests/unit/features/chat/tabs/TabBar.test.ts:16`, add `showTitle: false`
to the default mock so existing index-rendering tests stay green without
modification:

```ts
function createTabBarItem(overrides: Partial<TabBarItem> = {}): TabBarItem {
  return {
    id: 'tab-1',
    index: 1,
    title: 'Test Tab',
    providerId: 'claude',
    showTitle: false,   // <-- new default; existing tests unaffected
    isActive: false,
    isStreaming: false,
    needsAttention: false,
    canClose: true,
    ...overrides,
  };
}
```

#### Step 1.2 — New `TabBar` test cases

Add a new `describe('titled badge rendering', ...)` block:

1. **`showTitle: true` renders truncated title by default (16-char cap)**
   - Input: `createTabBarItem({ showTitle: true, title: 'Refactor auth flow' })`
   - Assert: `badge.textContent === 'Refactor auth…'` (16 chars + `…`)

2. **`showTitle: true` with short title renders full title**
   - Input: `createTabBarItem({ showTitle: true, title: 'Bug fix' })`
   - Assert: `badge.textContent === 'Bug fix'` (no truncation)

3. **`showTitle: true` applies `--titled` modifier class**
   - Input: `createTabBarItem({ showTitle: true })`
   - Assert: `badge.hasClass('claudian-tab-badge--titled') === true`

4. **`showTitle: false` does not apply `--titled` class**
   - Input: `createTabBarItem({ showTitle: false })`
   - Assert: `badge.hasClass('claudian-tab-badge--titled') === false`

5. **dblclick on `showTitle: true` badge expands to 32-char limit**
   - Input: `createTabBarItem({ showTitle: true, title: <40-char string> })`
   - Dispatch `dblclick` event
   - Assert: `badge.textContent` is 32 chars + `…`
   - Assert: `--titled` removed, `--expanded` added,
     `data-title-expanded === 'true'`

6. **dblclick toggle off returns to 16-char titled mode**
   - After test 5, dispatch `dblclick` again
   - Assert: `badge.textContent` is 16 chars + `…`
   - Assert: `--titled` re-added, `--expanded` removed,
     `data-title-expanded === 'false'`

7. **`showTitle: true` preserves expanded state across updates**
   - Expand a titled badge, then call `tabBar.update()` with the same item
   - Assert: badge stays expanded (matches existing test at line 155, but with
     `showTitle: true`)

8. **Boundary: title exactly 16 chars — no truncation**
   - Input: `createTabBarItem({ showTitle: true, title: '1234567890123456' })`
   - Assert: `badge.textContent === '1234567890123456'` (no `…`)

9. **Boundary: title 17 chars — truncated to 16 + `…`**
   - Input: `createTabBarItem({ showTitle: true, title: '12345678901234567' })`
   - Assert: `badge.textContent === '123456789012345…'`

#### Step 1.3 — Update existing dblclick test

The existing test at line 114 ("should toggle between index and title labels
on double click") uses the default `showTitle`. If the helper default changes
to `false`, this test still works (dblclick expands to title, dblclick again
returns to index). No change needed unless the helper default changes to
`true` — in that case, update the assertion at line 134 to expect the 16-char
titled mode instead of `'2'`.

**Recommended:** keep helper default as `false` to minimize churn.

#### Step 1.4 — New `TabManager` test cases

In `tests/unit/features/chat/tabs/TabManager.test.ts`, extend the
`getTabBarItems` describe block (line 622):

1. **`showTitle` defaults to true when setting is unset**
   - Mock `plugin.settings.showTabTitles = undefined`
   - Call `manager.getTabBarItems()`
   - Assert: every item has `showTitle === true` (fallback to default)

2. **`showTitle` reflects setting value (false)**
   - Mock `plugin.settings.showTabTitles = false`
   - Assert: every item has `showTitle === false`

3. **`showTitle` reflects setting value (true)**
   - Mock `plugin.settings.showTabTitles = true`
   - Assert: every item has `showTitle === true`

### Verification

```bash
npm run test -- --runInBand --selectProjects unit -- \
  tests/unit/features/chat/tabs/TabBar.test.ts \
  tests/unit/features/chat/tabs/TabManager.test.ts
npm run typecheck
npm run lint
```

---

## Feature 2 — Cumulative Session Usage Footer

### Files to Create / Update

| File | Action | Phase | Purpose |
|------|--------|-------|---------|
| `tests/unit/features/chat/services/SessionUsageService.test.ts` | **Create** | 1 | Core ledger arithmetic, idempotency, sorting |
| `tests/unit/features/chat/utils/sessionUsageFormat.test.ts` | **Create** | 1 | Formatter: compact tokens, segment visibility |
| `tests/unit/providers/codex/runtime/CodexNotificationRouter.test.ts` | **Update** | 1 | Cumulative delta, `session_usage` before `done`, rate-limit merge |
| `tests/unit/providers/codex/runtime/CodexSessionFileTail.test.ts` | **Update** | 1 | `total_token_usage` parsing, ordering, delta |
| `tests/unit/providers/codex/history/CodexHistoryStore.test.ts` | **Update** | 1 | Reload reconstruction from `token_count` events |
| `tests/unit/features/chat/controllers/StreamController.test.ts` | **Update** | 1+3 | `session_usage` chunk handling + worker marker parsing |
| `tests/unit/features/chat/rendering/MessageRenderer.test.ts` | **Update** | 1 | `upsertSessionUsageFooter`, replace-not-duplicate |
| `tests/unit/features/chat/controllers/ConversationController.test.ts` | **Update** | 1 | Persist `sessionUsage` ledger |
| `tests/unit/providers/opencode/runtime/OpencodeChatRuntime.test.ts` | **Update** | 2 | ACP `session_usage` emission |
| `tests/unit/providers/opencode/history/OpencodeSqliteReader.test.ts` | **Update** | 2 | Usage aggregation query |
| `tests/unit/providers/opencode/history/OpencodeHistoryStore.test.ts` | **Update** | 2 | Reload reconciliation |
| `tests/unit/features/chat/services/WorkerUsageMarkerParser.test.ts` | **Create** | 3 | Marker parsing, stripping, malformed handling |
| `tests/unit/providers/claude/stream/transformClaudeMessage.test.ts` | **Update** | 4 | `output_tokens` carry-through, `session_usage` emission |
| `tests/unit/providers/claude/runtime/ClaudeChatRuntime.test.ts` | **Update** | 4 | `session_usage` before `done`, turn metadata passing |
| `tests/unit/providers/claude/history/ClaudeConversationHistoryService.test.ts` | **Update** | 4 | Ledger preserved across hydration |
| `tests/unit/providers/pi/runtime/PiChatRuntime.test.ts` | **Update** | 4 | `session_usage` emission, input-only |
| `tests/unit/providers/pi/history/PiConversationHistoryService.test.ts` | **Update** | 4 | Ledger preserved across hydration |

**Total: 2 new files + 15 updated files.**

---

### Phase 1 Tests — Core Ledger + Codex

#### Step 2.1 — `SessionUsageService.test.ts` (new file)

**Test setup pattern:**
```ts
import { SessionUsageService } from '@/features/chat/services/SessionUsageService';
import type { SessionUsageContributionInput, SessionUsageLedger } from '@/core/types';

const service = new SessionUsageService();

function makeContribution(overrides: Partial<SessionUsageContributionInput> = {}): SessionUsageContributionInput {
  return {
    providerId: 'codex',
    modelId: 'gpt-5.5',
    effort: 'high',
    turnId: 'turn-1',
    inputTokens: 10000,
    outputTokens: 5000,
    reasoningTokens: 1000,
    completedAt: 1700000000000,
    ...overrides,
  };
}
```

**Test cases:**

1. **`applyContribution` creates a new row for a new provider+model+effort**
   - Apply one contribution → ledger has 1 row with matching totals.

2. **Total = input + output + reasoning (recomputed)**
   - Apply contribution with `inputTokens: 100, outputTokens: 50, reasoningTokens: 25`
   - Assert `row.totalTokens === 175`.

3. **Cached input is not double-counted**
   - Apply contribution with `inputTokens: 100, cachedInputTokens: 80`
   - Assert `row.totalTokens === 100 + output + reasoning` (cached is subset,
     not added).

4. **Same provider+model+effort accumulates into one row**
   - Apply two contributions with same key, different turnIds
   - Assert: 1 row, `row.totalTokens` = sum, `row.contributions.length === 2`.

5. **Duplicate contribution id ignored**
   - Apply same contribution twice (same `turnId`)
   - Assert: 1 row, totals unchanged, `contributions.length === 1`.

6. **Replacement contribution (same turnId) replaces prior**
   - Apply contribution with `turnId: 't1'`, `inputTokens: 100`
   - Apply another with `turnId: 't1'`, `inputTokens: 200`
   - Assert: 1 row, `row.inputTokens === 200`, `contributions.length === 1`.

7. **Same modelId from different providers → separate rows**
   - Apply `providerId: 'codex', modelId: 'gpt-5'` and
     `providerId: 'opencode', modelId: 'gpt-5'`
   - Assert: 2 rows.

8. **Different effort → separate rows**
   - Apply `effort: 'high'` and `effort: 'low'` for same provider+model
   - Assert: 2 rows.

9. **Model switch creates new row**
   - Apply `modelId: 'gpt-5.5'` then `modelId: 'gpt-5.4'`
   - Assert: 2 rows.

10. **Unknown provider/model renders without code changes**
    - Apply `providerId: 'future-provider', modelId: 'future-model-v1'`
    - Assert: 1 row, no error.

11. **No zero/unavailable placeholders**
    - Apply contribution with `outputTokens: 0`, `reasoningTokens: 0`
    - Assert: row exists, but optional fields absent in display output.

12. **`applyFiveHourWindow` sets the window**
    - Apply a 300-min window with `usedPercent: 14`
    - Assert: `ledger.fiveHourWindow.usedPercent === 14`.

13. **`applyFiveHourWindow` sparse merge — don't erase prior**
    - Apply window with `usedPercent: 14`
    - Apply another with `usedPercent: 20`
    - Assert: `ledger.fiveHourWindow.usedPercent === 20` (replaced, not
      erased — since `FiveHourWindow` is a complete struct, this is a
      full replace; test that it doesn't erase when partial data arrives).

14. **`getDisplayRows` sorting: orchestrator first, delegated second**
    - Apply contributions for `providerId: 'codex'` (orchestrator) and
      `providerId: 'opencode-go'` (delegated)
    - Assert: codex row first, opencode-go row second.

15. **`getDisplayRows` first-seen order within each class**
    - Apply 3 delegated contributions in order A, B, A
    - Assert: rows appear in first-seen order (A before B).

16. **`createLedger` produces empty ledger with version 1**
    - Assert: `ledger.version === 1`, `ledger.rows.length === 0`.

#### Step 2.2 — `sessionUsageFormat.test.ts` (new file)

**Test cases:**

1. **Compact tokens: `<1000` → as-is**
   - `formatSessionUsageRow({ ..., totalTokens: 999 })` → contains `999 tokens`.

2. **Compact tokens: `12000` → `12k`**
   - `totalTokens: 12000` → `12k tokens`.

3. **Compact tokens: `66000` → `66k`**

4. **Compact tokens: `1200000` → `1.2M`**

5. **Effort shown when present**
   - `effort: 'high'` → contains `, high:`.

6. **Effort omitted when absent**
   - No `effort` field → no `, {effort}:` segment.

7. **`cost: N%/5h` shown when 300-min window exists**
   - `fiveHourWindow: { usedPercent: 14, windowMinutes: 300 }` → contains
     `; cost: 14%/5h`.

8. **Cost omitted when window absent**
   - No `fiveHourWindow` → no `; cost:` segment.

9. **Cost omitted when window is non-300-min**
   - `fiveHourWindow: { usedPercent: 14, windowMinutes: 60 }` → no `; cost:`
     segment.

10. **Provider display name prefixed**
    - `providerDisplayName: 'Codex'`, `displayName: 'GPT-5.5'` → contains
      `Codex GPT-5.5`.

11. **Falls back to modelId when displayName absent**
    - No `displayName` → contains the `modelId` directly.

#### Step 2.3 — `CodexNotificationRouter.test.ts` (update)

**Critical: update the existing test at line 1184** ("ignores
account/rateLimits/updated"). After Phase 1, the router **handles** this
notification (sparse merge into rate-limit snapshot). Change the test to:

```ts
it('handles account/rateLimits/updated (sparse merge)', () => {
  router.handleNotification('account/rateLimits/updated', {
    rateLimits: { primary: { usedPercent: 14, windowDurationMins: 300 } },
    threadId: 't1',
    turnId: 'turn1',
  });
  // Assert: rate-limit snapshot updated (no chunks emitted directly —
  // the snapshot is consumed when turn/completed emits session_usage)
  expect(chunks).toHaveLength(0);
});
```

**New test cases in `describe('session_usage', ...)`:**

1. **Cumulative snapshot delta per turn**
   - Send `thread/tokenUsage/updated` with `total.totalTokens: 20000`
   - Send `turn/completed`
   - Assert: `session_usage` chunk with `contribution.inputTokens` = delta
     (20000 - 0 = 20000 for first turn).

2. **Second turn delta = cumulative - previous cumulative**
   - First turn: `total.totalTokens: 20000` → delta 20000
   - Second turn: `total.totalTokens: 35000` → delta 15000
   - Assert: second `session_usage` contribution has `totalTokens: 15000`.

3. **`session_usage` emitted before `done`**
   - Send `thread/tokenUsage/updated` then `turn/completed`
   - Assert chunk order: `[..., { type: 'session_usage', ... }, { type: 'done' }]`.

4. **Retry/replay replacement (same turnId)**
   - Send `turn/completed` for `turn1`
   - Send another `turn/completed` for `turn1` (retry)
   - Assert: second `session_usage` replaces first (same `turnId`).

5. **300-min window → `fiveHourWindow` populated**
   - Seed rate limits with `windowDurationMins: 300, usedPercent: 14`
   - Complete a turn
   - Assert: `session_usage` chunk has `fiveHourWindow.usedPercent === 14`.

6. **Missing/non-300-min window → `fiveHourWindow` undefined**
   - No rate-limit snapshot seeded
   - Complete a turn
   - Assert: `session_usage` chunk has `fiveHourWindow === undefined`.

7. **Non-300-min window → `fiveHourWindow` undefined**
   - Seed rate limits with `windowDurationMins: 60`
   - Assert: `fiveHourWindow === undefined`.

8. **Model display name + effort propagated**
   - Set turn state with `modelId: 'gpt-5.5', effort: 'high'`
   - Assert: `contribution.modelId === 'gpt-5.5'`, `contribution.effort === 'high'`.

9. **Sparse rate-limit merge does not erase prior fields**
   - Seed with `usedPercent: 14, windowDurationMins: 300`
   - Send sparse update with only `usedPercent: 20` (no `windowDurationMins`)
   - Assert: snapshot still has `windowDurationMins: 300`.

10. **Failed turn does not emit `session_usage`**
    - `turn/completed` with `status: 'failed'`
    - Assert: no `session_usage` chunk (only `error` + `done`).

11. **Interrupted turn: emit only if authoritative telemetry exists**
    - Send `tokenUsage/updated` then `turn/completed` with `status: 'interrupted'`
    - Assert: `session_usage` emitted (telemetry was received before
      interruption). Test the opposite case too (no telemetry → no
      `session_usage`).

#### Step 2.4 — `CodexSessionFileTail.test.ts` (update)

**Update the existing `token_count` tests** (line 272) to also assert the new
`cumulativeTotal` and `fiveHourWindow` fields stored in `pendingUsageByTurn`.

**New test cases:**

1. **`token_count` parses `total_token_usage` (cumulative)**
   - Send `token_count` with both `last_token_usage` and `total_token_usage`
   - Assert: `pendingUsageByTurn` has `cumulativeTotal` populated.

2. **`token_count` parses `rate_limits.primary`**
   - Send `token_count` with `rate_limits.primary: { used_percent: 14, window_minutes: 300 }`
   - Assert: `pendingUsageByTurn` has `fiveHourWindow` populated.

3. **`task_complete` emits order: context `usage` → `session_usage` → `done`**
   - Seed `pendingUsageByTurn` with both context and cumulative data
   - Send `task_complete`
   - Assert chunk order: `usage`, `session_usage`, `done`.

4. **Delta = cumulative - previous cumulative**
   - First turn: cumulative `totalTokens: 20000` → delta 20000
   - Second turn: cumulative `totalTokens: 35000` → delta 15000
   - Assert second `session_usage` contribution has correct delta.

5. **Interrupted turn: emit `session_usage` only if `token_count` arrived**
   - No `token_count` before `turn_aborted` → no `session_usage`
   - `token_count` before `turn_aborted` → `session_usage` emitted.

6. **Dedup by turn id**
   - Send `task_complete` twice for same turn
   - Assert: `session_usage` emitted once (dedup).

#### Step 2.5 — `CodexHistoryStore.test.ts` (update)

1. **Reload reconstructs ledger from `token_count` events**
   - Feed a transcript with 2 turns, each with `token_count`
   - Assert: `conversation.sessionUsage` has 1 row (same model+effort) with
     cumulative totals = sum of both deltas.

2. **Cumulative deltas computed correctly across multiple turns**
   - 3 turns with increasing cumulative totals
   - Assert: row totals = turn3 cumulative - 0 (first turn baseline).

3. **Model switch creates new row in reconstructed ledger**
   - Turn 1: model A, Turn 2: model B
   - Assert: 2 rows.

4. **Legacy transcripts without `token_count` → ledger absent**
   - Feed a transcript with no `token_count` events
   - Assert: `conversation.sessionUsage` is undefined (no error, no empty
     ledger).

#### Step 2.6 — `StreamController.test.ts` (update, Phase 1 portion)

**New test cases in a `describe('session_usage chunk', ...)`:**

1. **`session_usage` chunk applies contribution to ledger**
   - Mock `getConversationController().getCurrentConversation()` returns a
     conversation
   - Push a `session_usage` chunk
   - Assert: `conversation.sessionUsage` updated, `state.sessionUsageLedger`
     set.

2. **`session_usage` calls `MessageRenderer.upsertSessionUsageFooter`**
   - Push a `session_usage` chunk
   - Assert: `upsertSessionUsageFooter` called once with the ledger.

3. **`session_usage` calls `StatusPanel.renderSessionUsage`**
   - Assert: `renderSessionUsage` called once.

4. **Chunk from wrong session ignored**
   - Push `session_usage` with `sessionId: 'other'` when current session is
     `'current'`
   - Assert: ledger not updated, no footer upsert.

5. **Repeated `session_usage` replaces, never duplicates footer**
   - Push two `session_usage` chunks for the same turn
   - Assert: `upsertSessionUsageFooter` called twice (replace), but
     `conversation.sessionUsage.rows.length` stays 1 (idempotent
     contribution).

#### Step 2.7 — `MessageRenderer.test.ts` (update)

1. **`upsertSessionUsageFooter` creates footer on latest assistant message**
   - Render an assistant message, call `upsertSessionUsageFooter`
   - Assert: `.claudian-response-footer` exists with formatted text.

2. **Repeated calls replace, never append**
   - Call `upsertSessionUsageFooter` twice
   - Assert: only one `.claudian-response-footer` element, text updated.

3. **Footer not added to `msg.content` or `contentBlocks`**
   - After `upsertSessionUsageFooter`
   - Assert: `msg.content` unchanged, `msg.contentBlocks` unchanged.

4. **Restored (reload) latest assistant message renders footer**
   - Render a stored assistant message with `conversation.sessionUsage` set
   - Assert: footer rendered from persisted ledger.

5. **Non-latest assistant messages do not get the live footer**
   - Render two assistant messages; only the latest gets the footer
   - Assert: first message has no session-usage footer, second does.

#### Step 2.8 — `ConversationController.test.ts` (update)

1. **`save()` persists `sessionUsage` ledger**
   - Set `state.sessionUsageLedger` to a non-empty ledger
   - Call `save()`
   - Assert: `plugin.updateConversation` called with `sessionUsage` in updates.

2. **Ledger round-trips through save → reload**
   - Save with a ledger, then load the conversation
   - Assert: `conversation.sessionUsage` matches the saved ledger.

---

### Phase 2 Tests — Native OpenCode

#### Step 2.9 — `OpencodeChatRuntime.test.ts` (update)

1. **`AcpPromptResponse.usage` → `session_usage` chunk emitted**
   - Mock `connection.prompt()` to resolve with `usage: { inputTokens: 100,
     outputTokens: 50, thoughtTokens: 25, totalTokens: 175 }`
   - Assert: `session_usage` chunk in the stream with correct fields.

2. **`session_usage` emitted before `done`**
   - Assert chunk order: `session_usage`, `usage` (context), `done`.

3. **Missing `usage` in response → no `session_usage` chunk**
   - Mock `connection.prompt()` to resolve with `usage: null`
   - Assert: no `session_usage` chunk.

4. **Model id + effort propagated**
   - Set `currentSessionModelId: 'kimi-k2.7-code'`, `effortLevel: 'max'`
   - Assert: `contribution.modelId === 'kimi-k2.7-code'`,
     `contribution.effort === 'max'`.

5. **`cachedReadTokens` mapped to `cachedInputTokens` only when > 0**
   - `usage.cachedReadTokens: 4096` → `contribution.cachedInputTokens === 4096`
   - `usage.cachedReadTokens: 0` → `contribution.cachedInputTokens` absent.

6. **`thoughtTokens` mapped to `reasoningTokens`**
   - `usage.thoughtTokens: 25` → `contribution.reasoningTokens === 25`.

7. **Duplicate prompt response (same sessionId) → idempotent**
   - Resolve two prompts with the same session
   - Assert: second `session_usage` contribution is idempotent (same turnId
     → replaced, not duplicated in ledger).

#### Step 2.10 — `OpencodeSqliteReader.test.ts` (update)

1. **`loadOpencodeSessionUsageAggregation` returns per-model aggregation**
   - Mock SQLite with assistant messages for 2 models
   - Assert: 2 aggregation rows with correct token sums.

2. **Aggregation groups by exact modelId + effort**
   - Messages with same model but different effort → 2 rows.

3. **Missing token metadata → aggregation row omitted**
   - Messages without token fields → not included in aggregation.

4. **Read-only mode (does not modify database)**
   - Assert: SQLite opened with `readonly: true`.

#### Step 2.11 — `OpencodeHistoryStore.test.ts` (update)

1. **Reload reconstructs ledger from SQLite aggregation**
   - Mock SQLite aggregation with 2 models
   - Assert: `conversation.sessionUsage` has 2 rows.

2. **Persisted ledger preserved when SQLite matches**
   - Pre-set `conversation.sessionUsage`, mock SQLite with matching totals
   - Assert: ledger unchanged.

3. **Persisted ledger rebuilt when SQLite differs**
   - Pre-set ledger with different totals than SQLite
   - Assert: ledger rebuilt from SQLite (authoritative).

4. **No persisted ledger → built from aggregation**
   - No pre-set ledger, SQLite has data
   - Assert: ledger built from aggregation.

5. **No SQLite database (memory or missing) → ledger unchanged**
   - `databasePath: ':memory:'` or missing file
   - Assert: no reconciliation attempted.

6. **Aggregation does not double-count with live contributions**
   - Persisted ledger with live contributions, SQLite aggregation covers
     same turns
   - Assert: reconciliation replaces, doesn't add.

---

### Phase 3 Tests — Delegated OCG Workers

#### Step 2.12 — `WorkerUsageMarkerParser.test.ts` (new file)

**Test setup:**
```ts
import {
  parseWorkerUsageMarkers,
  stripWorkerUsageMarkers,
  CLAUDIAN_USAGE_EVENT_PREFIX,
} from '@/features/chat/services/WorkerUsageMarkerParser';
```

**Test cases:**

1. **Valid marker parsed**
   - Input: `CLAUDIAN_USAGE_EVENT={"version":1,"workerSessionId":"ws1","providerId":"opencode-go","modelId":"kimi-k2.7-code","effort":"max","inputTokens":15520,"outputTokens":6549,"reasoningTokens":0,"totalTokens":22069}`
   - Assert: 1 marker, all fields correct.

2. **Multiple markers parsed**
   - Input: 2 marker lines in one content string
   - Assert: 2 markers.

3. **Malformed JSON ignored**
   - Input: `CLAUDIAN_USAGE_EVENT={invalid json`
   - Assert: 0 markers, no throw.

4. **Missing required fields ignored**
   - Input: valid JSON without `workerSessionId`
   - Assert: 0 markers.

5. **Wrong version ignored**
   - Input: `version: 2`
   - Assert: 0 markers.

6. **`stripWorkerUsageMarkers` removes marker lines**
   - Input: `some output\nCLAUDIAN_USAGE_EVENT={...}\nmore output`
   - Assert: result is `some output\nmore output`.

7. **Non-marker lines preserved**
   - Input: `line1\nCLAUDIAN_USAGE_EVENT={...}\nline2`
   - Assert: result is `line1\nline2`.

8. **Truncated marker ignored**
   - Input: `CLAUDIAN_USAGE_EVENT={"version":1,"workerSess` (truncated)
   - Assert: 0 markers, no throw.

9. **`totalTokens` recomputed from input + output + reasoning**
   - Input: marker with `totalTokens: 999` but `input: 100, output: 50, reasoning: 25`
   - Assert: parsed `totalTokens === 175` (computed, not the 999 field).

10. **`cachedInputTokens` optional**
    - Marker without `cachedInputTokens` → parsed marker has no
      `cachedInputTokens` field.

11. **`lane` and `phase` optional metadata**
    - Marker with `lane: 'go-code', phase: 'plan'` → parsed correctly.

#### Step 2.13 — `StreamController.test.ts` (update, Phase 3 portion)

**New test cases in `describe('delegated worker usage markers', ...)`:**

1. **Marker in tool result → ledger updated**
   - Push a `tool_result` chunk with content containing a valid marker
   - Assert: `conversation.sessionUsage` updated with `delegated-worker`
     contribution.

2. **Marker stripped from rendered content**
   - Push a `tool_result` with marker + normal content
   - Assert: rendered tool result content does not contain
     `CLAUDIAN_USAGE_EVENT`.

3. **Duplicate workerSessionId+phase ignored**
   - Push two `tool_result` chunks with the same marker
   - Assert: ledger contribution applied once (idempotent).

4. **Plan + execute same model → one row**
   - Push two markers with same `providerId + modelId + effort` but different
     `phase` (`plan`, `execute`)
   - Assert: 1 ledger row, totals summed.

5. **Malformed marker does not break tool rendering**
   - Push a `tool_result` with malformed marker + normal content
   - Assert: tool result renders normally (marker line stripped, other
     content preserved).

6. **Marker from non-active turn still attributes to parent message**
   - Push marker in a tool result after the turn's `done` chunk
   - Assert: contribution attributed to the parent turn's message id
     (edge case — ledger still updates).

#### Step 2.14 — `SessionUsageService.test.ts` (update, Phase 3 portion)

1. **Delegated-worker contribution sorts after orchestrator**
   - Apply `source: 'provider-turn'` for codex, `source: 'delegated-worker'`
     for opencode-go
   - Assert: codex row first, opencode-go row second.

2. **Plan + execute same model combine into one row**
   - Apply two `delegated-worker` contributions with same
     `providerId + modelId + effort` but different `phase`/`turnId`
   - Assert: 1 row, totals summed.

3. **Delegated provider with unknown modelId renders without code changes**
   - Apply `providerId: 'future-worker', modelId: 'unknown-v1'`
   - Assert: 1 row, no error.

---

### Phase 4 Tests — Future Providers (Claude, Pi)

#### Step 2.15 — `transformClaudeMessage.test.ts` (update)

1. **`output_tokens` carried through `PromptUsageSnapshot`**
   - Feed an assistant message with `usage.output_tokens: 500`
   - Assert: `PromptUsageSnapshot.outputTokens === 500`.

2. **`result` case emits `session_usage`**
   - Feed assistant message with usage, then `result` message
   - Assert: `session_usage` chunk yielded.

3. **`session_usage` emitted before `done`**
   - Assert chunk order: `session_usage` before `done`.

4. **Contribution fields correct**
   - Assert: `providerId: 'claude'`, `modelId` from `intendedModel`,
     `effort` from `effortLevel`.

5. **Effort omitted when `'off'`**
   - `effortLevel: 'off'` → `contribution.effort` absent.

6. **`reasoningTokens: 0`** (Claude does not expose reasoning tokens)
   - Assert: `contribution.reasoningTokens === 0`.

7. **`cachedInputTokens` populated when `cacheReadInputTokens > 0`**
   - `cacheReadInputTokens: 4096` → `contribution.cachedInputTokens === 4096`.

8. **No `fiveHourWindow` in chunk**
   - Assert: `chunk.fiveHourWindow === undefined`.

9. **Empty usage → no `session_usage` chunk**
   - `inputTokens: 0, outputTokens: 0` → no `session_usage` yielded.

#### Step 2.16 — `ClaudeChatRuntime.test.ts` (update)

1. **`session_usage` yielded before `done`** in the query generator.
2. **`turnId` and `effortLevel` passed into `TransformOptions`**

#### Step 2.17 — `ClaudeConversationHistoryService.test.ts` (update)

1. **`conversation.sessionUsage` preserved across history hydration**
   - Pre-set `conversation.sessionUsage`, run hydration
   - Assert: `conversation.sessionUsage` unchanged (hydration only touches
     `messages`).

2. **Ledger persists through save → reload cycle**

#### Step 2.18 — `PiChatRuntime.test.ts` (update)

1. **`session_usage` emitted after `usage` and before `done`**
   - Assert chunk order.

2. **Contribution fields correct**
   - `providerId: 'pi'`, `modelId` from `queryOptions.model`,
     `effort` from settings.

3. **`outputTokens: 0`, `reasoningTokens: 0`**
   - Pi does not expose these.

4. **`cachedInputTokens` populated when > 0**

5. **No `fiveHourWindow` in chunk**

6. **`fetchUsage` returns null → no `session_usage` chunk**

#### Step 2.19 — `PiConversationHistoryService.test.ts` (update)

1. **`conversation.sessionUsage` preserved across history hydration**

#### Step 2.20 — `sessionUsageFormat.test.ts` (update, Phase 4)

1. **Claude row:** `- Claude Sonnet 4.6, high: 66k tokens` (no `cost` segment)
2. **Pi row:** `- Pi Gemini 3.1 Pro, high: 12k tokens` (no `cost` segment,
   input-only total)

---

## Execution Order

Tests should be written and run in this order to match the phased delivery:

### Phase 1 (Core + Codex)
1. `SessionUsageService.test.ts` (new) — pure logic, no mocks needed
2. `sessionUsageFormat.test.ts` (new) — pure logic
3. `CodexNotificationRouter.test.ts` (update) — update existing rate-limits
   test first, then add `session_usage` cases
4. `CodexSessionFileTail.test.ts` (update)
5. `CodexHistoryStore.test.ts` (update)
6. `MessageRenderer.test.ts` (update)
7. `StreamController.test.ts` (update, Phase 1 portion)
8. `ConversationController.test.ts` (update)

### Phase 2 (OpenCode)
9. `OpencodeChatRuntime.test.ts` (update)
10. `OpencodeSqliteReader.test.ts` (update)
11. `OpencodeHistoryStore.test.ts` (update)

### Phase 3 (Delegated OCG)
12. `WorkerUsageMarkerParser.test.ts` (new) — pure logic, no mocks
13. `SessionUsageService.test.ts` (update, Phase 3 portion)
14. `StreamController.test.ts` (update, Phase 3 portion)

### Phase 4 (Claude, Pi)
15. `transformClaudeMessage.test.ts` (update)
16. `ClaudeChatRuntime.test.ts` (update)
17. `ClaudeConversationHistoryService.test.ts` (update)
18. `PiChatRuntime.test.ts` (update)
19. `PiConversationHistoryService.test.ts` (update)
20. `sessionUsageFormat.test.ts` (update, Phase 4)

### Feature 1 (independent, can run in parallel)
21. `TabBar.test.ts` (update)
22. `TabManager.test.ts` (update)

---

## Critical Existing Tests to Update

These existing tests assert behavior that **changes** with the new features.
They must be updated (not deleted) to assert the new behavior:

| File | Line | Current assertion | New assertion |
|------|------|-------------------|---------------|
| `CodexNotificationRouter.test.ts` | 1184 | "ignores `account/rateLimits/updated`" | "handles `account/rateLimits/updated` (sparse merge)" |
| `CodexSessionFileTail.test.ts` | 283 | `pendingUsageByTurn` has 3 fields (context only) | Has 3 context fields + `cumulativeTotal` + `fiveHourWindow` |
| `TabBar.test.ts` | 16 | `createTabBarItem` has no `showTitle` | Has `showTitle: false` default |

---

## Coverage Targets

After all tests are written and passing:

```bash
npm run test:coverage -- --selectProjects unit -- \
  tests/unit/features/chat/services/SessionUsageService.test.ts \
  tests/unit/features/chat/services/WorkerUsageMarkerParser.test.ts \
  tests/unit/features/chat/utils/sessionUsageFormat.test.ts \
  tests/unit/providers/codex/ \
  tests/unit/providers/opencode/ \
  tests/unit/providers/claude/ \
  tests/unit/providers/pi/ \
  tests/unit/features/chat/controllers/StreamController.test.ts \
  tests/unit/features/chat/rendering/MessageRenderer.test.ts \
  tests/unit/features/chat/controllers/ConversationController.test.ts \
  tests/unit/features/chat/tabs/
```

Target: ≥90% line coverage for:
- `src/features/chat/services/SessionUsageService.ts`
- `src/features/chat/services/WorkerUsageMarkerParser.ts`
- `src/features/chat/utils/sessionUsageFormat.ts`
- `src/features/chat/tabs/TabBar.ts` (titled badge paths)
- All provider runtime files emitting `session_usage`

---

## Final Verification

After all tests pass:

```bash
npm run typecheck
npm run lint
npm run test -- --runInBand
npm run build
```

All four must exit clean before the features are considered done.
