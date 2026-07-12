import { type App, TFolder } from 'obsidian';

/**
 * Get immediate children of the path typed so far.
 * Non-recursive: only the next level down.
 * No prefix filtering — shows all children.
 *
 * - "/" → all root children
 * - "/00_META/" → all children of 00_META folder
 */
export async function getVaultPaths(app: App, searchPath: string): Promise<string[]> {
  const cleaned = searchPath.replace(/^\//, '');

  // Determine folder path — the part before the last /
  let folderPath: string;

  if (cleaned.endsWith('/')) {
    folderPath = cleaned.slice(0, -1);
  } else {
    const lastSlash = cleaned.lastIndexOf('/');
    folderPath = lastSlash === -1 ? '' : cleaned.slice(0, lastSlash);
  }

  const folder = folderPath === ''
    ? app.vault.getRoot()
    : app.vault.getAbstractFileByPath(folderPath);

  if (!(folder instanceof TFolder)) {
    return [];
  }

  const results: string[] = [];

  for (const child of folder.children) {
    const childPath = folderPath === '' ? child.name : `${folderPath}/${child.name}`;
    const isFolder = child instanceof TFolder;
    results.push(isFolder ? `${childPath}/` : childPath);
  }

  return results.sort().slice(0, 50);
}
