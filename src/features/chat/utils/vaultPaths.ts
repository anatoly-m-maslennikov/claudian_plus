import type { App } from 'obsidian';

/**
 * Get vault paths matching the search string.
 * Returns both file paths and intermediate folder paths.
 */
export async function getVaultPaths(app: App, searchPath: string): Promise<string[]> {
  const normalizedSearch = searchPath.replace(/^\//, '').toLowerCase();
  const files = app.vault.getFiles();
  const results = new Set<string>();

  for (const file of files) {
    const path = file.path;
    if (normalizedSearch && !path.toLowerCase().includes(normalizedSearch)) continue;
    results.add(path);
    const parts = path.split('/');
    for (let i = 1; i < parts.length; i++) {
      const folder = parts.slice(0, i).join('/');
      if (!normalizedSearch || folder.toLowerCase().includes(normalizedSearch)) {
        results.add(folder + '/');
      }
    }
  }

  return Array.from(results).sort().slice(0, 50);
}
