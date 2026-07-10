import type { SessionUsageLedger, SessionUsageRow } from '../../../core/types';

/** Compact a token count for display: `<1000` as-is, `<1M` → `Nk`, else `N.NM`. */
export function compactTokens(n: number): string {
  if (n < 1000) return String(n);
  if (n < 1_000_000) return `${Math.round(n / 1000)}k`;
  return `${Math.round((n / 1_000_000) * 10) / 10}M`;
}

/**
 * Format a single session usage row for the footer / status panel.
 *
 * Format:
 *   `- {provider} {displayName|modelId}{, {effort}}: {in}k/{out}k tokens`
 *
 * Optional segments are omitted when their data is absent. Never displays `unavailable`.
 */
export function formatSessionUsageRow(
  row: SessionUsageRow,
  providerDisplayName: string,
  ledger?: SessionUsageLedger,
): string {
  void ledger;
  const name = row.displayName ?? row.modelId;
  const nameSegment = name ? ` ${name}` : '';
  const effortSegment = row.effort ? `, ${row.effort}` : '';
  const tokenSegment = `${compactTokens(row.totalTokens)} tokens`;

  return `- ${providerDisplayName}${nameSegment}${effortSegment}: ${tokenSegment}`;
}

/** Format the full session usage block (all rows). */
export function formatSessionUsage(
  rows: SessionUsageRow[],
  providerDisplayNames: Record<string, string>,
  ledger?: SessionUsageLedger,
): string {
  if (rows.length === 0) return '';
  return rows
    .map(r => formatSessionUsageRow(r, providerDisplayNames[r.providerId] ?? r.providerId, ledger))
    .join('\n');
}
