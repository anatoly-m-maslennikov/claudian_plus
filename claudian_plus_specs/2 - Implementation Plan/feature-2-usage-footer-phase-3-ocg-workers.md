# Feature 2 — Phase 3: Delegated OCG Worker Attribution

Reference spec: `AM Patch/1 - Spec/feature-2-usage-footer-spec.md` ("Delegated OpenCode Go Workers")
Depends on: Phase 1 (core ledger, `SessionUsageService`, rendering)

## Summary

Parse `CLAUDIAN_USAGE_EVENT=...` markers from `exec_command` /
`custom_tool_call_output` tool results on the active parent turn, and attribute
them to the current conversation ledger as `delegated-worker` contributions.
The marker emission in the `agent-worker` script is a cross-repo dependency
(Obsidian vault, out of scope for the Claudian repo).

## Background

When an orchestrator (Codex or another model) runs a child OpenCode session via
`agent-worker`, the child session's usage is not visible to Claudian's provider
runtime — it runs as a subprocess inside a `bash` / `exec_command` tool call.
The tool result content is the only channel that flows back to Claudian.

Today, `StreamController.handleToolResult()` (`src/features/chat/controllers/
StreamController.ts:570`) processes `tool_result` chunks: it resolves pending
tools, handles subagent/task results, and renders the tool result content.
There is no usage-marker parsing.

The spec proposes a structured marker line printed by `agent-worker` at the end
of every worker run:

```text
CLAUDIAN_USAGE_EVENT={"version":1,"workerSessionId":"...","providerId":"opencode-go","modelId":"kimi-k2.7-code","effort":"max","lane":"go-code","phase":"plan","inputTokens":15520,"outputTokens":6549,"reasoningTokens":0,"cachedInputTokens":4096,"totalTokens":22069}
```

Claudian parses this from the tool result content already belonging to the
active parent turn. This means:

- no timestamp matching is needed (the tool result is already attributed to
  the current turn);
- concurrent tabs and conversations cannot collide (each tab has its own
  active turn);
- no parent environment variable or provider database modification is needed;
- duplicates are rejected using `workerSessionId + phase`.

## Files to Change

### 1. `src/features/chat/services/WorkerUsageMarkerParser.ts` — new file

Dedicated parser for the structured marker. Keeping it separate from
`StreamController` makes it testable in isolation.

```ts
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
 * The marker text is metadata only and must not be rendered as assistant
 * content.
 */
export function parseWorkerUsageMarkers(
  toolResultContent: string,
): ParsedWorkerUsageMarker[]

/**
 * Strips CLAUDIAN_USAGE_EVENT= lines from tool result content so the
 * marker is never rendered as assistant content or sent back as prompt.
 */
export function stripWorkerUsageMarkers(
  toolResultContent: string,
): string
```

Parsing rules:

- Scan line-by-line for lines starting with `CLAUDIAN_USAGE_EVENT=`.
- Parse the remainder of the line as JSON.
- Validate `version === 1`, `workerSessionId` is a non-empty string,
  `providerId` and `modelId` are non-empty strings, token fields are
  non-negative numbers.
- Ignore lines that fail validation (malformed JSON, missing required fields,
  wrong version). Never throw.
- `totalTokens` is read from the marker but also recomputed as
  `inputTokens + outputTokens + reasoningTokens` for consistency. If they
  differ, prefer the computed value (the marker's `totalTokens` is a
  convenience field).

### 2. `src/features/chat/controllers/StreamController.ts` — wire parser into `handleToolResult`

In `handleToolResult()` (line 570), after the existing subagent/task/agent
checks and before rendering the tool result content, scan for worker usage
markers:

```ts
private async handleToolResult(
  chunk: { type: 'tool_result'; id: string; content: string; isError?: boolean; toolUseResult?: SDKToolUseResult },
  msg: ChatMessage
): Promise<void>: Promise<void> {
  const { state, subagentManager } = this.deps;
  const normalizedContent = this.normalizeToolResultContent(chunk.content);

  // ...existing subagent/task/agent checks...

  // NEW: parse delegated worker usage markers before rendering
  const markers = parseWorkerUsageMarkers(normalizedContent);
  if (markers.length > 0) {
    // Strip markers from content so they don't render as assistant content
    const cleanedContent = stripWorkerUsageMarkers(normalizedContent);
    chunk = { ...chunk, content: cleanedContent };

    for (const marker of markers) {
      this.applyDelegatedWorkerUsage(marker, msg);
    }
  }

  // ...existing tool result rendering...
}
```

