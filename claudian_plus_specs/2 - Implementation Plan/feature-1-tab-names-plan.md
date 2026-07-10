# Feature 1 — Implementation Plan: Tab Names Instead of Numbers

Reference spec: `AM Patch/1 - Spec/feature-1-tab-names-spec.md`

## Summary

Make chat tab badges show the conversation title by default (16-char cap)
instead of a 1-based index, gated by a new `showTabTitles` setting (default
`true`). Double-click toggle stays layered on top.

## Files to Change (8 source + i18n)

### 1. `src/core/types/settings.ts` — add setting field

In the "UI preferences" block near `maxTabs` (line 141):

```ts
showTabTitles: boolean;
```

### 2. `src/app/settings/defaultSettings.ts` — default value

Add to `DEFAULT_CLAUDIAN_SETTINGS` (after `maxTabs: 3,` at line 47):

```ts
showTabTitles: true,
```

### 3. `src/features/chat/tabs/types.ts` — extend `TabBarItem`

Add `showTitle: boolean` to the `TabBarItem` interface (line 277):

```ts
export interface TabBarItem {
  id: TabId;
  index: number;
  title: string;
  providerId: ProviderId;
  showTitle: boolean;   // <-- new
  isActive: boolean;
  isStreaming: boolean;
  needsAttention: boolean;
  canClose: boolean;
}
```

### 4. `src/features/chat/tabs/TabManager.ts` — populate `showTitle`

In `getTabBarItems()` (line 397), set `showTitle` from settings:

```ts
items.push({
  id: tab.id,
  index: index++,
  title: getTabTitle(tab, this.plugin),
  providerId: getTabProviderId(tab, this.plugin),
  showTitle: this.plugin.settings.showTabTitles ?? true,   // <-- new
  isActive: tab.id === this.activeTabId,
  isStreaming: tab.state.isStreaming,
  needsAttention: tab.state.needsAttention,
  canClose: this.tabs.size > 1 || !tab.state.isStreaming,
});
```

### 5. `src/features/chat/tabs/TabBar.ts` — render titled badges

**New constants** (top of file, alongside existing `EXPANDED_TITLE_MAX_LENGTH`):

```ts
const DEFAULT_TITLE_MAX_LENGTH = 16;
```

**`getBadgeLabel(item)`** (line 163) — add the setting-on default path:

```ts
private getBadgeLabel(item: TabBarItem): string {
  if (this.expandedTitleTabIds.has(item.id)) {
    return this.truncateTitle(item.title, EXPANDED_TITLE_MAX_LENGTH);
  }
  if (item.showTitle) {
    return this.truncateTitle(item.title, DEFAULT_TITLE_MAX_LENGTH);
  }
  return String(item.index);
}
```

**Rename** `truncateExpandedTitle` → `truncateTitle(title, maxLength)` so it
takes a length parameter (used by both 16-char default and 32-char expanded).

**`renderBadge(item)`** (line 63) — add the `--titled` modifier class when
`item.showTitle` is true and the badge is not dblclick-expanded:

```ts
const isTitleExpanded = this.expandedTitleTabIds.has(item.id);
const isTitled = item.showTitle && !isTitleExpanded;
const badgeEl = this.containerEl.createDiv({
  cls: [
    'claudian-tab-badge',
    stateClass,
    isTitled ? 'claudian-tab-badge--titled' : '',
    isTitleExpanded ? 'claudian-tab-badge-expanded' : '',
  ].filter(Boolean).join(' '),
  text: this.getBadgeLabel(item),
});
```

**`toggleBadgeTitle`** (line 150) — when toggling, also recompute the `--titled`
class (expanded wins):

```ts
const isTitleExpanded = this.expandedTitleTabIds.has(item.id);
const isTitled = item.showTitle && !isTitleExpanded;
badgeEl.textContent = this.getBadgeLabel(item);
badgeEl.toggleClass('claudian-tab-badge--titled', isTitled);
badgeEl.toggleClass('claudian-tab-badge-expanded', isTitleExpanded);
badgeEl.setAttribute('data-title-expanded', isTitleExpanded ? 'true' : 'false');
```

### 6. `src/style/components/tabs.css` — titled badge sizing

Add after `.claudian-tab-badge` (line 28), before
`.claudian-tab-badge-expanded`:

```css
.claudian-tab-badge--titled {
  flex: 0 0 auto;
  width: auto;
  max-width: 140px;
  padding: 0 6px;
}
```

