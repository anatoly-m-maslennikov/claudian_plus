import { createMockEl } from '@test/helpers/mockElement';

import type { ProviderCommandDropdownConfig } from '@/core/providers/commands/ProviderCommandCatalog';
import type { ProviderCommandEntry } from '@/core/providers/commands/ProviderCommandEntry';
import {
  SlashCommandDropdown,
  type SlashCommandDropdownCallbacks,
} from '@/shared/components/SlashCommandDropdown';

jest.mock('@/core/commands/builtInCommands', () => ({
  getBuiltInCommandsForDropdown: jest.fn(() => [
    { id: 'builtin:clear', name: 'clear', description: 'Start a new conversation', content: '' },
  ]),
}));

function createMockInput(): any {
  return {
    value: '',
    selectionStart: 0,
    selectionEnd: 0,
    focus: jest.fn(),
    addEventListener: jest.fn(),
    removeEventListener: jest.fn(),
  };
}

function createMockCallbacks(): SlashCommandDropdownCallbacks {
  return {
    onSelect: jest.fn(),
    onHide: jest.fn(),
  };
}

function getRenderedVaultPaths(containerEl: any): string[] {
  const dropdownEl = containerEl.children.find(
    (c: any) => c.hasClass('claudian-slash-dropdown')
  );
  if (!dropdownEl) return [];
  const items = dropdownEl.querySelectorAll('.claudian-slash-item');
  return items.map((item: any) => {
    const nameSpan = item.children.find((c: any) => c.hasClass('claudian-slash-name'));
    return nameSpan?.textContent ?? '';
  });
}

function isDropdownVisible(containerEl: any): boolean {
  const dropdownEl = containerEl.children.find(
    (c: any) => c.hasClass('claudian-slash-dropdown')
  );
  return dropdownEl?.hasClass('visible') ?? false;
}

const CLAUDE_CONFIG: ProviderCommandDropdownConfig = {
  providerId: 'claude',
  triggerChars: ['/'],
  builtInPrefix: '/',
  skillPrefix: '/',
  commandPrefix: '/',
};

const CODEX_CONFIG: ProviderCommandDropdownConfig = {
  providerId: 'codex',
  triggerChars: ['/', '$'],
  builtInPrefix: '/',
  skillPrefix: '$',
  commandPrefix: '/',
};

function makeEntry(name: string): ProviderCommandEntry {
  return {
    id: `cmd-${name}`, providerId: 'claude', kind: 'command', name,
    description: '', content: '', scope: 'runtime', source: 'sdk',
    isEditable: false, isDeletable: false, displayPrefix: '/', insertPrefix: '/',
  };
}

const PROVIDER_ENTRIES: ProviderCommandEntry[] = [
  makeEntry('commit'),
  makeEntry('review'),
];

const VAULT_PATHS = [
  '51_DEV/',
  '52_LLM/',
  'README.md',
  'todo.md',
];

const VAULT_PATHS_IN_DEV = [
  '51_DEV/00_META/',
  '51_DEV/01_Projects/',
  '51_DEV/index.md',
];

function mockGetVaultPaths(searchPath: string): Promise<string[]> {
  if (searchPath === '' || searchPath === '/') {
    return Promise.resolve(VAULT_PATHS);
  }
  if (searchPath === 'dev' || searchPath === 'DEV') {
    return Promise.resolve(['51_DEV/']);
  }
  if (searchPath === '51_DEV/' || searchPath === '51_DEV') {
    return Promise.resolve(VAULT_PATHS_IN_DEV);
  }
  if (searchPath === '51_DEV/00_META/') {
    return Promise.resolve(['51_DEV/00_META/methodology.md', '51_DEV/00_META/playbook.md']);
  }
  return Promise.resolve([]);
}

