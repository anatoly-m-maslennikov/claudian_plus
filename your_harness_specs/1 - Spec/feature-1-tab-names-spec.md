# Feature 1 — Tab Names Instead of Numbers

## Goal

Chat tab badges in the Claudian sidebar show the conversation title by default
(truncated to ~16 characters) instead of a 1-based index number. A new boolean
setting controls the default; double-click still toggles per-tab.

## Background

Today, `TabBar.getBadgeLabel()` (`src/features/chat/tabs/TabBar.ts:163`) returns
`String(item.index)` — a number — for every badge. The full conversation title
only appears when a user double-clicks a badge, which adds the tab id to
`expandedTitleTabIds` and switches the badge to the 32-char expanded mode.

The titles already exist: `getTabTitle()` (`src/features/chat/tabs/Tab.ts:1684`)
returns `conversation.title` for bound tabs and `'New Chat'` for blank tabs.
`TabManager.getTabBarItems()` (`src/features/chat/tabs/TabManager.ts:397`)
already populates `TabBarItem.title`. The data is there; only the rendering
defaults and CSS sizing need to change.

## User Stories

- As a user, I see each tab labeled with its conversation title (or `New Chat`
  for a new/blank tab) so I can identify tabs without hovering.
- As a user, I can flip a setting off to revert to numbered badges if I prefer
  the compact numeric style.
- As a user, I can still double-click any badge to toggle between title and
  number for that individual tab, regardless of the global setting.
- As a user, the full untruncated title remains available via the tooltip
  (`aria-label`) on hover.

## Functional Requirements

1. **New setting** `showTabTitles: boolean` (default `true`) added to
   `ClaudianSettings` (`src/core/types/settings.ts`).
2. **When `true` (default):** badge label = truncated title, capped at 16
   characters with a literal `…` suffix for overflow. Blank tabs show
   `New Chat`.
3. **When `false`:** badge label = `String(item.index)` (today's behavior).
4. **Double-click toggle** continues to work layered on top of the setting.
   Double-clicking a badge adds/removes it from `expandedTitleTabIds`:
   - When the setting is `true` and the tab is expanded → keep the 32-char
     expanded limit (expanded wins over the 16-char default).
   - When the setting is `false` and the tab is expanded → show the 32-char
     title (same as today).
   - When the tab is not expanded → show the index number (same as today).
5. **Tooltip** (`aria-label`) keeps the full untruncated title — unchanged.
6. **Setting location:** Settings → Display, next to "Maximum chat tabs"
   (`src/features/settings/ClaudianSettings.ts:208`).
7. **Setting toggle** calls `view.refreshTabControls()` on all views so the
   badges re-render immediately, matching how `maxTabs` propagates.

## Non-Functional Requirements

- **No data shape change:** `TabBarItem` (`src/features/chat/tabs/types.ts:277`)
  already carries `title` and `index`. A new `showTitle: boolean` field is added
  so `TabBar` stays dumb (no settings access in the rendering layer).
- **CSS:** introduce a modifier class `.claudian-tab-badge--titled` applied when
  `item.showTitle` is true. It switches the badge from the fixed 24×24 numeric
  style to `width: auto; max-width: 140px;` (fits ~16 chars at 12px font). The
  existing 24×24 numeric style stays untouched for the setting-off path. The
  bar already has `overflow-x: auto` for horizontal scroll when titled badges
  overflow.
- **Backward compatible:** missing setting → default `true`. No migration
  needed; `defaultSettings.ts` adds the key with `true`.
- **No changes** to `TabManager.getTabBarItems()` data flow beyond populating
  the new `showTitle` field from `plugin.settings.showTabTitles`.

## Out of Scope

- Per-tab pinning of label mode (the dblclick toggle is per-tab but not
  persisted across reloads — unchanged from today).
- Renaming tabs in-place.
- Changing `getTabTitle()` fallback logic (`'New Chat'` stays).
- Changing the tab bar overflow behavior (still horizontal scroll).
- Changing the dblclick expand/collapse mechanism itself.

## Acceptance Criteria

- [ ] With `showTabTitles` on (default), each badge shows the conversation
  title truncated at 16 chars with `…` suffix for overflow.
- [ ] Blank tabs show `New Chat`.
- [ ] With `showTabTitles` off, badges show the 1-based index (today's
  behavior).
- [ ] Double-clicking a badge toggles between title (32-char cap) and the
  setting-default label for that tab.
- [ ] Hover tooltip shows the full untruncated title.
- [ ] Toggling the setting re-renders all tab badges immediately.
- [ ] Bar scrolls horizontally when titled tabs exceed the available width.
- [ ] `npm run typecheck && npm run lint && npm run test && npm run build` pass.
