import type { SessionUsageContributionInput } from '@/core/types';
import { SessionUsageService } from '@/features/chat/services/SessionUsageService';

const service = new SessionUsageService();

function makeContribution(overrides: Partial<SessionUsageContributionInput> = {}): SessionUsageContributionInput {
  return {
    providerId: 'codex',
    modelId: 'gpt-5.5',
    effort: 'high',
    turnId: 'turn-1',
    inputTokens: 10000,
    outputTokens: 5000,
    reasoningTokens: 1000,
    completedAt: 1700000000000,
    ...overrides,
  };
}

describe('SessionUsageService', () => {
  describe('createLedger', () => {
    it('creates an empty ledger with version 1', () => {
      const ledger = service.createLedger('conv-1');
      expect(ledger.version).toBe(1);
      expect(ledger.conversationId).toBe('conv-1');
      expect(ledger.rows).toHaveLength(0);
    });
  });

  describe('applyContribution', () => {
    it('creates a new row for a new provider+model+effort', () => {
      const ledger = service.createLedger('conv-1');
      const result = service.applyContribution(ledger, makeContribution());

      expect(result.changed).toBe(true);
      expect(result.ledger.rows).toHaveLength(1);
      expect(result.ledger.rows[0].providerId).toBe('codex');
      expect(result.ledger.rows[0].modelId).toBe('gpt-5.5');
      expect(result.ledger.rows[0].effort).toBe('high');
    });

    it('total = input + output + reasoning (recomputed)', () => {
      const ledger = service.createLedger('conv-1');
      const result = service.applyContribution(ledger, makeContribution({
        inputTokens: 100,
        outputTokens: 50,
        reasoningTokens: 25,
      }));

      expect(result.ledger.rows[0].totalTokens).toBe(175);
    });

    it('cached input is not double-counted in total', () => {
      const ledger = service.createLedger('conv-1');
      const result = service.applyContribution(ledger, makeContribution({
        inputTokens: 100,
        cachedInputTokens: 80,
        outputTokens: 50,
        reasoningTokens: 25,
      }));

      // total = 100 + 50 + 25 = 175, not 175 + 80
      expect(result.ledger.rows[0].totalTokens).toBe(175);
      expect(result.ledger.rows[0].cachedInputTokens).toBe(80);
    });

    it('accumulates into one row for same provider+model+effort with different turnIds', () => {
      const ledger = service.createLedger('conv-1');
      const r1 = service.applyContribution(ledger, makeContribution({ turnId: 't1', inputTokens: 100, outputTokens: 50, reasoningTokens: 0 }));
      const r2 = service.applyContribution(r1.ledger, makeContribution({ turnId: 't2', inputTokens: 200, outputTokens: 100, reasoningTokens: 0 }));

      expect(r2.ledger.rows).toHaveLength(1);
      expect(r2.ledger.rows[0].totalTokens).toBe(450);
      expect(r2.ledger.rows[0].contributions).toHaveLength(2);
    });

    it('ignores duplicate contribution (same turnId)', () => {
      const ledger = service.createLedger('conv-1');
      const r1 = service.applyContribution(ledger, makeContribution({ turnId: 't1', inputTokens: 100, outputTokens: 50, reasoningTokens: 0 }));
      const r2 = service.applyContribution(r1.ledger, makeContribution({ turnId: 't1', inputTokens: 100, outputTokens: 50, reasoningTokens: 0 }));

      expect(r2.changed).toBe(false);
      expect(r2.ledger.rows[0].contributions).toHaveLength(1);
      expect(r2.ledger.rows[0].totalTokens).toBe(150);
    });

    it('replaces prior contribution for same turnId with different values', () => {
      const ledger = service.createLedger('conv-1');
      const r1 = service.applyContribution(ledger, makeContribution({ turnId: 't1', inputTokens: 100, outputTokens: 50, reasoningTokens: 0 }));
      const r2 = service.applyContribution(r1.ledger, makeContribution({ turnId: 't1', inputTokens: 200, outputTokens: 50, reasoningTokens: 0 }));

      expect(r2.changed).toBe(true);
      expect(r2.ledger.rows[0].contributions).toHaveLength(1);
      expect(r2.ledger.rows[0].inputTokens).toBe(200);
      expect(r2.ledger.rows[0].totalTokens).toBe(250);
    });

    it('creates separate rows for same modelId from different providers', () => {
      const ledger = service.createLedger('conv-1');
      const r1 = service.applyContribution(ledger, makeContribution({ providerId: 'codex', modelId: 'gpt-5' }));
      const r2 = service.applyContribution(r1.ledger, makeContribution({ providerId: 'opencode', modelId: 'gpt-5' }));

      expect(r2.ledger.rows).toHaveLength(2);
    });

    it('creates separate rows for different effort', () => {
      const ledger = service.createLedger('conv-1');
      const r1 = service.applyContribution(ledger, makeContribution({ effort: 'high' }));
      const r2 = service.applyContribution(r1.ledger, makeContribution({ effort: 'low', turnId: 't2' }));

      expect(r2.ledger.rows).toHaveLength(2);
    });

    it('creates a new row on model switch', () => {
      const ledger = service.createLedger('conv-1');
      const r1 = service.applyContribution(ledger, makeContribution({ modelId: 'gpt-5.5' }));
      const r2 = service.applyContribution(r1.ledger, makeContribution({ modelId: 'gpt-5.4', turnId: 't2' }));

      expect(r2.ledger.rows).toHaveLength(2);
    });

    it('handles unknown provider/model without error', () => {
      const ledger = service.createLedger('conv-1');
      const result = service.applyContribution(ledger, makeContribution({
        providerId: 'future-provider',
        modelId: 'future-model-v1',
      }));

      expect(result.changed).toBe(true);
      expect(result.ledger.rows).toHaveLength(1);
      expect(result.ledger.rows[0].providerId).toBe('future-provider');
    });

    it('omits optional fields when zero/absent (no zero placeholders)', () => {
      const ledger = service.createLedger('conv-1');
      const result = service.applyContribution(ledger, makeContribution({
        cachedInputTokens: 0,
      }));

      expect(result.ledger.rows[0].cachedInputTokens).toBeUndefined();
    });
  });

  describe('applyFiveHourWindow', () => {
    it('sets the window on an empty ledger', () => {
      const ledger = service.createLedger('conv-1');
      const result = service.applyFiveHourWindow(ledger, {
        usedPercent: 14,
        windowMinutes: 300,
        observedAt: Date.now(),
        providerId: 'codex',
      });

      expect(result.changed).toBe(true);
      expect(result.ledger.fiveHourWindow?.usedPercent).toBe(14);
    });

    it('replaces the window with a new value', () => {
      const ledger = service.createLedger('conv-1');
      const r1 = service.applyFiveHourWindow(ledger, {
        usedPercent: 14,
        windowMinutes: 300,
        observedAt: Date.now(),
        providerId: 'codex',
      });
      const r2 = service.applyFiveHourWindow(r1.ledger, {
        usedPercent: 20,
        windowMinutes: 300,
        observedAt: Date.now(),
        providerId: 'codex',
      });

      expect(r2.changed).toBe(true);
      expect(r2.ledger.fiveHourWindow?.usedPercent).toBe(20);
    });

    it('reports no change when the window is identical', () => {
      const ledger = service.createLedger('conv-1');
      const window = {
        usedPercent: 14,
        windowMinutes: 300 as const,
        observedAt: Date.now(),
        providerId: 'codex',
      };
      const r1 = service.applyFiveHourWindow(ledger, window);
      const r2 = service.applyFiveHourWindow(r1.ledger, window);

      expect(r2.changed).toBe(false);
    });
  });

  describe('getDisplayRows', () => {
    it('sorts orchestrator provider first, delegated second', () => {
      const ledger = service.createLedger('conv-1');
      const r1 = service.applyContribution(ledger, makeContribution({ providerId: 'opencode-go', modelId: 'kimi', turnId: 'w1' }), 'delegated-worker');
      const r2 = service.applyContribution(r1.ledger, makeContribution({ providerId: 'codex', modelId: 'gpt-5.5', turnId: 't1' }), 'provider-turn');

      const rows = service.getDisplayRows(r2.ledger, 'codex');

      expect(rows[0].providerId).toBe('codex');
      expect(rows[1].providerId).toBe('opencode-go');
    });

    it('preserves first-seen order within each class', () => {
      const ledger = service.createLedger('conv-1');
      const r1 = service.applyContribution(ledger, makeContribution({ providerId: 'codex', modelId: 'gpt-5.5', effort: 'high', turnId: 't1' }));
      const r2 = service.applyContribution(r1.ledger, makeContribution({ providerId: 'codex', modelId: 'gpt-5.4', effort: 'high', turnId: 't2' }));
      const r3 = service.applyContribution(r2.ledger, makeContribution({ providerId: 'opencode-go', modelId: 'kimi', effort: 'max', turnId: 'w1' }), 'delegated-worker');
      const r4 = service.applyContribution(r3.ledger, makeContribution({ providerId: 'opencode-go', modelId: 'qwen', effort: 'max', turnId: 'w2' }), 'delegated-worker');

      const rows = service.getDisplayRows(r4.ledger, 'codex');

      // Orchestrator rows first (gpt-5.5 then gpt-5.4 by first-seen)
      expect(rows[0].modelId).toBe('gpt-5.5');
      expect(rows[1].modelId).toBe('gpt-5.4');
      // Delegated rows next (kimi then qwen by first-seen)
      expect(rows[2].modelId).toBe('kimi');
      expect(rows[3].modelId).toBe('qwen');
    });
  });

  describe('delegated-worker contributions (Phase 3)', () => {
    it('plan + execute same model combine into one row', () => {
      const ledger = service.createLedger('conv-1');
      const r1 = service.applyContribution(ledger, makeContribution({
        providerId: 'opencode-go', modelId: 'kimi', effort: 'max', turnId: 'w1:plan',
        inputTokens: 5000, outputTokens: 2000, reasoningTokens: 0,
      }), 'delegated-worker');
      const r2 = service.applyContribution(r1.ledger, makeContribution({
        providerId: 'opencode-go', modelId: 'kimi', effort: 'max', turnId: 'w1:execute',
        inputTokens: 10000, outputTokens: 4000, reasoningTokens: 0,
      }), 'delegated-worker');

      expect(r2.ledger.rows).toHaveLength(1);
      expect(r2.ledger.rows[0].totalTokens).toBe(21000);
      expect(r2.ledger.rows[0].contributions).toHaveLength(2);
    });

    it('delegated provider with unknown modelId renders without error', () => {
      const ledger = service.createLedger('conv-1');
      const result = service.applyContribution(ledger, makeContribution({
        providerId: 'future-worker', modelId: 'unknown-v1', turnId: 'w1',
      }), 'delegated-worker');

      expect(result.changed).toBe(true);
      expect(result.ledger.rows).toHaveLength(1);
    });
  });
});
