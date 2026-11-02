/**
 * Configuration for the OpenRouter model-catalog synchronizer.
 *
 * Every field has a safe default: a default mount follows the OpenRouter
 * catalog as-is, includes account presets, keeps only agent-usable models, and
 * refreshes every six hours. The configuration is composition-time data, not a
 * live settings section: changing it edits this plugin's profile entry and
 * reloads the plugin.
 *
 * @module dsh-openrouter-sync-models/config
 */

import z from '@deepseek-ai/schemastery'

/** Plugin configuration accepted from the composition entry. */
export interface Config {
  /** `llm-pi-ai` provider route to synchronize. */
  provider?: string
  /** OpenRouter catalog endpoint. */
  endpoint?: string
  /** Route-level wire protocol written beside the model list. */
  api?: string
  /** Credential reference used as a fallback when the route names none. */
  apiKeyEnv?: string
  /** Refuse to synchronize when the credential cannot be resolved. */
  requireKey?: boolean
  /** Include account-specific `@preset/...` models. */
  includePresets?: boolean
  /** Keep only models whose prompt and completion prices are zero. */
  freeOnly?: boolean
  /** Keep only models that advertise tool calling. */
  requireTools?: boolean
  /** Keep only models whose output modalities are exactly `text`. */
  requireTextOutput?: boolean
  /** Keep only models that expose the chat-completions endpoint. */
  requireChatEndpoint?: boolean
  /** Minimum context window in tokens; `0` accepts any advertised value. */
  minContextWindow?: number
  /** Upper bound for a known advertised output cap; `0` leaves it untouched. */
  maxOutputTokens?: number
  /** Exact OpenRouter model ids to exclude. */
  excludeModels?: string[]
  /** Refresh interval in hours. */
  intervalHours?: number
  /** HTTP timeout for one catalog request in milliseconds. */
  timeoutMs?: number
  /** How long startup waits for the provider directory to appear. */
  startupGraceMs?: number
}

/** Configuration with every default applied. */
export interface ResolvedConfig {
  provider: string
  endpoint: string
  api: string
  apiKeyEnv: string
  requireKey: boolean
  includePresets: boolean
  freeOnly: boolean
  requireTools: boolean
  requireTextOutput: boolean
  requireChatEndpoint: boolean
  minContextWindow: number
  maxOutputTokens: number
  excludeModels: readonly string[]
  intervalHours: number
  timeoutMs: number
  startupGraceMs: number
}

/** Composition schema with the documented defaults. */
export const Config: z<Config> = z.object({
  provider: z.string().min(1).default('openrouter'),
  endpoint: z.string().min(1).default('https://openrouter.ai/api/v1/models'),
  api: z.string().min(1).default('openai-completions'),
  apiKeyEnv: z.string().min(1).default('OPENROUTER_API_KEY'),
  requireKey: z.boolean().default(true),
  includePresets: z.boolean().default(true),
  freeOnly: z.boolean().default(false),
  requireTools: z.boolean().default(true),
  requireTextOutput: z.boolean().default(true),
  requireChatEndpoint: z.boolean().default(true),
  minContextWindow: z.number().step(1).min(0).default(0),
  maxOutputTokens: z.number().step(1).min(0).default(0),
  excludeModels: z.array(z.string()).default([]),
  intervalHours: z.number().min(0.001).default(6),
  timeoutMs: z.number().step(1).min(1).default(45_000),
  startupGraceMs: z.number().step(1).min(0).default(30_000),
})

/**
 * Apply defaults defensively for hosts that call the plugin without running
 * the schemastery schema first.
 * @param config - raw composition config.
 * @returns the fully populated configuration.
 */
export function resolveConfig(config: Config | undefined): ResolvedConfig {
  return {
    provider: config?.provider ?? 'openrouter',
    endpoint: config?.endpoint ?? 'https://openrouter.ai/api/v1/models',
    api: config?.api ?? 'openai-completions',
    apiKeyEnv: config?.apiKeyEnv ?? 'OPENROUTER_API_KEY',
    requireKey: config?.requireKey ?? true,
    includePresets: config?.includePresets ?? true,
    freeOnly: config?.freeOnly ?? false,
    requireTools: config?.requireTools ?? true,
    requireTextOutput: config?.requireTextOutput ?? true,
    requireChatEndpoint: config?.requireChatEndpoint ?? true,
    minContextWindow: config?.minContextWindow ?? 0,
    maxOutputTokens: config?.maxOutputTokens ?? 0,
    excludeModels: config?.excludeModels ?? [],
    intervalHours: config?.intervalHours ?? 6,
    timeoutMs: config?.timeoutMs ?? 45_000,
    startupGraceMs: config?.startupGraceMs ?? 30_000,
  }
}
