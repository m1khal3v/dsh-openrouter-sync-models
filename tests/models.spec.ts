import { describe, expect, it } from 'vitest'
import { resolveConfig } from '../src/config.ts'
import type { ResolvedConfig } from '../src/config.ts'
import { isEligible, mapCompat, mapReasoning, selectModels, toModelProfile } from '../src/models.ts'
import { catalog } from './fixtures/catalog.ts'

/** Build a resolved config with focused overrides. */
function config(overrides: Partial<ResolvedConfig> = {}): ResolvedConfig {
  return { ...resolveConfig({}), ...overrides }
}

/** Find one fixture entry by id. */
function model(id: string) {
  const found = catalog.find(entry => entry.id === id)
  if (found === undefined) throw new Error(`fixture not found: ${id}`)
  return found
}

describe('model eligibility', () => {
  it('keeps paid models by default, not only free ones', () => {
    expect(isEligible(model('vendor/reasoning'), config())).toBe(true)
    expect(isEligible(model('vendor/free:free'), config())).toBe(true)
  })

  it('drops tool-less, batch-only, image-output, and expired entries', () => {
    expect(isEligible(model('vendor/no-tools'), config())).toBe(false)
    expect(isEligible(model('vendor/batch:batch'), config())).toBe(false)
    expect(isEligible(model('vendor/image-output'), config())).toBe(false)
    expect(isEligible(model('vendor/expired'), config())).toBe(false)
  })

  it('keeps image-output models when text output is not required', () => {
    expect(isEligible(model('vendor/image-output'), config({ requireTextOutput: false }))).toBe(true)
  })

  it('applies freeOnly, presets, exclusions, and the context floor', () => {
    const free = config({ freeOnly: true })
    expect(isEligible(model('vendor/free:free'), free)).toBe(true)
    expect(isEligible(model('vendor/reasoning'), free)).toBe(false)

    expect(isEligible(model('@preset/anthropic-work'), config({ includePresets: false }))).toBe(false)
    expect(isEligible(model('@preset/anthropic-work'), config({ includePresets: true }))).toBe(true)

    expect(isEligible(model('vendor/reasoning'), config({ excludeModels: ['vendor/reasoning'] }))).toBe(false)
    expect(isEligible(model('vendor/free:free'), config({ minContextWindow: 300_000 }))).toBe(false)
  })
})

describe('model profile mapping', () => {
  it('maps ids, names, capacities, input, reasoning, and compat', () => {
    const profile = toModelProfile(model('vendor/reasoning'), config())
    expect(profile).toMatchObject({
      id: 'vendor/reasoning',
      name: 'Vendor Reasoning',
      contextWindow: 100_000,
      maxTokens: 64_000,
      input: ['text', 'image'],
      reasoningEfforts: { off: 'none', low: 'low', high: 'high', max: 'max' },
      compat: {
        thinkingFormat: 'openrouter',
        supportsStrictMode: true,
      },
    })
    expect(profile?.compat?.maxTokensField).toBeUndefined()
  })

  it('omits unknown capacities and falls back to the modality string', () => {
    const profile = toModelProfile(model('vendor/no-capacities'), config())
    expect(profile).toEqual({
      id: 'vendor/no-capacities',
      name: 'Vendor Without Capacities',
      input: ['text', 'image'],
      reasoningEfforts: { off: null, low: 'low', medium: 'medium', high: 'high' },
      compat: { thinkingFormat: 'openrouter', maxTokensField: 'max_tokens' },
    })
  })

  it('clamps a known output cap only when configured', () => {
    expect(toModelProfile(model('vendor/reasoning'), config({ maxOutputTokens: 8_000 }))?.maxTokens).toBe(8_000)
  })

  it('maps preset vendor facts behind an @preset id', () => {
    const profile = toModelProfile(model('@preset/anthropic-work'), config())
    expect(profile?.reasoningEfforts).toEqual({ low: 'low', high: 'high' })
    expect(profile?.compat).toMatchObject({
      thinkingFormat: 'openrouter',
      cacheControlFormat: 'anthropic',
      supportsDeveloperRole: true,
    })
  })
})

describe('reasoning mapping', () => {
  it('uses advertised levels and honors mandatory reasoning', () => {
    expect(mapReasoning({ mandatory: false, supported_efforts: ['max', 'none'] }))
      .toEqual({ off: 'none', max: 'max' })
    expect(mapReasoning({ mandatory: true, supported_efforts: ['low', 'high'] }))
      .toEqual({ low: 'low', high: 'high' })
  })

  it('falls back to conventional levels when efforts are absent', () => {
    expect(mapReasoning({ mandatory: false })).toEqual({ off: null, low: 'low', medium: 'medium', high: 'high' })
    expect(mapReasoning(undefined)).toBeUndefined()
  })
})

describe('compat mapping', () => {
  it('keeps max_tokens only for endpoints that reject max_completion_tokens', () => {
    expect(mapCompat({ id: 'vendor/model', supported_parameters: ['max_tokens'] }).maxTokensField).toBe('max_tokens')
    expect(mapCompat({ id: 'vendor/model', supported_parameters: ['max_tokens', 'max_completion_tokens'] }).maxTokensField)
      .toBeUndefined()
  })

  it('declares strict tools only when structured outputs are advertised', () => {
    expect(mapCompat({ id: 'vendor/model', supported_parameters: ['structured_outputs'] }).supportsStrictMode).toBe(true)
    expect(mapCompat({ id: 'vendor/model', supported_parameters: [] }).supportsStrictMode).toBeUndefined()
  })
})

describe('catalog selection', () => {
  it('returns a deterministic id-ordered list with counters', () => {
    const selection = selectModels(catalog, config())
    expect(selection.fetched).toBe(catalog.length)
    expect(selection.selected).toBe(4)
    expect(selection.presets).toBe(1)
    expect(selection.models.map(profile => profile.id)).toEqual([
      '@preset/anthropic-work',
      'vendor/free:free',
      'vendor/no-capacities',
      'vendor/reasoning',
    ])
  })

  it('never returns duplicates', () => {
    const selection = selectModels([model('vendor/reasoning'), model('vendor/reasoning')], config())
    expect(selection.models).toHaveLength(1)
  })
})