Add the contribution applier:

```ts
private applyDelegatedWorkerUsage(
  marker: ParsedWorkerUsageMarker,
  msg: ChatMessage,
): void {
  const conversation = this.deps.getConversationController()?.getCurrentConversation();
  if (!conversation) return;

  const service = this.deps.getSessionUsageService();
  let ledger = conversation.sessionUsage ?? service.createLedger(conversation.id);

  // Contribution id: workerSessionId + phase (idempotency key per spec)
  const contributionId = `${marker.workerSessionId}:${marker.phase ?? 'default'}`;
  const turnId = msg.id;  // attribute to the parent turn's assistant message

  const contribution: SessionUsageContributionInput = {
    providerId: marker.providerId,
    modelId: marker.modelId,
    ...(marker.effort ? { effort: marker.effort } : {}),
    turnId,
    inputTokens: marker.inputTokens,
    outputTokens: marker.outputTokens,
    reasoningTokens: marker.reasoningTokens,
    ...(marker.cachedInputTokens && marker.cachedInputTokens > 0
      ? { cachedInputTokens: marker.cachedInputTokens }
      : {}),
    completedAt: Date.now(),
  };

  // Use a source tag so the ledger can distinguish delegated-worker
  // contributions from provider-turn contributions for sorting.
  // SessionUsageService.applyContribution treats this as a replacement
  // by contribution id (workerSessionId:phase).
  const result = service.applyContribution(ledger, contribution, 'delegated-worker');
  if (result.changed) {
    ledger = result.ledger;
    conversation.sessionUsage = ledger;
    state.sessionUsageLedger = ledger;
    this.deps.getMessageRenderer()?.upsertSessionUsageFooter(
      state.currentAssistantMessageId,
      ledger,
      this.getOrchestratorProviderId(),
    );
    this.deps.getStatusPanel()?.renderSessionUsage(ledger);
  }
}
```

**Note on `SessionUsageService.applyContribution`:** The Phase 1 signature
takes `(ledger, contribution)`. Phase 3 extends it with an optional
`source: 'provider-turn' | 'delegated-worker'` parameter so the service can
tag the `SessionUsageContribution.source` field and use it for sorting
(delegated providers sort after the orchestrator provider per spec "Sorting").
If Phase 1 was already implemented without the `source` parameter, add it
here as a backward-compatible optional parameter.

### 3. `src/features/chat/services/SessionUsageService.ts` — sorting by source

Update `getDisplayRows()` (from Phase 1) to use the `source` field:

1. Orchestrator/current conversation provider rows first
   (`source: 'provider-turn'` + `providerId === orchestratorProviderId`).
2. Delegated provider rows next (`source: 'delegated-worker'`).
3. First-seen order within each class.

Rows are not split by OCG lane or phase — `lane` and `phase` remain
contribution metadata, not row keys. Plan and execute contributions for the
same `providerId + modelId + effort` combine into one row (the row key does
not include `phase`).

### 4. `src/features/chat/rendering/MessageRenderer.ts` — marker not rendered

`stripWorkerUsageMarkers()` (step 1) already removes marker lines from tool
result content before it reaches the renderer. No additional renderer change
is needed — the marker never enters `msg.content` or `contentBlocks`.

Confirm: the existing tool result rendering path
(`StreamController.handleToolResult` → `renderToolResult`) uses the
`normalizedContent` which has already been stripped. The marker is invisible
to the user.

## Cross-Repo Dependency (Out of Scope)

The `agent-worker` script (`70_LLM/scripts/agent-worker` in the Obsidian vault)
must emit the `CLAUDIAN_USAGE_EVENT=...` marker at the end of every worker run.
This is a cross-repo dependency documented in the spec but **not planned in
the Claudian repo**. The Claudian-side parser is in scope; the script emission
is not.

The marker contract (for the `agent-worker` implementer):

