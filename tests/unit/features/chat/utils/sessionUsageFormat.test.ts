import type { SessionUsageLedger, SessionUsageRow } from '@/core/types';
import { compactTokens, formatSessionUsageRow } from '@/features/chat/utils/sessionUsageFormat';

function makeRow(overrides: Partial<SessionUsageRow> = {}): SessionUsageRow {
  return {
    providerId: 'codex',
    modelId: 'gpt-5.5',
    displayName: 'GPT-5.5',
    effort: 'high',
    inputTokens: 10000,
    outputTokens: 5000,
    reasoningTokens: 1000,
    totalTokens: 16000,
    contributions: [],
    ...overrides,
  };
}

describe('sessionUsageFormat', () => {
  describe('compactTokens', () => {
    it('renders <1000 as-is', () => {
      expect(compactTokens(999)).toBe('999');
    });

    it('renders 12000 as 12k', () => {
      expect(compactTokens(12000)).toBe('12k');
    });

    it('renders 66000 as 66k', () => {
      expect(compactTokens(66000)).toBe('66k');
    });

    it('renders 1200000 as 1.2M', () => {
      expect(compactTokens(1200000)).toBe('1.2M');
    });
  });

  describe('formatSessionUsageRow', () => {
    it('includes provider display name and model name', () => {
      const row = makeRow();
      const result = formatSessionUsageRow(row, 'Codex');
      expect(result).toContain('Codex GPT-5.5');
    });

    it('includes effort when present', () => {
      const row = makeRow({ effort: 'high' });
      const result = formatSessionUsageRow(row, 'Codex');
      expect(result).toContain(', high:');
    });

    it('omits effort when absent', () => {
      const row = makeRow({ effort: undefined });
      const result = formatSessionUsageRow(row, 'Codex');
      expect(result).not.toContain(', high:');
      expect(result).not.toContain(', low:');
    });

    it('includes compact token count', () => {
      const row = makeRow({ totalTokens: 66000 });
      const result = formatSessionUsageRow(row, 'Codex');
      expect(result).toContain('66k tokens');
    });

    it('includes cost segment when 300-min window exists', () => {
      const row = makeRow();
      const ledger: SessionUsageLedger = {
        version: 1,
        conversationId: 'conv-1',
        rows: [row],
        fiveHourWindow: {
          usedPercent: 14,
          windowMinutes: 300,
          observedAt: Date.now(),
          providerId: 'codex',
        },
      };
      const result = formatSessionUsageRow(row, 'Codex', ledger);
      expect(result).toContain('; cost: 14%/5h');
    });

    it('omits cost when window is absent', () => {
      const row = makeRow();
      const result = formatSessionUsageRow(row, 'Codex');
      expect(result).not.toContain('; cost:');
    });

    it('omits cost when window is non-300-min', () => {
      const row = makeRow();
      const ledger = {
        version: 1 as const,
        conversationId: 'conv-1',
        rows: [row],
        fiveHourWindow: {
          usedPercent: 14,
          windowMinutes: 60 as 300, // type cast for test
          observedAt: Date.now(),
          providerId: 'codex',
        },
      };
      const result = formatSessionUsageRow(row, 'Codex', ledger);
      expect(result).not.toContain('; cost:');
    });

    it('falls back to modelId when displayName absent', () => {
      const row = makeRow({ displayName: undefined, modelId: 'gpt-5.5' });
      const result = formatSessionUsageRow(row, 'Codex');
      expect(result).toContain('gpt-5.5');
    });
  });

  describe('Phase 4 provider rows', () => {
    it('Claude row: no cost segment', () => {
      const row = makeRow({
        providerId: 'claude',
        modelId: 'sonnet-4.6',
        displayName: 'Sonnet 4.6',
        effort: 'high',
        inputTokens: 60000,
        outputTokens: 6000,
        reasoningTokens: 0,
        totalTokens: 66000,
      });
      const result = formatSessionUsageRow(row, 'Claude');
      expect(result).toContain('Claude Sonnet 4.6');
      expect(result).toContain('66k tokens');
      expect(result).not.toContain('; cost:');
    });

    it('Pi row: input-only total, no cost segment', () => {
      const row = makeRow({
        providerId: 'pi',
        modelId: 'gemini-3.1-pro',
        displayName: 'Gemini 3.1 Pro',
        effort: 'high',
        inputTokens: 12000,
        outputTokens: 0,
        reasoningTokens: 0,
        totalTokens: 12000,
      });
      const result = formatSessionUsageRow(row, 'Pi');
      expect(result).toContain('Pi Gemini 3.1 Pro');
      expect(result).toContain('12k tokens');
      expect(result).not.toContain('; cost:');
    });
  });
});
