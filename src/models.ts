/**
 * Projection of OpenRouter catalog entries into the model profiles DSH can
 * serve through `llm-pi-ai`.
 *
 * Only fields the harness can actually represent are projected. A field
 * OpenRouter omits stays omitted here as well, so pi-ai falls back to its
 * installed catalog entry and then to the route defaults exactly as it does
 * for a hand-written profile.
 *
 * @module dsh-openrouter-sync-models/models
 */

import type { PiAiCompatProfile, PiAiModelProfile, PiAiReasoningEfforts } from '@deepseek-ai/dsh-llm-pi-ai'
import type { ResolvedConfig } from './config.ts'
import type { OpenRouterModel } from './openrouter.ts'

/** Reasoning levels understood by DSH, in escalation order. */
const THINKING_LEVELS = ['minimal', 'low', 'medium', 'high', 'xhigh', 'max'] as const
type ThinkingLevel = typeof THINKING_LEVELS[number] | 'off'

/** Chat-completions endpoint every usable catalog model exposes. */
const CHAT_ENDPOINT = '/api/v1/chat/completions'

/** One filtered and mapped catalog result. */
export interface ModelSelection {
  /** Model profiles in deterministic order. */
  models: PiAiModelProfile[]
  /** Number of entries returned by the endpoint. */
  fetched: number
  /** Number of entries kept after filtering. */
  selected: number
  /** Number of kept account presets (`@preset/...`). */
  presets: number
}

/** Positive integer, or `undefined` for absent/invalid data. */
function positiveInteger(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isInteger(value) && value > 0 ? value : undefined
}

/** A price is zero only when a value is present and numerically zero. */
function isZeroPrice(value: unknown): boolean {
  if (typeof value === 'number') return value === 0
  if (typeof value === 'string' && value.trim().length > 0) return Number(value) === 0
  return false
}

/** Whether one catalog entry is an account preset. */
export function isPreset(model: OpenRouterModel): boolean {
  return typeof model.id === 'string' && model.id.startsWith('@preset/')
}

/** Whether the model advertises tool calling. */
function hasTools(model: OpenRouterModel): boolean {
  return Array.isArray(model.supported_parameters) && model.supported_parameters.includes('tools')
}

/** Whether the model exposes the OpenAI-compatible chat endpoint. */
function hasChatEndpoint(model: OpenRouterModel): boolean {
  return Array.isArray(model.endpoints) && model.endpoints.includes(CHAT_ENDPOINT)
}

/** Whether the advertised retirement date has passed. */
function isExpired(model: OpenRouterModel, now: number): boolean {
  if (typeof model.expiration_date !== 'string' || model.expiration_date.length === 0) return false
  const at = Date.parse(model.expiration_date)
  return Number.isFinite(at) && at <= now
}

/** Whether the model's output is plain text, which is all DSH consumes. */
function isPlainTextOutput(model: OpenRouterModel): boolean {
  const output = model.architecture?.output_modalities
  if (!Array.isArray(output) || output.length === 0) return true
  return output.every(modality => modality === 'text')
}

/** Whether the model has no prompt/completion cost. */
function isFree(model: OpenRouterModel): boolean {
  if (!isZeroPrice(model.pricing?.prompt) || !isZeroPrice(model.pricing?.completion)) return false
  const request = model.pricing?.request
  if (request === undefined || request === null || request === '') return true
  return isZeroPrice(request)
}

/**
 * Context the route can actually use. The model capacity and the top
 * provider's capacity can differ; the smaller value keeps DSH from
 * overestimating what a request can carry.
 */
function effectiveContext(model: OpenRouterModel): number | undefined {
  const modelContext = positiveInteger(model.context_length)
  const providerContext = positiveInteger(model.top_provider?.context_length)
  if (modelContext === undefined) return providerContext
  if (providerContext === undefined) return modelContext
  return Math.min(modelContext, providerContext)
}

/** Whether one catalog entry passes the configured filters. */
export function isEligible(model: OpenRouterModel, config: ResolvedConfig, now = Date.now()): boolean {
  if (typeof model.id !== 'string' || model.id.length === 0) return false
  if (!config.includePresets && isPreset(model)) return false
  if (config.excludeModels.includes(model.id)) return false
  if (config.requireChatEndpoint && !hasChatEndpoint(model)) return false
  if (isExpired(model, now)) return false
  if (config.requireTextOutput && !isPlainTextOutput(model)) return false
  if (config.requireTools && !hasTools(model)) return false
  if (config.freeOnly && !isFree(model)) return false
  if (config.minContextWindow > 0) {
    const context = effectiveContext(model)
    if (context === undefined || context < config.minContextWindow) return false
  }
  return true
}

/** Parse the old `text+image->text` modality string as an input fallback. */
function modalityInput(model: OpenRouterModel): string[] | undefined {
  const modality = model.architecture?.modality
  if (typeof modality !== 'string') return undefined
  const input = modality.split('->', 1)[0]
  return input === undefined ? undefined : input.split('+')
}

/** Map OpenRouter input modalities into the two DSH can carry. */
function mapInput(model: OpenRouterModel): PiAiModelProfile['input'] {
  const advertised = model.architecture?.input_modalities
  const source = Array.isArray(advertised) && advertised.length > 0 ? advertised : modalityInput(model)
  if (source === undefined) return undefined
  const image = source.includes('image')
  const text = source.includes('text')
  if (!text && !image) return undefined
  return text ? (image ? ['text', 'image'] : ['text']) : ['image']
}

