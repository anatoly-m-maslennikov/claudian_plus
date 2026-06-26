import { reconstructCodexSessionUsage } from '@/providers/codex/history/codexSessionUsageReconstruction';

function tokenCountEvent(turnId: string, cumulative: { input_tokens: number; output_tokens: number; reasoning_tokens: number; total_tokens: number }, rateLimits?: { primary: { used_percent: number; window_minutes: number } }): string {
  return JSON.stringify({
    type: 'event_msg',
    payload: {
      type: 'token_count',
      turn_id: turnId,
      info: {
        last_token_usage: { input_tokens: cumulative.input_tokens },
        total_token_usage: cumulative,
        ...(rateLimits ? { rate_limits: rateLimits } : {}),
      },
    },
  });
}

describe('reconstructCodexSessionUsage', () => {
  it('returns null for empty content', () => {
    expect(reconstructCodexSessionUsage('', 'conv-1')).toBeNull();
  });

  it('returns null when no token_count events', () => {
    const content = JSON.stringify({ type: 'event_msg', payload: { type: 'task_started' } }) + '\n';
    expect(reconstructCodexSessionUsage(content, 'conv-1')).toBeNull();
  });

  it('reconstructs ledger from token_count events', () => {
    const content = [
      tokenCountEvent('turn-1', { input_tokens: 20000, output_tokens: 5000, reasoning_tokens: 1000, total_tokens: 26000 }),
      tokenCountEvent('turn-2', { input_tokens: 35000, output_tokens: 8000, reasoning_tokens: 2000, total_tokens: 45000 }),
    ].join('\n');

    const ledger = reconstructCodexSessionUsage(content, 'conv-1');
    expect(ledger).not.toBeNull();
    expect(ledger!.version).toBe(1);
    expect(ledger!.conversationId).toBe('conv-1');
    expect(ledger!.rows).toHaveLength(1);
    // Total = sum of deltas: (26000-0) + (45000-26000) = 26000 + 19000 = 45000
    expect(ledger!.rows[0].totalTokens).toBe(45000);
    expect(ledger!.rows[0].contributions).toHaveLength(2);
  });

  it('cumulative deltas computed correctly across 3 turns', () => {
    const content = [
      tokenCountEvent('t1', { input_tokens: 10000, output_tokens: 2000, reasoning_tokens: 0, total_tokens: 12000 }),
      tokenCountEvent('t2', { input_tokens: 20000, output_tokens: 4000, reasoning_tokens: 0, total_tokens: 24000 }),
      tokenCountEvent('t3', { input_tokens: 35000, output_tokens: 7000, reasoning_tokens: 0, total_tokens: 42000 }),
    ].join('\n');

    const ledger = reconstructCodexSessionUsage(content, 'conv-1');
    expect(ledger!.rows[0].totalTokens).toBe(42000);
  });

  it('legacy transcripts without token_count → null', () => {
    const content = JSON.stringify({ type: 'event', event: { type: 'turn.started' } }) + '\n';
    expect(reconstructCodexSessionUsage(content, 'conv-1')).toBeNull();
  });

  it('ignores malformed JSON lines', () => {
    const content = 'not json\n' + tokenCountEvent('turn-1', { input_tokens: 20000, output_tokens: 5000, reasoning_tokens: 0, total_tokens: 25000 });
    const ledger = reconstructCodexSessionUsage(content, 'conv-1');
    expect(ledger).not.toBeNull();
    expect(ledger!.rows[0].totalTokens).toBe(25000);
  });

  it('ignores zero-total token_count events', () => {
    const content = tokenCountEvent('turn-0', { input_tokens: 0, output_tokens: 0, reasoning_tokens: 0, total_tokens: 0 })
      + '\n' + tokenCountEvent('turn-1', { input_tokens: 20000, output_tokens: 5000, reasoning_tokens: 0, total_tokens: 25000 });
    const ledger = reconstructCodexSessionUsage(content, 'conv-1');
    expect(ledger!.rows[0].totalTokens).toBe(25000);
  });
});
