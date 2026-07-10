import { scheduleAnimationFrame } from '../../../utils/animationFrame';
import type { TabBarItem, TabId } from './types';

const EXPANDED_TITLE_MAX_LENGTH = 48;
const DEFAULT_TITLE_MAX_LENGTH = 32;
const TRUNCATED_TITLE_SUFFIX = '...';

/** Callbacks for TabBar interactions. */
export interface TabBarCallbacks {
  /** Called when a tab badge is clicked. */
  onTabClick: (tabId: TabId) => void;

  /** Called when the close button is clicked on a tab. */
  onTabClose: (tabId: TabId) => void;

  /** Called when the new tab button is clicked. */
  onNewTab: () => void;

  /** Called when the context menu is requested on a tab. */
  onTabContextMenu: (tabId: TabId, item: TabBarItem, event: MouseEvent) => void;

  /** Called when a tab is dragged to a new position. */
  onTabMove: (fromIndex: number, toIndex: number) => void;
}

/**
 * TabBar renders minimal numbered badge navigation.
 */
export class TabBar {
  private containerEl: HTMLElement;
  private callbacks: TabBarCallbacks;
  private expandedTitleTabIds = new Set<TabId>();
  private lastKnownScrollLeft = 0;
  private dragTabId: TabId | null = null;
  private dragOverTabId: TabId | null = null;
  private readonly handleScroll = (): void => {
    this.captureScrollPosition();
  };

  constructor(containerEl: HTMLElement, callbacks: TabBarCallbacks) {
    this.containerEl = containerEl;
    this.callbacks = callbacks;
    this.build();
  }

  /** Builds the tab bar UI. */
  private build(): void {
    this.containerEl.addClass('claudian-tab-badges');
    this.containerEl.addEventListener('scroll', this.handleScroll);
  }

  /**
   * Updates the tab bar with new tab data.
   * @param items Tab items to render.
   */
  update(items: TabBarItem[]): void {
    this.captureStableScrollPosition();
    this.pruneExpandedTitleState(items);

    // Clear existing badges
    this.containerEl.empty();

    // Render badges
    for (const item of items) {
      this.renderBadge(item);
    }

    this.restoreScrollPosition();
  }

  /** Renders a single tab badge. */
  private renderBadge(item: TabBarItem): void {
    // Determine state class (priority: active > attention > streaming > idle)
    let stateClass = 'claudian-tab-badge-idle';
    if (item.isActive) {
      stateClass = 'claudian-tab-badge-active';
    } else if (item.needsAttention) {
      stateClass = 'claudian-tab-badge-attention';
    } else if (item.isStreaming) {
      stateClass = 'claudian-tab-badge-streaming';
    }

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

    // Obsidian uses aria-label for hover tooltips here; adding title causes duplicate tooltip text.
    badgeEl.setAttribute('data-tab-id', item.id);
    badgeEl.setAttribute('aria-label', item.title);
    badgeEl.setAttribute('data-provider', item.providerId);
    badgeEl.setAttribute('data-title-expanded', isTitleExpanded ? 'true' : 'false');

    // Click handler to switch tab
    badgeEl.addEventListener('click', () => {
      this.captureScrollPosition();
      this.callbacks.onTabClick(item.id);
    });

    badgeEl.addEventListener('dblclick', (e) => {
      e.preventDefault();
      e.stopPropagation();
      this.toggleBadgeTitle(item, badgeEl);
    });

    // Right-click context menu
    badgeEl.addEventListener('contextmenu', (e) => {
      e.preventDefault();
      this.callbacks.onTabContextMenu(item.id, item, e);
    });

    // Drag-and-drop tab reordering
    badgeEl.setAttribute('draggable', 'true');

    badgeEl.addEventListener('dragstart', (e) => {
      this.dragTabId = item.id;
      badgeEl.addClass('claudian-tab-badge-dragging');
      if (e.dataTransfer) {
        e.dataTransfer.effectAllowed = 'move';
        e.dataTransfer.setData('text/plain', item.id);
      }
    });

    badgeEl.addEventListener('dragend', () => {
      badgeEl.removeClass('claudian-tab-badge-dragging');
      this.clearDragOverStyles();
      this.dragTabId = null;
      this.dragOverTabId = null;
    });

    badgeEl.addEventListener('dragover', (e) => {
      e.preventDefault();
      if (!this.dragTabId || this.dragTabId === item.id) return;
      if (e.dataTransfer) e.dataTransfer.dropEffect = 'move';
      this.dragOverTabId = item.id;
      badgeEl.addClass('claudian-tab-badge-drag-over');
    });

    badgeEl.addEventListener('dragleave', () => {
      badgeEl.removeClass('claudian-tab-badge-drag-over');
    });

    badgeEl.addEventListener('drop', (e) => {
      e.preventDefault();
      this.clearDragOverStyles();
      if (!this.dragTabId || this.dragTabId === item.id) return;

      const draggedEl = this.findBadgeById(this.dragTabId);
      const targetEl = badgeEl;
      if (draggedEl && targetEl) {
        const children = Array.from(this.containerEl.children);
        const from = children.indexOf(draggedEl);
        const to = children.indexOf(targetEl);
        if (from !== -1 && to !== -1 && from !== to) {
          this.callbacks.onTabMove(from, to);
        }
      }
      this.dragTabId = null;
      this.dragOverTabId = null;
    });
  }

