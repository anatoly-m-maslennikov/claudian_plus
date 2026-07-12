import { type App, TFolder } from 'obsidian';

/**
 * Get immediate children of the path typed so far.
 * Non-recursive: only the next level down.
 *
 * - "" or "/" → root children
 * - "00_META" → root children starting with "00_META"
 * - "00_META/" → children of 00_META folder
 * - "00_META/00" → children of 00_META starting with "00"
 */
export async function getVaultPaths(app: App, searchPath: string): Promise<string[]> {
  const cleaned = searchPath.replace(/^\//, '');
  const filterLower = cleaned.toLowerCase();

  // Split into folder path + filter prefix
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

  const nameFilterLower = nameFilter.toLowerCase();
  const results: string[] = [];

  for (const child of folder.children) {
    if (nameFilterLower && !child.name.toLowerCase().startsWith(nameFilterLower)) {
      continue;
    }
    const childPath = folderPath === '' ? child.name : `${folderPath}/${child.name}`;
    const isFolder = child instanceof TFolder;
    results.push(isFolder ? `${childPath}/` : childPath);
  }

  return results.sort().slice(0, 50);
}