- One line, prefixed `CLAUDIAN_USAGE_EVENT=`, followed by a single JSON object.
- JSON fields: `version` (must be `1`), `workerSessionId` (string), `providerId`
  (string, e.g. `opencode-go`), `modelId` (string, exact runtime ID),
  `effort` (optional string), `lane` (optional string, metadata only),
  `phase` (optional string, e.g. `plan`/`execute`), `inputTokens` (number),
  `outputTokens` (number), `reasoningTokens` (number),
  `cachedInputTokens` (optional number), `totalTokens` (number).
- The marker is metadata only — must not include prompts, paths, auth data, or
  secrets.
- Multiple markers may be emitted (one per phase) — each must have a unique
  `workerSessionId + phase` combination.

## Tests

### `tests/unit/features/chat/services/WorkerUsageMarkerParser.test.ts` — new

- **Valid marker parsed:** single-line `CLAUDIAN_USAGE_EVENT={...}` with all
  required fields → returns one `ParsedWorkerUsageMarker`.
- **Multiple markers parsed:** multi-line content with two markers → returns
  two markers.
- **Malformed JSON ignored:** `CLAUDIAN_USAGE_EVENT={invalid json` → returns
  empty array, no throw.
- **Missing required fields ignored:** JSON without `workerSessionId` or
  `providerId` → ignored.
- **Wrong version ignored:** `version: 2` → ignored.
- **Marker stripped from content:** `stripWorkerUsageMarkers()` removes
  marker lines, preserves other content.
- **Non-marker lines preserved:** content with mixed lines → only marker lines
  stripped.
- **Truncated marker ignored:** line ends mid-JSON → ignored.
- **totalTokens recomputed:** marker with inconsistent `totalTokens` → parser
  uses `input + output + reasoning`.

### `tests/unit/features/chat/controllers/StreamController.test.ts` — extend

- **Marker in tool result → `session_usage` contribution applied:** tool
  result containing `CLAUDIAN_USAGE_EVENT=...` → ledger updated with
  `delegated-worker` contribution.
- **Marker stripped from rendered content:** tool result with marker →
  rendered content does not contain `CLAUDIAN_USAGE_EVENT`.
- **Duplicate workerSessionId+phase ignored:** two tool results with the same
  marker → ledger contribution applied once (idempotent).
- **Plan + execute same model → one row:** two markers with same
  `providerId + modelId + effort` but different `phase` → one ledger row with
  combined totals.
- **Marker from non-active turn ignored:** (edge case — if the tool result
  arrives after the turn completed, the contribution is still attributed to
  the parent turn's message id; test that it updates the ledger correctly).
- **Malformed marker does not break tool rendering:** tool result with
  malformed marker → tool result still renders normally (marker line stripped,
  other content preserved).

### `tests/unit/features/chat/services/SessionUsageService.test.ts` — extend

- **Delegated-worker contribution sorts after orchestrator:** rows with
  `source: 'delegated-worker'` appear after `source: 'provider-turn'` rows
  for the orchestrator provider.
- **Plan + execute same model combine into one row:** two contributions with
  same `providerId + modelId + effort` but different `phase`/`turnId` → one
  row, totals summed.
- **Delegated provider with unknown modelId renders without code changes.**

## Verification

```bash
npm run typecheck
npm run lint
npm test -- --runInBand \
  tests/unit/features/chat/services/WorkerUsageMarkerParser.test.ts \
  tests/unit/features/chat/controllers/StreamController.test.ts \
  tests/unit/features/chat/services/SessionUsageService.test.ts
npm run build
```

Manual acceptance (requires `agent-worker` marker emission — cross-repo):

1. Run an OCG plan worker from a Codex conversation.
2. Verify the plan worker's usage appears as a delegated row in the footer.
3. Run an OCG execute worker.
4. Verify the execute worker's usage merges into the same row (same
   model/effort) or creates a new row (different model/effort).
5. Verify the marker text is not visible in the tool result rendering.
6. Reload Obsidian → delegated contributions persisted in the ledger.
7. Run the same worker session again → duplicate ignored (idempotent).

If `agent-worker` marker emission is not yet implemented, test the Claudian
parser in isolation by sending a tool result with a synthetic marker via the
test suite.
