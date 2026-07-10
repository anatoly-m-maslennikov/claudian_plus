# Eval / Test Plan — Feature 2: Cumulative Session Usage Footer

**Spec:** `claudian_plus_specs/1 - Spec/feature-2-usage-footer-spec.md`
**Autotest detail:** `claudian_plus_specs/2 - Implementation Plan/autotest-plan.md` (Feature 2 section)

## Test Pyramid

| Level | What | Count | Notes |
|-------|------|-------|-------|
| Unit — core ledger | `SessionUsageService` applyContribution, applyFiveHourWindow, getDisplayRows, dedup | ~15 | Deterministic — pure service, no I/O |
| Unit — formatting | `sessionUsageFormat` compactTokens, formatSessionUsageRow, formatSessionUsage | ~12 | Deterministic — pure functions |
| Unit — Codex router | `CodexNotificationRouter` session_usage emission, delta calculation, modelId propagation | ~10 | Deterministic — mock notifications |
| Unit — Codex tail | `CodexSessionFileTail` pendingUsageByTurn, cumulative tracking | ~5 | Deterministic — mock transcript lines |
| Unit — Codex reconstruction | `reconstructCodexSessionUsage` cumulative delta from transcript | ~7 | Deterministic — mock JSONL lines |
| Unit — OpenCode | `OpencodeSqliteReader.loadOpencodeSessionUsageAggregation`, `OpencodeChatRuntime.buildSessionUsageContribution` | ~5 | Deterministic — mock SQLite |
| Unit — OCG workers | `WorkerUsageMarkerParser` marker parsing + stripping | ~4 | Deterministic — mock tool output strings |
| Unit — Claude/Pi | `maybeEmitSessionUsageFromPromptUsage`, `PiChatRuntime.buildSessionUsageContribution` | ~4 | Deterministic — mock PromptUsageSnapshot |
| Unit — StreamController | `handleStreamChunk` session_usage handling, `handleToolResult` marker stripping | ~3 | Deterministic — mock chunks |

**Total: ~55+ unit test cases across 10+ files**

No integration or E2E needed — all provider interactions are mocked at the notification/RPC boundary.

## Deterministic Core vs Nondeterministic Edge

- **Deterministic core:** `SessionUsageService` (ledger math), `sessionUsageFormat` (display), `WorkerUsageMarkerParser` (regex parsing), `reconstructCodexSessionUsage` (JSONL parsing). All pure, no I/O, no clock, no network.
- **Nondeterministic edge:** Provider notifications (Codex JSON-RPC, OpenCode ACP, Claude SDK). Mocked at the notification boundary — real provider behavior is not tested here (would require live provider access).

## Key Test Properties

### SessionUsageService — Ledger Invariants

- **Idempotency:** `applyContribution(applyContribution(ledger, c), c)` == `applyContribution(ledger, c)` — same contribution applied twice does not double-count.
- **Turn dedup:** Two contributions with same `turnId + providerId + modelId + effort` → second replaces (not adds) first.
- **Row aggregation:** Contributions with same `providerId + modelId + effort` aggregate into one row; `totalTokens = inputTokens + outputTokens + reasoningTokens`.
- **Sort order:** Orchestrator/current-conversation provider rows first, then delegated rows, then first-seen order.

### CodexNotificationRouter — Delta Correctness

- **First turn:** delta = cumulative (previous = null/0).
- **Second turn:** delta = cumulative₂ - cumulative₁ (not full cumulative₂).
- **Cross-turn persistence:** `previousCumulativeTotal` persists in `CodexChatRuntime`, not reset per `beginTurn` unless explicitly passed.
- **Model ID propagation:** `turnModelId` flows into `contribution.modelId`; falls back to `'unknown'` when absent.

### sessionUsageFormat — Display Invariants

- **Compact tokens:** `<1000` as-is, `<1M` → `Nk`, `≥1M` → `N.NM`.
- **Empty modelId:** When both `displayName` and `modelId` are empty, name segment omitted (no double space).
- **No account-wide cost:** `fiveHourWindow` removed from display (global, not per-session).

## Acceptance Criteria (Agent-Verifiable)

- [ ] `npm run test -- --selectProjects unit` passes all 5640+ tests (pre-existing + new)
- [ ] `npm run test -- --selectProjects unit -- tests/unit/features/chat/services/SessionUsageService.test.ts` passes
- [ ] `npm run test -- --selectProjects unit -- tests/unit/features/chat/utils/sessionUsageFormat.test.ts` passes
- [ ] `npm run test -- --selectProjects unit -- tests/unit/providers/codex/runtime/CodexNotificationRouter.test.ts` passes
- [ ] `npm run test -- --selectProjects unit -- tests/unit/providers/codex/history/codexSessionUsageReconstruction.test.ts` passes
- [ ] `npm run typecheck && npm run lint` pass
- [ ] `npm run build` produces `main.js` + `styles.css` with no errors
