import type {
  ProviderChatUIConfig,
  ProviderPermissionModeToggleConfig,
  ProviderReasoningOption,
  ProviderServiceTierToggleConfig,
  ProviderUIOption,
} from '../../../core/providers/types';
import { OPENAI_PROVIDER_ICON } from '../../../shared/icons';
import { getCodexModelOptions } from '../modelOptions';
import { isCodexModelSelectionId, toCodexRuntimeModelId } from '../modelSelection';
import { applyCodexModelDefaults } from '../settings';
import {
  CODEX_LUNA_MODEL,
  CODEX_SOL_MODEL,
  CODEX_TERRA_MODEL,
  DEFAULT_CODEX_MODEL_SET,
  DEFAULT_CODEX_PRIMARY_MODEL,
  FAST_TIER_CODEX_DESCRIPTION,
  supportsCodexFastTier,
} from '../types/models';

const BASE_EFFORT_LEVELS: ProviderReasoningOption[] = [
  { value: 'low', label: 'Low' },
  { value: 'medium', label: 'Medium' },
  { value: 'high', label: 'High' },
  { value: 'xhigh', label: 'XHigh' },
];

const MAX_EFFORT_LEVEL: ProviderReasoningOption = { value: 'max', label: 'Max' };
const ULTRA_EFFORT_LEVEL: ProviderReasoningOption = { value: 'ultra', label: 'Ultra' };

function getCodexReasoningOptions(model: string): ProviderReasoningOption[] {
  const runtimeModel = toCodexRuntimeModelId(model);
  if (runtimeModel === CODEX_SOL_MODEL || runtimeModel === CODEX_TERRA_MODEL) {
    return [...BASE_EFFORT_LEVELS, MAX_EFFORT_LEVEL, ULTRA_EFFORT_LEVEL];
  }
  if (runtimeModel === CODEX_LUNA_MODEL) {
    return [...BASE_EFFORT_LEVELS, MAX_EFFORT_LEVEL];
  }
  return [...BASE_EFFORT_LEVELS];
}

const CODEX_PERMISSION_MODE_TOGGLE: ProviderPermissionModeToggleConfig = {
  inactiveValue: 'normal',
  inactiveLabel: 'Safe',
  activeValue: 'yolo',
  activeLabel: 'YOLO',
  planValue: 'plan',
  planLabel: 'Plan',
};

const CODEX_SERVICE_TIER_TOGGLE: ProviderServiceTierToggleConfig = {
  inactiveValue: 'default',
  inactiveLabel: 'Standard',
  activeValue: 'fast',
  activeLabel: 'Fast',
  description: FAST_TIER_CODEX_DESCRIPTION,
};

const DEFAULT_CONTEXT_WINDOW = 200_000;

function looksLikeCodexModel(model: string): boolean {
  return /^gpt-/i.test(model) || /^o\d/i.test(model);
}

export const codexChatUIConfig: ProviderChatUIConfig = {
  getModelOptions(settings: Record<string, unknown>): ProviderUIOption[] {
    return getCodexModelOptions(settings);
  },

  ownsModel(model: string, settings: Record<string, unknown>): boolean {
    if (isCodexModelSelectionId(model)) {
      return true;
    }

    const runtimeModel = toCodexRuntimeModelId(model);
    if (getCodexModelOptions(settings).some((option: ProviderUIOption) =>
      option.value === model || toCodexRuntimeModelId(option.value) === runtimeModel
    )) {
      return true;
    }

    return looksLikeCodexModel(runtimeModel);
  },

  isAdaptiveReasoningModel(_model: string, _settings: Record<string, unknown>): boolean {
    return true;
  },

  getReasoningOptions(model: string, _settings: Record<string, unknown>): ProviderReasoningOption[] {
    return getCodexReasoningOptions(model);
  },

  getDefaultReasoningValue(model: string, _settings: Record<string, unknown>): string {
    return toCodexRuntimeModelId(model) === CODEX_SOL_MODEL ? 'low' : 'medium';
  },

  getContextWindowSize(): number {
    return DEFAULT_CONTEXT_WINDOW;
  },

  isDefaultModel(model: string): boolean {
    return DEFAULT_CODEX_MODEL_SET.has(model);
  },

  applyModelDefaults(model: string, settings: unknown): void {
    if (!settings || typeof settings !== 'object') {
      return;
    }

    applyCodexModelDefaults(toCodexRuntimeModelId(model), settings as Record<string, unknown>);
  },

  normalizeModelVariant(model: string, settings: Record<string, unknown>): string {
    const runtimeModel = toCodexRuntimeModelId(model);
    const option = getCodexModelOptions(settings).find((candidate) =>
      candidate.value === model || toCodexRuntimeModelId(candidate.value) === runtimeModel
    );
    if (option) {
      return option.value;
    }

    return DEFAULT_CODEX_PRIMARY_MODEL;
  },

  getCustomModelIds(envVars: Record<string, string>): Set<string> {
    const ids = new Set<string>();
    if (envVars.OPENAI_MODEL && !DEFAULT_CODEX_MODEL_SET.has(envVars.OPENAI_MODEL)) {
      ids.add(envVars.OPENAI_MODEL);
    }
    return ids;
  },

  getPermissionModeToggle(): ProviderPermissionModeToggleConfig {
    return CODEX_PERMISSION_MODE_TOGGLE;
  },

  getServiceTierToggle(settings): ProviderServiceTierToggleConfig | null {
    const model = typeof settings.model === 'string' ? settings.model : '';
    return supportsCodexFastTier(toCodexRuntimeModelId(model))
      ? CODEX_SERVICE_TIER_TOGGLE
      : null;
  },

  getProviderIcon() {
    return OPENAI_PROVIDER_ICON;
  },
};
