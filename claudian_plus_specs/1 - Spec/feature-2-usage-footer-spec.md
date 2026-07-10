# Feature 2 — Cumulative Session Usage Footer

## Goal

Claudian always shows **cumulative token totals for the current conversation**,
not only the latest prompt or model call. The feature supports Codex, OpenCode
Go, delegated OCG workers, and any future provider/model through one
provider-neutral usage ledger.

## Background

Today, Claudian's `UsageInfo` (`src/core/types/chat.ts:165`) models
**context-window** usage for the context meter — it is not per-turn
output/reasoning and not cumulative across a conversation. The `usage` stream
chunk drives the context meter only. There is no per-turn or per-session token
total surfaced to the user.

Providers already emit the raw telemetry needed:
- **Codex** app-server `thread/tokenUsage/updated` (`TokenUsageUpdatedNotification`
  at `src/providers/codex/runtime/codexAppServerTypes.ts:511`) exposes `total`
  (cumulative thread) and `last` (latest call) `TokenUsage` structs.
  `account/rateLimits/updated` exists but is currently ignored.
- **OpenCode** `AcpPromptResponse.usage` (`src/providers/acp/types.ts:288`)
  carries `inputTokens`, `outputTokens`, `thoughtTokens`, `cachedReadTokens`,
  `cachedWriteTokens`, `totalTokens`, plus optional `cost`.
- **Codex transcript** `token_count` events (`CodexSessionFileTail.ts:300`)
  contain `total_token_usage` (cumulative) and `last_token_usage` plus
  `rate_limits.primary` with `window_minutes: 300`.

## Display

Show the ledger only on the **latest assistant message** and in the
**session status panel** (`src/features/chat/ui/StatusPanel.ts:22`):

```text
Session usage:
- Kimi K2.7 Code, max: 24k tokens
- Codex GPT-5.5, high: 154k tokens; cost: 26%/5h
```

Rules:

- One row per exact **provider + model ID + effort/variant**.
- Display names may be friendly, but identity uses the exact runtime IDs.
- New model IDs are shown automatically; there is no model allowlist.
- `tokens` means input + output + reasoning.
- Cached input is a subset/detail and is never added again.
- Show `cost: N%/5h` only when an authoritative 300-minute rolling-window
  percentage exists.
- If an optional value is missing, omit the field. Never display
  `unavailable`.
- The five-hour percentage is account-window usage, not the cost of one turn.
- Footer is replaced, never duplicated. Repeated telemetry replaces the
  existing footer.
- Footer is **not** part of `ChatMessage.content` or `contentBlocks` — it is
  never sent back as prompt input.

## Session Boundary

A session is one Claudian conversation:

- starts when the conversation is created or forked;
- ends when that conversation is deleted;
- survives Obsidian/plugin reloads;
- is independent from tabs, process restarts, and provider reconnects.

Totals include only completed work attributed to that conversation.

## Data Model

Add a versioned, provider-neutral ledger:

```ts
interface SessionUsageLedger {
  version: 1;
  conversationId: string;
  rows: SessionUsageRow[];
  fiveHourWindow?: {
    usedPercent: number;
    windowMinutes: 300;
    observedAt: number;
    providerId: string;
  };
}

interface SessionUsageRow {
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

interface SessionUsageContribution {
  id: string;
  source: 'provider-turn' | 'delegated-worker';
  turnId: string;
  inputTokens: number;
  outputTokens: number;
  reasoningTokens: number;
  cachedInputTokens?: number;
  completedAt: number;
}
```

Ledger row key: `providerId + modelId + effort`.

Lane and phase remain contribution metadata if useful, but do not create
separate user-facing rows.

Contribution IDs make ingestion idempotent. A repeated event is ignored; a
replacement for the same provider turn replaces its previous contribution.

## Provider Adapter Contract

Every provider adapter may emit a new `session_usage` stream chunk:

