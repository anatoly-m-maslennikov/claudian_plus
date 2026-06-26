import {
  CLAUDIAN_USAGE_EVENT_PREFIX,
  parseWorkerUsageMarkers,
  stripWorkerUsageMarkers,
} from '@/features/chat/services/WorkerUsageMarkerParser';

const VALID_MARKER = `${CLAUDIAN_USAGE_EVENT_PREFIX}{"version":1,"workerSessionId":"ws-1","providerId":"opencode-go","modelId":"kimi-k2.7-code","effort":"max","lane":"go-code","phase":"plan","inputTokens":15520,"outputTokens":6549,"reasoningTokens":0,"cachedInputTokens":4096,"totalTokens":22069}`;

describe('WorkerUsageMarkerParser', () => {
  describe('parseWorkerUsageMarkers', () => {
    it('parses a valid marker', () => {
      const markers = parseWorkerUsageMarkers(VALID_MARKER);
      expect(markers).toHaveLength(1);
      expect(markers[0].version).toBe(1);
      expect(markers[0].workerSessionId).toBe('ws-1');
      expect(markers[0].providerId).toBe('opencode-go');
      expect(markers[0].modelId).toBe('kimi-k2.7-code');
      expect(markers[0].effort).toBe('max');
      expect(markers[0].inputTokens).toBe(15520);
      expect(markers[0].outputTokens).toBe(6549);
      expect(markers[0].cachedInputTokens).toBe(4096);
    });

    it('parses multiple markers from multi-line content', () => {
      const marker2 = `${CLAUDIAN_USAGE_EVENT_PREFIX}{"version":1,"workerSessionId":"ws-2","providerId":"opencode-go","modelId":"kimi-k2.7-code","effort":"max","phase":"execute","inputTokens":8000,"outputTokens":3000,"reasoningTokens":0,"totalTokens":11000}`;
      const content = `Some output\n${VALID_MARKER}\nMore output\n${marker2}\nEnd`;
      const markers = parseWorkerUsageMarkers(content);
      expect(markers).toHaveLength(2);
      expect(markers[0].phase).toBe('plan');
      expect(markers[1].phase).toBe('execute');
    });

    it('ignores malformed JSON', () => {
      const content = `${CLAUDIAN_USAGE_EVENT_PREFIX}{invalid json}`;
      expect(parseWorkerUsageMarkers(content)).toHaveLength(0);
    });

    it('ignores missing required fields', () => {
      const noWorker = `${CLAUDIAN_USAGE_EVENT_PREFIX}{"version":1,"providerId":"x","modelId":"y","inputTokens":1,"outputTokens":1,"reasoningTokens":0}`;
      const noProvider = `${CLAUDIAN_USAGE_EVENT_PREFIX}{"version":1,"workerSessionId":"x","modelId":"y","inputTokens":1,"outputTokens":1,"reasoningTokens":0}`;
      expect(parseWorkerUsageMarkers(noWorker)).toHaveLength(0);
      expect(parseWorkerUsageMarkers(noProvider)).toHaveLength(0);
    });

    it('ignores wrong version', () => {
      const content = `${CLAUDIAN_USAGE_EVENT_PREFIX}{"version":2,"workerSessionId":"x","providerId":"y","modelId":"z","inputTokens":1,"outputTokens":1,"reasoningTokens":0}`;
      expect(parseWorkerUsageMarkers(content)).toHaveLength(0);
    });

    it('ignores truncated marker', () => {
      const content = `${CLAUDIAN_USAGE_EVENT_PREFIX}{"version":1,"workerSessionId":"x","providerId":"y","modelId":"z","inputTokens":1,"outputTo`;
      expect(parseWorkerUsageMarkers(content)).toHaveLength(0);
    });

    it('recomputes totalTokens from input + output + reasoning', () => {
      const content = `${CLAUDIAN_USAGE_EVENT_PREFIX}{"version":1,"workerSessionId":"x","providerId":"y","modelId":"z","inputTokens":100,"outputTokens":50,"reasoningTokens":25,"totalTokens":999}`;
      const markers = parseWorkerUsageMarkers(content);
      expect(markers[0].totalTokens).toBe(175);
    });

    it('omits cachedInputTokens when 0 or absent', () => {
      const noCached = `${CLAUDIAN_USAGE_EVENT_PREFIX}{"version":1,"workerSessionId":"x","providerId":"y","modelId":"z","inputTokens":100,"outputTokens":50,"reasoningTokens":0}`;
      const markers = parseWorkerUsageMarkers(noCached);
      expect(markers[0].cachedInputTokens).toBeUndefined();
    });
  });

  describe('stripWorkerUsageMarkers', () => {
    it('removes marker lines and preserves other content', () => {
      const content = `Line 1\n${VALID_MARKER}\nLine 3`;
      const stripped = stripWorkerUsageMarkers(content);
      expect(stripped).toBe('Line 1\nLine 3');
      expect(stripped).not.toContain('CLAUDIAN_USAGE_EVENT');
    });

    it('preserves non-marker content unchanged', () => {
      const content = 'Just regular output\nNo markers here';
      expect(stripWorkerUsageMarkers(content)).toBe(content);
    });

    it('handles empty content', () => {
      expect(stripWorkerUsageMarkers('')).toBe('');
    });
  });
});
