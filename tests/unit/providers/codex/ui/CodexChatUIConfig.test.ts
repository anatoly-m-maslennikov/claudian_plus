import {
  CODEX_LUNA_MODEL,
  CODEX_SOL_MODEL,
  CODEX_SPARK_MODEL,
  CODEX_TERRA_MODEL,
  DEFAULT_CODEX_PRIMARY_MODEL,
  LEGACY_CODEX_PRIMARY_MODEL,
} from '@/providers/codex/types/models';
import { codexChatUIConfig } from '@/providers/codex/ui/CodexChatUIConfig';

describe('CodexChatUIConfig', () => {
  describe('getModelOptions', () => {
    it('should return default models when no env vars', () => {
      const options = codexChatUIConfig.getModelOptions({});
      expect(options).toEqual([
        {
          value: CODEX_SOL_MODEL,
          label: 'GPT-5.6 Sol',
          description: 'Complex, open-ended work',
        },
        {
          value: CODEX_TERRA_MODEL,
          label: 'GPT-5.6 Terra',
          description: 'Balanced everyday work',
        },
        {
          value: CODEX_LUNA_MODEL,
          label: 'GPT-5.6 Luna',
          description: 'Fast, repeatable work',
        },
        {
          value: LEGACY_CODEX_PRIMARY_MODEL,
          label: 'GPT-5.5',
          description: 'Previous generation',
        },
        {
          value: 'gpt-5.4-mini',
          label: 'GPT-5.4 Mini',
          description: 'Legacy fast model',
        },
      ]);
      expect(DEFAULT_CODEX_PRIMARY_MODEL).toBe(CODEX_SOL_MODEL);
    });

    it('appends settings-defined custom models after the built-in options', () => {
      const options = codexChatUIConfig.getModelOptions({
        providerConfigs: {
          codex: {
            customModels: 'gpt-5.6-preview\nmy-custom-model\nmy-custom-model',
          },
        },
      });

      expect(options).toEqual([
        {
          value: CODEX_SOL_MODEL,
          label: 'GPT-5.6 Sol',
          description: 'Complex, open-ended work',
        },
        {
          value: CODEX_TERRA_MODEL,
          label: 'GPT-5.6 Terra',
          description: 'Balanced everyday work',
        },
        {
          value: CODEX_LUNA_MODEL,
          label: 'GPT-5.6 Luna',
          description: 'Fast, repeatable work',
        },
        {
          value: LEGACY_CODEX_PRIMARY_MODEL,
          label: 'GPT-5.5',
          description: 'Previous generation',
        },
        {
          value: 'gpt-5.4-mini',
          label: 'GPT-5.4 Mini',
          description: 'Legacy fast model',
        },
        {
          value: 'openai-codex/gpt-5.6-preview',
          label: 'GPT-5.6 Preview',
          description: 'Custom model',
        },
        {
          value: 'openai-codex/my-custom-model',
          label: 'my-custom-model',
          description: 'Custom model',
        },
      ]);
    });

    it('should prepend custom model from OPENAI_MODEL env var', () => {
      const options = codexChatUIConfig.getModelOptions({
        environmentVariables: 'OPENAI_MODEL=my-custom-model',
      });
      expect(options[0].value).toBe('openai-codex/my-custom-model');
      expect(options[0].description).toBe('Custom (env)');
      expect(options.length).toBe(6);
    });

    it('deduplicates env and settings-defined custom models', () => {
      const options = codexChatUIConfig.getModelOptions({
        providerConfigs: {
          codex: {
            customModels: 'my-custom-model\nsecond-custom-model',
            environmentVariables: 'OPENAI_MODEL=my-custom-model',
          },
        },
      });

      expect(options.map(option => option.value)).toEqual([
        'openai-codex/my-custom-model',
        CODEX_SOL_MODEL,
        CODEX_TERRA_MODEL,
        CODEX_LUNA_MODEL,
        LEGACY_CODEX_PRIMARY_MODEL,
        'gpt-5.4-mini',
        'openai-codex/second-custom-model',
      ]);
    });

    it('should not duplicate when OPENAI_MODEL matches a default model', () => {
      const options = codexChatUIConfig.getModelOptions({
        environmentVariables: `OPENAI_MODEL=${DEFAULT_CODEX_PRIMARY_MODEL}`,
      });
      expect(options.length).toBe(5);
    });
  });

  describe('isAdaptiveReasoningModel', () => {
    it('should return true for all models', () => {
      expect(codexChatUIConfig.isAdaptiveReasoningModel(DEFAULT_CODEX_PRIMARY_MODEL, {})).toBe(true);
      expect(codexChatUIConfig.isAdaptiveReasoningModel('unknown-model', {})).toBe(true);
    });
  });

  describe('getReasoningOptions', () => {
    it('supports Max and Ultra for GPT-5.6 Sol and Terra', () => {
      for (const model of [CODEX_SOL_MODEL, CODEX_TERRA_MODEL]) {
        const options = codexChatUIConfig.getReasoningOptions(model, {});
        expect(options.map(o => o.value)).toEqual([
          'low', 'medium', 'high', 'xhigh', 'max', 'ultra',
        ]);
      }
    });

    it('supports Max but not Ultra for GPT-5.6 Luna', () => {
      const options = codexChatUIConfig.getReasoningOptions(CODEX_LUNA_MODEL, {});
      expect(options.map(o => o.value)).toEqual(['low', 'medium', 'high', 'xhigh', 'max']);
    });

    it('keeps legacy Codex models on their advertised effort levels', () => {
      const options = codexChatUIConfig.getReasoningOptions(LEGACY_CODEX_PRIMARY_MODEL, {});
      expect(options.map(o => o.value)).toEqual(['low', 'medium', 'high', 'xhigh']);
    });
  });

  describe('getDefaultReasoningValue', () => {
    it('uses the model catalog defaults for GPT-5.6', () => {
      expect(codexChatUIConfig.getDefaultReasoningValue(CODEX_SOL_MODEL, {})).toBe('low');
      expect(codexChatUIConfig.getDefaultReasoningValue(CODEX_TERRA_MODEL, {})).toBe('medium');
      expect(codexChatUIConfig.getDefaultReasoningValue(CODEX_LUNA_MODEL, {})).toBe('medium');
    });
  });

  describe('getContextWindowSize', () => {
    it('should return 200000 for all models', () => {
      expect(codexChatUIConfig.getContextWindowSize(DEFAULT_CODEX_PRIMARY_MODEL)).toBe(200_000);
    });
  });

  describe('applyModelDefaults', () => {
    it('sets reasoning summary off for GPT-5.3 Codex Spark', () => {
      const settings: Record<string, unknown> = {
        providerConfigs: {
          codex: {
            reasoningSummary: 'detailed',
          },
        },
      };

      codexChatUIConfig.applyModelDefaults(CODEX_SPARK_MODEL, settings);

      expect(settings).toMatchObject({
        providerConfigs: {
          codex: {
            reasoningSummary: 'none',
          },
        },
      });
    });

    it('leaves reasoning summary unchanged for other Codex models', () => {
      const settings: Record<string, unknown> = {
        providerConfigs: {
          codex: {
            reasoningSummary: 'detailed',
          },
        },
      };

      codexChatUIConfig.applyModelDefaults(DEFAULT_CODEX_PRIMARY_MODEL, settings);

      expect(settings).toMatchObject({
        providerConfigs: {
          codex: {
            reasoningSummary: 'detailed',
          },
        },
      });
    });
  });

  describe('isDefaultModel', () => {
    it('should return true for built-in models', () => {
      expect(codexChatUIConfig.isDefaultModel(CODEX_SOL_MODEL)).toBe(true);
      expect(codexChatUIConfig.isDefaultModel(CODEX_TERRA_MODEL)).toBe(true);
      expect(codexChatUIConfig.isDefaultModel(CODEX_LUNA_MODEL)).toBe(true);
      expect(codexChatUIConfig.isDefaultModel(LEGACY_CODEX_PRIMARY_MODEL)).toBe(true);
      expect(codexChatUIConfig.isDefaultModel('gpt-5.4-mini')).toBe(true);
    });

    it('should return false for custom models', () => {
      expect(codexChatUIConfig.isDefaultModel('my-custom-model')).toBe(false);
    });
  });

  describe('normalizeModelVariant', () => {
    it('falls back unavailable Codex models to the current primary model', () => {
      expect(codexChatUIConfig.normalizeModelVariant('gpt-5.4', {})).toBe(DEFAULT_CODEX_PRIMARY_MODEL);
    });

    it('keeps visible models as-is', () => {
      expect(codexChatUIConfig.normalizeModelVariant(DEFAULT_CODEX_PRIMARY_MODEL, {})).toBe(DEFAULT_CODEX_PRIMARY_MODEL);
      expect(codexChatUIConfig.normalizeModelVariant('custom', {
        environmentVariables: 'OPENAI_MODEL=custom',
      })).toBe('openai-codex/custom');
      expect(codexChatUIConfig.normalizeModelVariant('settings-custom', {
        providerConfigs: {
          codex: {
            customModels: 'settings-custom',
          },
        },
      })).toBe('openai-codex/settings-custom');
    });
  });

  describe('getCustomModelIds', () => {
    it('should return custom model from env', () => {
      const ids = codexChatUIConfig.getCustomModelIds({ OPENAI_MODEL: 'my-model' });
      expect(ids.has('my-model')).toBe(true);
    });

    it('should not include default models', () => {
      const ids = codexChatUIConfig.getCustomModelIds({ OPENAI_MODEL: DEFAULT_CODEX_PRIMARY_MODEL });
      expect(ids.size).toBe(0);
    });

    it('should return empty set when no OPENAI_MODEL', () => {
      const ids = codexChatUIConfig.getCustomModelIds({});
      expect(ids.size).toBe(0);
    });
  });

  describe('getPermissionModeToggle', () => {
    it('should return yolo/safe toggle config with plan mode', () => {
      const toggle = codexChatUIConfig.getPermissionModeToggle!();
      expect(toggle).toEqual({
        inactiveValue: 'normal',
        inactiveLabel: 'Safe',
        activeValue: 'yolo',
        activeLabel: 'YOLO',
        planValue: 'plan',
        planLabel: 'Plan',
      });
    });
  });

  describe('getServiceTierToggle', () => {
    it('offers fast mode for all GPT-5.6 variants', () => {
      for (const model of [CODEX_SOL_MODEL, CODEX_TERRA_MODEL, CODEX_LUNA_MODEL]) {
        expect(codexChatUIConfig.getServiceTierToggle!({ model })).not.toBeNull();
      }
    });

    it('does not offer fast mode for models without a fast service tier', () => {
      expect(codexChatUIConfig.getServiceTierToggle!({ model: 'gpt-5.4-mini' })).toBeNull();
    });
  });
});
