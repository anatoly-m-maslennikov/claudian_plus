import { TFile, TFolder } from 'obsidian';

import { getVaultPaths } from '@/features/chat/utils/vaultPaths';

function createFile(path: string): TFile {
  return new (TFile as any)(path) as TFile;
}

function createFolder(path: string, children: (TFile | TFolder)[] = []): TFolder {
  const folder = new (TFolder as any)(path) as TFolder;
  folder.children = children;
  return folder;
}

function createMockApp(root: TFolder): { app: any } {
  return {
    app: {
      vault: {
        getRoot: jest.fn(() => root),
        getAbstractFileByPath: jest.fn((path: string) => {
          if (path === '' || path === '/') return root;
          return findInFolder(root, path);
        }),
      },
    } as any,
  };
}

function findInFolder(folder: TFolder, targetPath: string): TFile | TFolder | null {
  const parts = targetPath.split('/');
  let current: TFolder = folder;

  for (let i = 0; i < parts.length; i++) {
    const part = parts[i];
    if (part === '') continue;
    const child = current.children.find(c => c.name === part);
    if (!child) return null;
    if (i === parts.length - 1) return child as TFile | TFolder;
    if (!(child instanceof TFolder)) return null;
    current = child as TFolder;
  }
  return current;
}

function buildTestVault(): TFolder {
  const readmeMd = createFile('README.md');
  const todoMd = createFile('todo.md');
  const devFolder = createFolder('51_DEV', [
    createFolder('00_META', [
      createFile('methodology.md'),
      createFile('playbook.md'),
    ]),
    createFolder('01_Projects', [
      createFile('projectA.md'),
    ]),
    createFile('index.md'),
  ]);
  const llmFolder = createFolder('52_LLM', [
    createFolder('00_META', [
      createFile('config.toml'),
    ]),
    createFile('notes.md'),
  ]);
  const obsidianFolder = createFolder('.obsidian', [
    createFile('config.json'),
  ]);

  return createFolder('', [readmeMd, todoMd, devFolder, llmFolder, obsidianFolder]);
}

describe('getVaultPaths', () => {
  let app: any;

  beforeEach(() => {
    const mock = createMockApp(buildTestVault());
    app = mock.app;
  });

  describe('root level', () => {
    it('empty search returns all root children', async () => {
      const paths = await getVaultPaths(app, '');
      expect(paths).toContain('51_DEV/');
      expect(paths).toContain('52_LLM/');
      expect(paths).toContain('README.md');
      expect(paths).toContain('todo.md');
      expect(paths).toContain('.obsidian/');
    });

    it('leading / returns all root children', async () => {
      const paths = await getVaultPaths(app, '/');
      expect(paths).toContain('51_DEV/');
      expect(paths).toContain('52_LLM/');
      expect(paths).toContain('README.md');
    });
  });

  describe('prefix filtering (includes, case-insensitive)', () => {
    it('/dev matches 51_DEV (contains, not starts-with)', async () => {
      const paths = await getVaultPaths(app, 'dev');
      expect(paths).toContain('51_DEV/');
      expect(paths).not.toContain('52_LLM/');
    });

    it('/DEV matches 51_DEV (case-insensitive)', async () => {
      const paths = await getVaultPaths(app, 'DEV');
      expect(paths).toContain('51_DEV/');
    });

    it('/51_dev matches 51_DEV (case-insensitive)', async () => {
      const paths = await getVaultPaths(app, '51_dev');
      expect(paths).toContain('51_DEV/');
    });

    it('/meta matches nothing at root (no root item contains meta)', async () => {
      const paths = await getVaultPaths(app, 'meta');
      expect(paths).toEqual([]);
    });

    it('/readme matches README.md', async () => {
      const paths = await getVaultPaths(app, 'readme');
      expect(paths).toContain('README.md');
    });

    it('/51 matches both 51_DEV and nothing else with 51', async () => {
      const paths = await getVaultPaths(app, '51');
      expect(paths).toContain('51_DEV/');
      expect(paths).toHaveLength(1);
    });
  });

  describe('subfolder navigation', () => {
    it('/51_DEV/ returns all children of 51_DEV', async () => {
      const paths = await getVaultPaths(app, '51_DEV/');
      expect(paths).toContain('51_DEV/00_META/');
      expect(paths).toContain('51_DEV/01_Projects/');
      expect(paths).toContain('51_DEV/index.md');
    });

    it('/51_DEV/00_META/ returns children of 00_META', async () => {
      const paths = await getVaultPaths(app, '51_DEV/00_META/');
      expect(paths).toContain('51_DEV/00_META/methodology.md');
      expect(paths).toContain('51_DEV/00_META/playbook.md');
    });

    it('/51_DEV/00 filters children of 51_DEV by "00"', async () => {
      const paths = await getVaultPaths(app, '51_DEV/00');
      expect(paths).toContain('51_DEV/00_META/');
      expect(paths).not.toContain('51_DEV/01_Projects/');
      expect(paths).not.toContain('51_DEV/index.md');
    });

    it('/51_DEV/meta filters children of 51_DEV by "meta" (contains)', async () => {
      const paths = await getVaultPaths(app, '51_DEV/meta');
      expect(paths).toContain('51_DEV/00_META/');
    });
  });

  describe('edge cases', () => {
    it('non-existent folder returns empty', async () => {
      const paths = await getVaultPaths(app, 'nonexistent/');
      expect(paths).toEqual([]);
    });

    it('non-existent nested folder returns empty', async () => {
      const paths = await getVaultPaths(app, '51_DEV/nonexistent/');
      expect(paths).toEqual([]);
    });

    it('file path (not folder) returns empty for children', async () => {
      const paths = await getVaultPaths(app, 'README.md/');
      expect(paths).toEqual([]);
    });

    it('folders have trailing /', async () => {
      const paths = await getVaultPaths(app, '');
      const folderEntries = paths.filter(p => p.endsWith('/'));
      expect(folderEntries).toContain('51_DEV/');
      expect(folderEntries).toContain('52_LLM/');
      expect(folderEntries).toContain('.obsidian/');
    });

    it('files do NOT have trailing /', async () => {
      const paths = await getVaultPaths(app, '');
      const fileEntries = paths.filter(p => !p.endsWith('/'));
      expect(fileEntries).toContain('README.md');
      expect(fileEntries).toContain('todo.md');
    });

    it('results are sorted', async () => {
      const paths = await getVaultPaths(app, '');
      const sorted = [...paths].sort();
      expect(paths).toEqual(sorted);
    });
  });
});