/** Normalize one OpenRouter effort name into a DSH thinking level. */
function normalizeEffort(effort: string): ThinkingLevel | undefined {
  if (effort === 'none') return 'off'
  return (THINKING_LEVELS as readonly string[]).includes(effort) ? effort as ThinkingLevel : undefined
}

/**
 * Translate OpenRouter reasoning facts into selectable DSH levels.
 *
 * `supported_efforts` is authoritative when present. Older entries omit it
 * while still advertising reasoning; those get the conventional low/medium/
 * high set. A mandatory-reasoning model never offers `off`.
 */
export function mapReasoning(reasoning: OpenRouterModel['reasoning']): PiAiReasoningEfforts | undefined {
  if (reasoning === undefined || reasoning === null) return undefined

  const mandatory = reasoning.mandatory === true
  const advertised = Array.isArray(reasoning.supported_efforts) ? reasoning.supported_efforts : undefined
  const levels = new Set<ThinkingLevel>()
  for (const effort of advertised ?? []) {
    const level = normalizeEffort(effort)
    if (level !== undefined) levels.add(level)
  }

  const hasNonOff = [...levels].some(level => level !== 'off')
  if (!hasNonOff) {
    for (const level of ['low', 'medium', 'high'] as const) levels.add(level)
  }

  const efforts: Partial<Record<ThinkingLevel, string | null>> = {}
  if (!mandatory) efforts.off = levels.has('off') ? 'none' : null
  for (const level of THINKING_LEVELS) {
    if (levels.has(level)) efforts[level] = level
  }
  return efforts as PiAiReasoningEfforts
}

/** Whether a model id or canonical slug belongs to one vendor namespace. */
function isVendor(model: OpenRouterModel, vendor: string): boolean {
  const candidates = [model.id, model.canonical_slug]
  return candidates.some(value => typeof value === 'string' && value.startsWith(`${vendor}/`))
}

/**
 * Project the compatibility switches OpenRouter itself evidences.
 *
 * pi-ai already detects the OpenRouter gateway from the route base URL; the
 * explicit values here cover the cases detection cannot know: an entry that
 * only accepts `max_tokens`, strict structured outputs, Anthropic cache
 * markers behind a preset id, and the developer-role venues.
 */
export function mapCompat(model: OpenRouterModel): PiAiCompatProfile {
  const parameters = new Set(Array.isArray(model.supported_parameters) ? model.supported_parameters : [])
  const compat: PiAiCompatProfile = { thinkingFormat: 'openrouter' }

  if (parameters.has('max_tokens') && !parameters.has('max_completion_tokens')) {
    compat.maxTokensField = 'max_tokens'
  }
  if (parameters.has('structured_outputs')) compat.supportsStrictMode = true
  if (isVendor(model, 'anthropic')) {
    compat.cacheControlFormat = 'anthropic'
    compat.supportsDeveloperRole = true
  } else if (isVendor(model, 'openai')) {
    compat.supportsDeveloperRole = true
  }
  if (isVendor(model, 'deepseek')) compat.requiresReasoningContentOnAssistantMessages = true

  return compat
}

/** Project one eligible catalog entry into a DSH model profile. */
export function toModelProfile(model: OpenRouterModel, config: ResolvedConfig): PiAiModelProfile | undefined {
  if (typeof model.id !== 'string' || model.id.length === 0) return undefined

  const profile: PiAiModelProfile = { id: model.id }
  if (typeof model.name === 'string' && model.name.length > 0) profile.name = model.name

  const context = effectiveContext(model)
  if (context !== undefined) profile.contextWindow = context

  const advertisedMax = positiveInteger(model.top_provider?.max_completion_tokens)
  if (advertisedMax !== undefined) {
    profile.maxTokens = config.maxOutputTokens > 0
      ? Math.min(advertisedMax, config.maxOutputTokens)
      : advertisedMax
  }

  const input = mapInput(model)
  if (input !== undefined) profile.input = input

  const reasoning = mapReasoning(model.reasoning)
  if (reasoning !== undefined) profile.reasoningEfforts = reasoning

  const compat = mapCompat(model)
  if (Object.keys(compat).length > 0) profile.compat = compat

  return profile
}

/**
 * Filter, map, deduplicate, and order the catalog.
 * @param models - raw endpoint entries.
 * @param config - resolved plugin configuration.
 * @param now - epoch-ms used for expiration checks.
 * @returns the kept profiles plus catalog counters.
 */
export function selectModels(models: readonly OpenRouterModel[], config: ResolvedConfig, now = Date.now()): ModelSelection {
  const selected: PiAiModelProfile[] = []
  const seen = new Set<string>()

  for (const model of models) {
    if (!isEligible(model, config, now)) continue
    if (seen.has(model.id)) continue
    const profile = toModelProfile(model, config)
    if (profile === undefined) continue
    seen.add(profile.id)
    selected.push(profile)
  }

  selected.sort((left, right) => left.id < right.id ? -1 : left.id > right.id ? 1 : 0)

  return {
    models: selected,
    fetched: models.length,
    selected: selected.length,
    presets: selected.filter(profile => profile.id.startsWith('@preset/')).length,
  }
}