```ts
type StreamChunk =
  | ...
  | {
      type: 'session_usage';
      contribution: SessionUsageContributionInput;
      fiveHourWindow?: FiveHourWindow;
    };
```

Rendering and persistence know nothing about specific model names. A future
provider needs only an adapter that emits this normalized chunk.

Providers without authoritative telemetry emit nothing.

## Codex Ingestion

### Authoritative Totals

Codex transcript `token_count` contains:

- `total_token_usage`: cumulative thread totals;
- `last_token_usage`: latest model call;
- `rate_limits.primary`: rolling account-window state.

App-server `thread/tokenUsage/updated` exposes matching `total` and `last`
objects.

### Attribution

At each completed turn:

1. Read the new cumulative `total` snapshot.
2. Subtract the previous accepted cumulative snapshot.
3. Attribute that exact delta to the model and effort configured for the turn.
4. Store the contribution by Codex turn ID.
5. Replace rather than add when the same turn is retried or replayed.

This preserves the exact overall session total while allowing separate rows
after model switches. If Codex internally changes models within one turn and
does not expose per-model breakdown, attribute the turn delta to the configured
turn model rather than inventing a split.

Use official `account/rateLimits/read` and sparse
`account/rateLimits/updated` snapshots. Display the primary percentage only
when `windowDurationMins === 300`.

## Native OpenCode Ingestion

For a Claudian conversation using the OpenCode provider:

- use `AcpPromptResponse.usage` for the completed prompt contribution;
- use the exact model ID and selected effort/variant for that turn;
- read OpenCode SQLite only for reload/reconciliation;
- aggregate assistant message token metadata by exact model/variant;
- use the session table totals as a reconciliation check, not as a second
  contribution.

Extend the existing read-only SQLite reader
(`src/providers/opencode/history/OpencodeSqliteReader.ts`); do not modify
OpenCode schemas.

## Delegated OpenCode Go Workers

When an orchestrator (Codex or another model) runs a child OpenCode session via
`agent-worker`, the child session must be attributed to the current Claudian
turn without timestamp inference.

### Structured Tool-Result Marker

At the end of every worker run, `agent-worker` prints one compact,
machine-readable line:

```text
CLAUDIAN_USAGE_EVENT={"version":1,"workerSessionId":"...","providerId":"opencode-go","modelId":"kimi-k2.7-code","effort":"max","lane":"go-code","phase":"plan","inputTokens":15520,"outputTokens":6549,"reasoningTokens":0,"cachedInputTokens":4096,"totalTokens":22069}
```

Claudian parses this marker from the `exec_command` / `custom_tool_call_output`
tool result already belonging to the active parent turn
(`src/features/chat/controllers/StreamController.ts:570` `handleToolResult`).
Therefore:

- no timestamp matching is needed;
- concurrent tabs and conversations cannot collide;
- no parent environment variable or provider database modification is needed;
- duplicates are rejected using `workerSessionId + phase`.

The marker is metadata only and must not include prompts, paths, auth data, or
secrets.

> **Cross-repo dependency:** The `agent-worker` script emission lives outside
> the Claudian repo (in the Obsidian vault at
> `70_LLM/scripts/agent-worker`). The Claudian-side parser is in scope; the
> script changes are a cross-repo dependency documented here but not planned
> in the Claudian implementation plan files.

## Ledger Service

Add a small `SessionUsageService` responsible for:

- normalizing provider contributions;
- exact row keys;
- replacement/idempotency;
- cumulative arithmetic;
- five-hour snapshot updates;
- persistence migration;
- producing sorted display rows.

Suggested location: `src/features/chat/services/SessionUsageService.ts`.

Do not place arithmetic in `MessageRenderer` or provider adapters.

## Rendering and Persistence

### Live Rendering

`StreamController` applies `session_usage` to the current conversation ledger
(via `SessionUsageService`) and asks `MessageRenderer` to replace the latest
usage footer.

