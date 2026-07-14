import type { ProviderUIOption } from '../../../core/providers/types';

export type CodexModel = string;

export const CODEX_SPARK_MODEL: CodexModel = 'gpt-5.3-codex-spark';
export const CODEX_SOL_MODEL: CodexModel = 'gpt-5.6-sol';
export const CODEX_TERRA_MODEL: CodexModel = 'gpt-5.6-terra';
export const CODEX_LUNA_MODEL: CodexModel = 'gpt-5.6-luna';
export const DEFAULT_CODEX_MINI_MODEL: CodexModel = 'gpt-5.4-mini';
export const LEGACY_CODEX_PRIMARY_MODEL: CodexModel = 'gpt-5.5';
export const DEFAULT_CODEX_PRIMARY_MODEL: CodexModel = CODEX_SOL_MODEL;
export const FAST_TIER_CODEX_MODEL = DEFAULT_CODEX_PRIMARY_MODEL;

export const FAST_TIER_CODEX_MODELS = new Set<CodexModel>([
  CODEX_SOL_MODEL,
  CODEX_TERRA_MODEL,
  CODEX_LUNA_MODEL,
  LEGACY_CODEX_PRIMARY_MODEL,
]);

export function supportsCodexFastTier(model: string | undefined): boolean {
  return typeof model === 'string' && FAST_TIER_CODEX_MODELS.has(model);
}

function formatCodexModelSuffix(suffix: string): string {
  return suffix
    .split('-')
    .filter(Boolean)
    .map(segment => segment.charAt(0).toUpperCase() + segment.slice(1).toLowerCase())
    .join(' ');
}

export function formatCodexModelLabel(model: string): string {
  const match = model.match(/^gpt-([^-]+)(?:-(.+))?$/i);
  if (!match) {
    return model;
  }

  const [, version, suffix] = match;
  return `GPT-${version}${suffix ? ` ${formatCodexModelSuffix(suffix)}` : ''}`;
}

function createCodexModelOption(model: CodexModel, description: string): ProviderUIOption {
  return {
    value: model,
    label: formatCodexModelLabel(model),
    description,
  };
}

export const DEFAULT_CODEX_MINI_MODEL_LABEL = formatCodexModelLabel(DEFAULT_CODEX_MINI_MODEL);
export const DEFAULT_CODEX_PRIMARY_MODEL_LABEL = formatCodexModelLabel(DEFAULT_CODEX_PRIMARY_MODEL);
export const FAST_TIER_CODEX_MODEL_LABEL = formatCodexModelLabel(FAST_TIER_CODEX_MODEL);
export const FAST_TIER_CODEX_DESCRIPTION = 'Enable fast mode for this conversation. Faster responses use more credits.';

export const DEFAULT_CODEX_MODELS: ProviderUIOption[] = [
  createCodexModelOption(CODEX_SOL_MODEL, 'Complex, open-ended work'),
  createCodexModelOption(CODEX_TERRA_MODEL, 'Balanced everyday work'),
  createCodexModelOption(CODEX_LUNA_MODEL, 'Fast, repeatable work'),
  createCodexModelOption(LEGACY_CODEX_PRIMARY_MODEL, 'Previous generation'),
  createCodexModelOption(DEFAULT_CODEX_MINI_MODEL, 'Legacy fast model'),
];

export const DEFAULT_CODEX_MODEL_SET = new Set(DEFAULT_CODEX_MODELS.map(model => model.value));
