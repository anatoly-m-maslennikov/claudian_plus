import { Notice, setIcon } from 'obsidian';

import type { TabId } from '../tabs/types';

export interface TmuxCommandCallbacks {
  getTabCount: () => number;
  getActiveTabId: () => TabId | null;
  getActiveTabIndex: () => number;
  switchToTab: (tabId: TabId) => void;
  switchToAdjacentTab: (direction: 1 | -1) => void;
  switchToTabIndex: (index: number) => void;
  closeTab: (tabId: TabId) => void;
  createTab: () => void;
  renameTab: (tabId: TabId) => void;
  showTabsList: () => void;
  showSessionsList: () => void;
  toggleLastTab: () => void;
  cycleTabs: () => void;
  findTab: () => void;
  renameConversation: () => void;
  moveTab: () => void;
  showHelp: () => void;
}

interface TmuxPrefixOptions {
  enabled: boolean;
  prefixKey: string; // e.g. 'ctrl-b'
  callbacks: TmuxCommandCallbacks;
  indicatorEl: HTMLElement;
  timeoutMs?: number;
}

const DEFAULT_TIMEOUT_MS = 1500;

export const TMUX_COMMAND_KEYS: Record<string, string> = {
  ',': 'rename-tab',
  '1': 'switch-tab-1',
  '2': 'switch-tab-2',
  '3': 'switch-tab-3',
  '4': 'switch-tab-4',
  '5': 'switch-tab-5',
  '6': 'switch-tab-6',
  '7': 'switch-tab-7',
  '8': 'switch-tab-8',
  '9': 'switch-tab-9',
  'p': 'prev-tab',
  'n': 'next-tab',
  ' ': 'next-tab',
  'x': 'kill-tab',
  'c': 'new-tab',
  'w': 'list-tabs',
  's': 'list-sessions',
  'l': 'last-tab',
  'o': 'cycle-tabs',
  'f': 'find-tab',
  '$': 'rename-session',
  '.': 'move-tab',
  '?': 'show-help',
  'q': 'dismiss',
};

export class TmuxPrefixHandler {
  private enabled: boolean;
  private prefixKey: string;
  private callbacks: TmuxCommandCallbacks;
  private indicatorEl: HTMLElement;
  private timeoutMs: number;
  private waitingForCommand = false;
  private timeoutHandle: ReturnType<typeof setTimeout> | null = null;

  constructor(options: TmuxPrefixOptions) {
    this.enabled = options.enabled;
    this.prefixKey = options.prefixKey;
    this.callbacks = options.callbacks;
    this.indicatorEl = options.indicatorEl;
    this.timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  }

  setEnabled(enabled: boolean): void {
    this.enabled = enabled;
    if (!enabled) this.cancelWaiting();
  }

  setPrefixKey(key: string): void {
    this.prefixKey = key;
  }

  /**
   * Check if this key event is the tmux prefix key.
   * If so, enter waiting state and return true (consumed).
   * If in waiting state, route the command key and return true.
   * Otherwise return false (not handled).
   */
  handlePrefixKey(e: KeyboardEvent): boolean {
    if (!this.enabled) return false;

    if (this.waitingForCommand) {
      return this.handleCommandKey(e);
    }

    const eventKey = `ctrl-${e.key.toLowerCase()}`;
    if (this.prefixKey && eventKey === this.prefixKey) {
      e.preventDefault();
      this.enterWaitingState();
      return true;
    }

    return false;
  }

  isWaiting(): boolean {
    return this.waitingForCommand;
  }

  private enterWaitingState(): void {
    this.waitingForCommand = true;
    this.indicatorEl.addClass('claudian-tmux-prefix-active');
    this.indicatorEl.setText('tmux prefix — press a command key');
    this.indicatorEl.removeClass('claudian-hidden');

    this.timeoutHandle = window.setTimeout(() => {
      this.cancelWaiting();
    }, this.timeoutMs);
  }