Use the existing `.claudian-response-footer`
(`src/features/chat/rendering/MessageRenderer.ts:404`); do not append usage to
`ChatMessage.content` or `contentBlocks`.

The footer appears only on the **latest** assistant message. Earlier assistant
messages keep any footer they had at render time only if their ledger snapshot
was persisted; the live footer always reflects the current cumulative ledger on
the latest message.

### Persistence

Persist the ledger as optional conversation/session metadata through the
existing `ConversationController.save()` path
(`src/features/chat/controllers/ConversationController.ts:394`). Add
`sessionUsage?: SessionUsageLedger` to `Conversation`.

Provider-native history hydration may replace message arrays
(Codex `CodexHistoryStore`, OpenCode `OpencodeHistoryStore`), so the ledger
must remain conversation metadata, not message metadata. On reload:

1. restore the persisted ledger;
2. reconcile Codex transcript totals or OpenCode SQLite data when available;
3. merge delegated-worker markers already persisted as ledger contributions;
4. render the same totals.

## Sorting

Stable display order:

1. orchestrator/current conversation provider;
2. delegated providers;
3. first-seen order within each class.

Rows are not split by OCG lane or phase.

## Backwards Compatibility

- `sessionUsage` is optional.
- Existing conversations show no block until authoritative usage is received.
- Ledger schema starts at version `1`.
- Unknown/new provider and model IDs remain valid.
- No historical estimate or reconstruction is required when source telemetry
  is unavailable.

## Tests

### Ledger

- input + output + reasoning; cached input is not double-counted;
- duplicate contribution ignored;
- replacement contribution replaces the old value;
- exact provider/model/effort grouping;
- same model ID from different providers remains separate;
- unknown future provider/model renders without code changes;
- model switch creates another row;
- no zero or unavailable placeholders.

### Codex

- cumulative snapshot delta per turn;
- retry/replay replacement;
- app-server and transcript-tail parity;
- 300-minute snapshot adds `cost`;
- missing/non-300-minute snapshot omits `cost`.

### OpenCode

- ACP prompt contribution;
- SQLite reload aggregation by model/variant;
- session aggregate reconciliation does not double-count.

### Delegated Workers

- marker parsed from parent tool result;
- malformed marker ignored safely;
- duplicate worker session/phase ignored;
- plan and execute contributions for the same model combine into one row;
- marker text is not rendered as assistant content.

### UI and Persistence

- footer appears only on latest assistant message;
- footer is replaced, never duplicated;
- reload restores identical totals;
- footer is excluded from subsequent model prompts.

## Verification

From the Claudian repository:

```bash
npm run typecheck
npm test -- --runInBand
npm run build
```

Manual acceptance:

1. Start a Codex conversation and complete two turns.
2. Verify the second footer contains the cumulative total.
3. Switch Codex model/effort and verify a new row appears.
4. Run OCG plan and execute workers; verify their totals merge into rows by
   model/effort.
5. Open a native OpenCode conversation and verify cumulative totals.
6. Reload Obsidian and verify totals are unchanged.
7. Test a future/unknown model ID and verify it appears automatically.

## Delivery Phases

1. **Core + Codex:** ledger, persistence, rendering, cumulative Codex deltas.
2. **Native OpenCode:** ACP ingestion and SQLite reconstruction.
3. **Delegated OCG:** structured `agent-worker` marker and parent tool-result
   parsing (Claudian side; the `agent-worker` script itself is a cross-repo
   dependency).
4. **Future provider adapters:** Claude, Pi, ACP, or other providers can emit
   the same normalized contribution without changing ledger/UI code.

## Definition of Done

- Latest assistant response always shows cumulative authoritative totals for
  the conversation.
- Every used provider/model/effort has one row.
- Current and future models require no UI allowlist.
- OCG worker usage is explicitly attributed through parent tool output.
- Reload is deterministic and idempotent.
- Missing optional telemetry is omitted.
- No usage metadata contaminates model-authored content.