This keeps the 24×24 numeric style untouched when `showTitle` is false, and
gives titled badges auto width capped at ~16 chars. The bar's existing
`overflow-x: auto` handles overflow.

### 7. `src/features/settings/ClaudianSettings.ts` — setting toggle

Under the "Display" heading, after the `maxTabs` slider (line 237), add:

```ts
new Setting(container)
  .setName(t('settings.showTabTitles.name'))
  .setDesc(t('settings.showTabTitles.desc'))
  .addToggle((toggle) =>
    toggle
      .setValue(this.plugin.settings.showTabTitles ?? true)
      .onChange(async (value) => {
        this.plugin.settings.showTabTitles = value;
        await this.plugin.saveSettings();
        for (const view of this.plugin.getAllViews()) {
          view.refreshTabControls();
        }
      })
  );
```

### 8. i18n — all 10 locales + types

**`src/i18n/types.ts`** — add to the union:

```ts
| 'settings.showTabTitles.name'
| 'settings.showTabTitles.desc'
```

**`src/i18n/locales/en.json`** — under `settings`:

```json
"showTabTitles": {
  "name": "Show tab titles",
  "desc": "Label chat tabs with conversation titles instead of numbers. Double-click a tab to toggle its label."
}
```

**Other 9 locales** (`de.json`, `es.json`, `fr.json`, `ja.json`, `ko.json`,
`pt.json`, `ru.json`, `zh-CN.json`, `zh-TW.json`) — add the same key with
translated `name`/`desc`. English fallback is acceptable if translations are
not ready; the key must exist to satisfy the i18n type checker.

## Tests to Update (2 files)

### `tests/unit/features/chat/tabs/TabBar.test.ts`

Update `createTabBarItem` helper (line 16) to default `showTitle: false` —
this keeps all existing index-rendering tests green without modification.

Add new test cases:

1. **`showTitle: true` renders truncated title by default** —
   `createTabBarItem({ showTitle: true, title: 'Refactor auth flow' })` →
   badge text is `Refactor auth…` (16-char cap, `…` suffix).

2. **`showTitle: true` with short title renders full title** —
   `createTabBarItem({ showTitle: true, title: 'Bug fix' })` → badge text is
   `Bug fix` (no truncation).

3. **`showTitle: true` applies `--titled` class** — assert
   `badge.hasClass('claudian-tab-badge--titled')` is true.

4. **`showTitle: false` does not apply `--titled` class** — assert
   `badge.hasClass('claudian-tab-badge--titled')` is false.

5. **dblclick on `showTitle: true` badge expands to 32-char limit** —
   `createTabBarItem({ showTitle: true, title: 40-char string })`, dblclick →
   badge text is 32 chars + `…`; `--titled` class removed; `--expanded` class
   added.

6. **dblclick toggle off returns to 16-char titled mode** — after expanding,
   dblclick again → badge text is 16 chars + `…`; `--titled` re-added;
   `--expanded` removed.

7. **`showTitle: false` dblclick still expands to title** (existing behavior
   preserved) — update the existing dblclick test to set `showTitle: false`
   explicitly if the helper default changes.

### `tests/unit/features/chat/tabs/TabManager.test.ts`

In the `getTabBarItems` describe block (line 622):

1. **`showTitle` defaults to true when setting is unset** —
   set `plugin.settings.showTabTitles = undefined` → items have
   `showTitle: true` (fallback to default).

2. **`showTitle` reflects setting value** —
   set `plugin.settings.showTabTitles = false` → items have
   `showTitle: false`.

3. **`showTitle` is true when setting is true** — explicit true case.

## Verification

```bash
npm run typecheck
npm run lint
npm test -- --selectProjects unit -- \
  tests/unit/features/chat/tabs/TabBar.test.ts \
  tests/unit/features/chat/tabs/TabManager.test.ts
npm run build
```

Manual acceptance:

1. Open multiple tabs with conversations — badges show titles.
2. Open a blank tab — badge shows `New Chat`.
3. Settings → Display → toggle "Show tab titles" off — badges switch to
   numbers immediately.
4. Toggle back on — badges switch to titles.
5. Double-click a titled badge — expands to 32-char title.
6. Double-click again — returns to 16-char titled mode.
7. Open enough tabs to overflow — bar scrolls horizontally.
8. Hover a badge — tooltip shows full untruncated title.