  private cancelWaiting(): void {
    this.waitingForCommand = false;
    this.indicatorEl.removeClass('claudian-tmux-prefix-active');
    this.indicatorEl.addClass('claudian-hidden');
    this.indicatorEl.setText('');
    if (this.timeoutHandle) {
      window.clearTimeout(this.timeoutHandle);
      this.timeoutHandle = null;
    }
  }

  private handleCommandKey(e: KeyboardEvent): boolean {
    e.preventDefault();

    // Cancel timeout
    if (this.timeoutHandle) {
      window.clearTimeout(this.timeoutHandle);
      this.timeoutHandle = null;
    }

    const key = e.key;
    const wasWaiting = this.waitingForCommand;
    this.waitingForCommand = false;
    this.indicatorEl.removeClass('claudian-tmux-prefix-active');
    this.indicatorEl.addClass('claudian-hidden');
    this.indicatorEl.setText('');

    if (!wasWaiting) return true;

    // Ctrl-B pressed again while waiting = toggle last tab (tmux behavior)
    if (`ctrl-${key.toLowerCase()}` === this.prefixKey) {
      this.callbacks.toggleLastTab();
      return true;
    }

    const command = TMUX_COMMAND_KEYS[key.toLowerCase()];
    if (!command) {
      // Unrecognized key — cancel silently
      return true;
    }

    this.executeCommand(command);
    return true;
  }

  private executeCommand(command: string): void {
    switch (command) {
      case 'rename-tab': {
        const activeId = this.callbacks.getActiveTabId();
        if (activeId) this.callbacks.renameTab(activeId);
        break;
      }
      case 'switch-tab-1':
      case 'switch-tab-2':
      case 'switch-tab-3':
      case 'switch-tab-4':
      case 'switch-tab-5':
      case 'switch-tab-6':
      case 'switch-tab-7':
      case 'switch-tab-8':
      case 'switch-tab-9': {
        const index = parseInt(command.split('-').pop() ?? '', 10) - 1;
        if (index < this.callbacks.getTabCount()) {
          this.callbacks.switchToTabIndex(index);
        }
        break;
      }
      case 'prev-tab':
        this.callbacks.switchToAdjacentTab(-1);
        break;
      case 'next-tab':
        this.callbacks.switchToAdjacentTab(1);
        break;
      case 'kill-tab': {
        const activeId = this.callbacks.getActiveTabId();
        if (activeId && this.callbacks.getTabCount() > 1) {
          this.callbacks.closeTab(activeId);
        } else {
          new Notice('Cannot close the last tab');
        }
        break;
      }
      case 'new-tab':
        this.callbacks.createTab();
        break;
      case 'list-tabs':
        this.callbacks.showTabsList();
        break;
      case 'list-sessions':
        this.callbacks.showSessionsList();
        break;
      case 'last-tab':
        this.callbacks.toggleLastTab();
        break;
      case 'cycle-tabs':
        this.callbacks.cycleTabs();
        break;
      case 'find-tab':
        this.callbacks.findTab();
        break;
      case 'rename-session':
        this.callbacks.renameConversation();
        break;
      case 'move-tab':
        this.callbacks.moveTab();
        break;
      case 'show-help':
        this.callbacks.showHelp();
        break;
      case 'dismiss':
        // Just cancel — already done above
        break;
      default:
        break;
    }
  }

  destroy(): void {
    this.cancelWaiting();
  }
}

/**
 * Show a help notice with all tmux keybindings.
 */
export function showTmuxHelp(prefixKey: string): void {
  const help = [
    `Tmux keybindings (prefix: ${prefixKey})`,
    '',
    '  ,     Rename current tab',
    '  1-9   Switch to tab N',
    '  p      Previous tab',
    '  n      Next tab',
    '  Space  Next tab',
    '  x      Kill tab (with confirmation)',
    '  c      Create new tab',
    '  w      List tabs',
    '  s      List sessions (conversations)',
    '  l      Toggle last active tab',
    '  o      Cycle tabs',
    '  f      Find tab by name',
    '  $      Rename conversation',
    '  .      Move tab to new position',
    '  ?      Show this help',
    '  q      Dismiss dropdown',
  ].join('\n');

  new Notice(help, 0);
}
