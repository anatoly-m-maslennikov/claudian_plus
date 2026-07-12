import { type App, TFolder } from 'obsidian';

/**
 * Get immediate children of the path typed so far, filtered by prefix.
 * Non-recursive: only the next level down.
 *
 * - "dev" → root children whose name starts with "dev" (case-insensitive)
 * - "51_DEV/" → all children of 51_DEV
 * - "51_DEV/sub" → children of 51_DEV whose name starts with "sub"
 */
export async function getVaultPaths(app: App, searchPath: string): Promise<string[]> {
  const cleaned = searchPath.replace(/^\//, '');

  // Split into folder path + name filter
  let folderPath: string;
  let nameFilter: string;

  if (cleaned.endsWith('/')) {
    folderPath = cleaned.slice(0, -1);
    nameFilter = '';
  } else {
    const lastSlash = cleaned.lastIndexOf('/');
    if (lastSlash === -1) {
      folderPath = '';
      nameFilter = cleaned;
    } else {
      folderPath = cleaned.slice(0, lastSlash);
      nameFilter = cleaned.slice(lastSlash + 1);
    }
  }

  const folder = folderPath === ''
    ? app.vault.getRoot()
    : app.vault.getAbstractFileByPath(folderPath);

  if (!(folder instanceof TFolder)) {
    return [];
  }

  const filterLower = nameFilter.toLowerCase();
  const results: string[] = [];

  for (const child of folder.children) {
    if (filterLower && !child.name.toLowerCase().startsWith(filterLower)) {
      continue;
    }
    const childPath = folderPath === '' ? child.name : `${folderPath}/${child.name}`;
    const isFolder = child instanceof TFolder;
    results.push(isFolder ? `${childPath}/` : childPath);
  }

  return results.sort().slice(0, 50);
}