  private findBadgeById(tabId: TabId): HTMLElement | null {
    for (const child of Array.from(this.containerEl.children)) {
      if (child.getAttribute('data-tab-id') === tabId) {
        return child as HTMLElement;
      }
    }
    return null;
  }

  private clearDragOverStyles(): void {
    for (const child of Array.from(this.containerEl.children)) {
      child.removeClass('claudian-tab-badge-drag-over');
    }
  }

  /** Destroys the tab bar. */
  destroy(): void {
    this.containerEl.empty();
    this.containerEl.removeClass('claudian-tab-badges');
    this.containerEl.removeEventListener('scroll', this.handleScroll);
    this.expandedTitleTabIds.clear();
    this.lastKnownScrollLeft = 0;
  }

  captureScrollPosition(): void {
    this.lastKnownScrollLeft = this.containerEl.scrollLeft;
  }

  restoreScrollPosition(): void {
    const scrollLeft = this.lastKnownScrollLeft;
    this.containerEl.scrollLeft = scrollLeft;
    if (scrollLeft <= 0) return;

    scheduleAnimationFrame(() => {
      if (this.containerEl.scrollLeft !== 0) return;
      this.containerEl.scrollLeft = scrollLeft;
    }, this.containerEl.ownerDocument.defaultView ?? null);
  }

  private captureStableScrollPosition(): void {
    const currentScrollLeft = this.containerEl.scrollLeft;
    if (currentScrollLeft > 0 || this.lastKnownScrollLeft === 0) {
      this.lastKnownScrollLeft = currentScrollLeft;
    }
  }

  private pruneExpandedTitleState(items: TabBarItem[]): void {
    const visibleTabIds = new Set(items.map(item => item.id));
    for (const tabId of this.expandedTitleTabIds) {
      if (!visibleTabIds.has(tabId)) {
        this.expandedTitleTabIds.delete(tabId);
      }
    }
  }

  private toggleBadgeTitle(item: TabBarItem, badgeEl: HTMLElement): void {
    if (this.expandedTitleTabIds.has(item.id)) {
      this.expandedTitleTabIds.delete(item.id);
    } else {
      this.expandedTitleTabIds.add(item.id);
    }

    const isTitleExpanded = this.expandedTitleTabIds.has(item.id);
    const isTitled = item.showTitle && !isTitleExpanded;
    badgeEl.textContent = this.getBadgeLabel(item);
    badgeEl.toggleClass('claudian-tab-badge--titled', isTitled);
    badgeEl.toggleClass('claudian-tab-badge-expanded', isTitleExpanded);
    badgeEl.setAttribute('data-title-expanded', isTitleExpanded ? 'true' : 'false');
  }

  private getBadgeLabel(item: TabBarItem): string {
    if (this.expandedTitleTabIds.has(item.id)) {
      return this.truncateTitle(item.title, EXPANDED_TITLE_MAX_LENGTH);
    }
    if (item.showTitle) {
      return this.truncateTitle(item.title, DEFAULT_TITLE_MAX_LENGTH);
    }
    return String(item.index);
  }

  private truncateTitle(title: string, maxLength: number): string {
    const chars = Array.from(title);
    if (chars.length <= maxLength) {
      return title;
    }

    return `${chars.slice(0, maxLength - TRUNCATED_TITLE_SUFFIX.length).join('')}${TRUNCATED_TITLE_SUFFIX}`;
  }
}
