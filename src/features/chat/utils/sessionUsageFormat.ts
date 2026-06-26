import type { FiveHourWindow, SessionUsageLedger, SessionUsageRow } from '../../../core/types';

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
 *   `- {provider} {displayName|modelId}{, {effort}}: {compact} tokens{; cost: {pct}%/5h}`
 *
 * Optional segments are omitted when their data is absent. Never displays `unavailable`.
 */
export function formatSessionUsageRow(
  row: SessionUsageRow,
  providerDisplayName: string,
  ledger?: SessionUsageLedger,
): string {
  const name = row.displayName ?? row.modelId;
  const effortSegment = row.effort ? `, ${row.effort}` : '';
  const tokenSegment = `${compactTokens(row.totalTokens)} tokens`;

  let costSegment = '';
  if (ledger?.fiveHourWindow && ledger.fiveHourWindow.windowMinutes === 300 && ledger.fiveHourWindow.providerId === row.providerId) {
    costSegment = `; cost: ${ledger.fiveHourWindow.usedPercent}%/5h`;
  }

  return `- ${providerDisplayName} ${name}${effortSegment}: ${tokenSegment}${costSegment}`;
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

/** Get the window label for display, or null if not applicable. */
export function getFiveHourWindowLabel(window: FiveHourWindow | undefined): string | null {
  if (!window || window.windowMinutes !== 300) return null;
  return `${window.usedPercent}%/5h`;
}