describe('SlashCommandDropdown — vault path autocomplete', () => {
  let containerEl: any;
  let inputEl: any;
  let callbacks: SlashCommandDropdownCallbacks;

  beforeEach(() => {
    containerEl = createMockEl();
    inputEl = createMockInput();
    callbacks = createMockCallbacks();
  });

  describe('trigger detection (vaultPathAutocomplete ON)', () => {
    it('/ triggers vault path dropdown', async () => {
      const dropdown = new SlashCommandDropdown(
        containerEl, inputEl, callbacks,
        {
          providerConfig: CLAUDE_CONFIG,
          getProviderEntries: jest.fn().mockResolvedValue(PROVIDER_ENTRIES),
          vaultPathAutocomplete: true,
          getVaultPaths: mockGetVaultPaths,
        },
      );

      inputEl.value = '/';
      inputEl.selectionStart = 1;
      dropdown.handleInputChange();
      await new Promise(resolve => setTimeout(resolve, 10));

      expect(isDropdownVisible(containerEl)).toBe(true);
      const paths = getRenderedVaultPaths(containerEl);
      expect(paths).toContain('/51_DEV/');
      expect(paths).toContain('/README.md');

      dropdown.destroy();
    });

    it('$ triggers commands (not vault paths) when vaultPathAutocomplete ON', async () => {
      const dropdown = new SlashCommandDropdown(
        containerEl, inputEl, callbacks,
        {
          providerConfig: CODEX_CONFIG,
          getProviderEntries: jest.fn().mockResolvedValue(PROVIDER_ENTRIES),
          vaultPathAutocomplete: true,
          getVaultPaths: mockGetVaultPaths,
        },
      );

      inputEl.value = '$';
      inputEl.selectionStart = 1;
      dropdown.handleInputChange();
      await new Promise(resolve => setTimeout(resolve, 10));

      expect(isDropdownVisible(containerEl)).toBe(true);
      const paths = getRenderedVaultPaths(containerEl);
      // Should show commands, not vault paths
      expect(paths.some(p => p.includes('commit'))).toBe(true);
      expect(paths.some(p => p.includes('51_DEV'))).toBe(false);

      dropdown.destroy();
    });

    it('/ does NOT trigger vault paths when vaultPathAutocomplete OFF', async () => {
      const dropdown = new SlashCommandDropdown(
        containerEl, inputEl, callbacks,
        {
          providerConfig: CLAUDE_CONFIG,
          getProviderEntries: jest.fn().mockResolvedValue(PROVIDER_ENTRIES),
          vaultPathAutocomplete: false,
          getVaultPaths: mockGetVaultPaths,
        },
      );

      inputEl.value = '/';
      inputEl.selectionStart = 1;
      dropdown.handleInputChange();
      await new Promise(resolve => setTimeout(resolve, 10));

      expect(isDropdownVisible(containerEl)).toBe(true);
      // Should show commands, not vault paths
      const paths = getRenderedVaultPaths(containerEl);
      expect(paths.some(p => p.includes('commit'))).toBe(true);
      expect(paths.some(p => p.includes('51_DEV'))).toBe(false);

      dropdown.destroy();
    });
  });

  describe('mid-path / scanning', () => {
    it('/51_DEV/ correctly finds trigger at position 0 (not at mid-path /)', async () => {
      const dropdown = new SlashCommandDropdown(
        containerEl, inputEl, callbacks,
        {
          providerConfig: CLAUDE_CONFIG,
          getProviderEntries: jest.fn().mockResolvedValue(PROVIDER_ENTRIES),
          vaultPathAutocomplete: true,
          getVaultPaths: mockGetVaultPaths,
        },
      );

      inputEl.value = '/51_DEV/';
      inputEl.selectionStart = 8;
      dropdown.handleInputChange();
      await new Promise(resolve => setTimeout(resolve, 10));

      expect(isDropdownVisible(containerEl)).toBe(true);
      const paths = getRenderedVaultPaths(containerEl);
      expect(paths).toContain('/51_DEV/00_META/');
      expect(paths).toContain('/51_DEV/index.md');

      dropdown.destroy();
    });

    it('/51_DEV/00_META/ finds children of nested folder', async () => {
      const dropdown = new SlashCommandDropdown(
        containerEl, inputEl, callbacks,
        {
          providerConfig: CLAUDE_CONFIG,
          getProviderEntries: jest.fn().mockResolvedValue(PROVIDER_ENTRIES),
          vaultPathAutocomplete: true,
          getVaultPaths: mockGetVaultPaths,
        },
      );

      inputEl.value = '/51_DEV/00_META/';
      inputEl.selectionStart = 16;
      dropdown.handleInputChange();
      await new Promise(resolve => setTimeout(resolve, 10));

      expect(isDropdownVisible(containerEl)).toBe(true);
      const paths = getRenderedVaultPaths(containerEl);
      expect(paths).toContain('/51_DEV/00_META/methodology.md');
      expect(paths).toContain('/51_DEV/00_META/playbook.md');

      dropdown.destroy();
    });
  });

  describe('selection', () => {
    it('selecting a folder inserts /name/ and re-triggers dropdown', async () => {
      const dropdown = new SlashCommandDropdown(
        containerEl, inputEl, callbacks,
        {
          providerConfig: CLAUDE_CONFIG,
          getProviderEntries: jest.fn().mockResolvedValue(PROVIDER_ENTRIES),
          vaultPathAutocomplete: true,
          getVaultPaths: mockGetVaultPaths,
        },
      );

      // Type /dev → shows 51_DEV/
      inputEl.value = '/dev';
      inputEl.selectionStart = 4;
      dropdown.handleInputChange();
      await new Promise(resolve => setTimeout(resolve, 10));

      expect(isDropdownVisible(containerEl)).toBe(true);

      // Select first item (51_DEV/)
      const enterEvent = { key: 'Enter', preventDefault: jest.fn() } as any;
      dropdown.handleKeydown(enterEvent);

      // Input should now contain /51_DEV/
      expect(inputEl.value).toBe('/51_DEV/');

      // Wait for re-trigger
      await new Promise(resolve => setTimeout(resolve, 10));

      // Dropdown should re-open showing children
      expect(isDropdownVisible(containerEl)).toBe(true);
      const paths = getRenderedVaultPaths(containerEl);
      expect(paths).toContain('/51_DEV/00_META/');

      dropdown.destroy();
    });

    it('selecting a file inserts /name and closes dropdown', async () => {
      const dropdown = new SlashCommandDropdown(
        containerEl, inputEl, callbacks,
        {
          providerConfig: CLAUDE_CONFIG,
          getProviderEntries: jest.fn().mockResolvedValue(PROVIDER_ENTRIES),
          vaultPathAutocomplete: true,
          getVaultPaths: mockGetVaultPaths,
        },
      );

      // Type / → shows root items including README.md
      inputEl.value = '/';
      inputEl.selectionStart = 1;
      dropdown.handleInputChange();
      await new Promise(resolve => setTimeout(resolve, 10));

      // Find README.md index and select it
      const paths = getRenderedVaultPaths(containerEl);
      const readmeIdx = paths.findIndex(p => p === '/README.md');
      expect(readmeIdx).toBeGreaterThanOrEqual(0);

      // Navigate to README.md
      for (let i = 0; i < readmeIdx; i++) {
        dropdown.handleKeydown({ key: 'ArrowDown', preventDefault: jest.fn() } as any);
      }

      const enterEvent = { key: 'Enter', preventDefault: jest.fn() } as any;
      dropdown.handleKeydown(enterEvent);

      // Input should contain /README.md
      expect(inputEl.value).toBe('/README.md');
      expect(isDropdownVisible(containerEl)).toBe(false);

      dropdown.destroy();
    });
  });

  describe('Escape closes dropdown', () => {
    it('Escape closes vault path dropdown', async () => {
      const dropdown = new SlashCommandDropdown(
        containerEl, inputEl, callbacks,
        {
          providerConfig: CLAUDE_CONFIG,
          getProviderEntries: jest.fn().mockResolvedValue(PROVIDER_ENTRIES),
          vaultPathAutocomplete: true,
          getVaultPaths: mockGetVaultPaths,
        },
      );

      inputEl.value = '/';
      inputEl.selectionStart = 1;
      dropdown.handleInputChange();
      await new Promise(resolve => setTimeout(resolve, 10));

      expect(isDropdownVisible(containerEl)).toBe(true);

      const escEvent = { key: 'Escape', preventDefault: jest.fn() } as any;
      dropdown.handleKeydown(escEvent);

      expect(isDropdownVisible(containerEl)).toBe(false);

      dropdown.destroy();
    });

    it('Escape cancels pending async showDropdown (race condition)', async () => {
      const slowGetVaultPaths = jest.fn(() => new Promise<string[]>(resolve => {
        setTimeout(() => resolve(VAULT_PATHS), 50);
      }));

      const dropdown = new SlashCommandDropdown(
        containerEl, inputEl, callbacks,
        {
          providerConfig: CLAUDE_CONFIG,
          getProviderEntries: jest.fn().mockResolvedValue(PROVIDER_ENTRIES),
          vaultPathAutocomplete: true,
          getVaultPaths: slowGetVaultPaths,
        },
      );

      inputEl.value = '/';
      inputEl.selectionStart = 1;
      dropdown.handleInputChange();

      // Hit Escape before async completes
      const escEvent = { key: 'Escape', preventDefault: jest.fn() } as any;
      dropdown.handleKeydown(escEvent);

      expect(isDropdownVisible(containerEl)).toBe(false);

      // Wait for async to complete
      await new Promise(resolve => setTimeout(resolve, 60));

      // Dropdown should NOT re-appear
      expect(isDropdownVisible(containerEl)).toBe(false);

      dropdown.destroy();
    });
  });

  describe('setVaultPathAutocomplete', () => {
    it('can toggle vault path autocomplete after construction', async () => {
      const dropdown = new SlashCommandDropdown(
        containerEl, inputEl, callbacks,
        {
          providerConfig: CLAUDE_CONFIG,
          getProviderEntries: jest.fn().mockResolvedValue(PROVIDER_ENTRIES),
          vaultPathAutocomplete: false,
          getVaultPaths: mockGetVaultPaths,
        },
      );

      // Initially OFF → / triggers commands
      inputEl.value = '/';
      inputEl.selectionStart = 1;
      dropdown.handleInputChange();
      await new Promise(resolve => setTimeout(resolve, 10));

      const pathsBefore = getRenderedVaultPaths(containerEl);
      expect(pathsBefore.some(p => p.includes('commit'))).toBe(true);
      expect(pathsBefore.some(p => p.includes('51_DEV'))).toBe(false);

      dropdown.hide();

      // Turn ON → / triggers vault paths
      dropdown.setVaultPathAutocomplete(true, mockGetVaultPaths);

      inputEl.value = '/';
      inputEl.selectionStart = 1;
      dropdown.handleInputChange();
      await new Promise(resolve => setTimeout(resolve, 10));

      const pathsAfter = getRenderedVaultPaths(containerEl);
      expect(pathsAfter.some(p => p.includes('51_DEV'))).toBe(true);
      expect(pathsAfter.some(p => p.includes('commit'))).toBe(false);

      dropdown.destroy();
    });
  });
});
