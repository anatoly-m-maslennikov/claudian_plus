# Eval / Test Plan — Feature 1: Tab Names Instead of Numbers

**Spec:** `your_harness_specs/1 - Spec/feature-1-tab-names-spec.md`
**Autotest detail:** `your_harness_specs/2 - Implementation Plan/autotest-plan.md` (Feature 1 section)

## Test Pyramid

| Level | What | Count | Notes |
|-------|------|-------|-------|
| Unit | `TabBar` rendering with `showTitle` field | 10 | Deterministic — mock DOM, no provider |
| Unit | `TabManager` propagation of `showTitle` from settings | 3 | Deterministic — mock plugin settings |

No integration or E2E needed — feature is pure rendering logic with no I/O.

## Deterministic Core vs Nondeterministic Edge

- **Deterministic core:** `TabBar.getBadgeLabel()`, `truncateTitle()`, `TabManager.getTabBarItems()` → `showTitle` field. All pure functions, no I/O, no clock, no network.
- **Nondeterministic edge:** None. No LLM, no provider, no async.

## Test Cases

### TabBar — titled badge rendering (10 cases)

1. `showTitle: true` renders truncated title (32-char cap with `...` suffix)
2. `showTitle: true` renders full title when ≤13 chars (no truncation)
3. `showTitle: true` blank tab shows `New Chat`
4. `showTitle: false` renders index number
5. `showTitle: true` + expanded → 32-char expanded title wins
6. `showTitle: false` + expanded → 32-char expanded title
7. `showTitle: true` applies `.claudian-tab-badge--titled` CSS class
8. `showTitle: false` does NOT apply `--titled` class
9. `aria-label` always carries full untruncated title
10. Double-click toggles `expandedTitleTabIds` (existing behavior preserved)

### TabManager — showTitle propagation (3 cases)

1. `showTabTitles: true` → `getTabBarItems()` sets `showTitle: true` on all items
2. `showTabTitles: false` → `showTitle: false` on all items
3. Setting change triggers `refreshTabControls()` on all views

## Acceptance Criteria (Agent-Verifiable)

- [ ] `npm run test -- --selectProjects unit -- tests/unit/features/chat/tabs/TabBar.test.ts` passes all 34 cases (24 existing + 10 new)
- [ ] `npm run test -- --selectProjects unit -- tests/unit/features/chat/tabs/TabManager.test.ts` passes all new `showTitle` cases
- [ ] `npm run typecheck && npm run lint` pass
- [ ] `npm run build` produces `main.js` + `styles.css` with no errors
