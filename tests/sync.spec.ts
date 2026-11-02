import { describe, expect, it, vi } from 'vitest'
import type { Logger } from '@deepseek-ai/cordis'
import type { LlmConfigurableProvider } from '@deepseek-ai/dsh-llm'
import type { SettingsDescriptor, SettingsNamespace } from '@deepseek-ai/dsh-settings'
import type { ResolvedConfig } from '../src/config.ts'
import { resolveConfig } from '../src/config.ts'
import { selectModels } from '../src/models.ts'
import type { OpenRouterModel } from '../src/openrouter.ts'
import type { SyncDeps } from '../src/sync.ts'
import { currentKeyRef, synchronize } from '../src/sync.ts'

const provider: LlmConfigurableProvider = {
  provider: 'openrouter',
  displayName: 'OpenRouter',
  settingsNs: 'llm-pi-ai',
  settingsPath: ['providers', 'openrouter'],
}

/** One paid, tool-capable, plain-text model. */
const fetched: OpenRouterModel[] = [
  {
    id: 'vendor/model',
    name: 'Vendor Model',
    canonical_slug: 'vendor/model-2026',
    context_length: 100_000,
    architecture: { input_modalities: ['text'], output_modalities: ['text'] },
    pricing: { prompt: '0.000001', completion: '0.000002' },
    top_provider: { context_length: 100_000, max_completion_tokens: 8_192 },
    supported_parameters: ['tools', 'max_tokens'],
    endpoints: ['/api/v1/chat/completions'],
  },
]

/** Build a settings descriptor carrying one route value. */
function descriptor(value: unknown, revision = 3): SettingsDescriptor {
  return {
    ns: 'llm-pi-ai' as SettingsNamespace,
    autoGenerate: true,
    schema: {},
    value,
    revision,
    applies: 'live',
  }
}

/** Build a route value shaped like the live `llm-pi-ai` section. */
function routeValue(route: Record<string, unknown>): Record<string, unknown> {
  return { providers: { openrouter: route } }
}

/** Silent logger with spyable methods. */
function logger(): Logger {
  return {
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  } as unknown as Logger
}

/** Build a dependency set with focused overrides. */
function harness(overrides: {
  providers?: readonly LlmConfigurableProvider[]
  value?: unknown
  mutate?: SyncDeps['settings']['mutate']
  resolve?: SyncDeps['credentials']['resolve']
  fetchModels?: SyncDeps['fetchModels']
  config?: Partial<ResolvedConfig>
} = {}): { deps: SyncDeps; config: ResolvedConfig; mutate: SyncDeps['settings']['mutate']; log: Logger; resolve: SyncDeps['credentials']['resolve'] } {
  const config = { ...resolveConfig({}), ...overrides.config }
  const log = logger()
  const mutate = overrides.mutate ?? vi.fn(async () => {})
  const resolve = overrides.resolve ?? vi.fn(async () => ({ value: 'secret' }))
  const deps: SyncDeps = {
    llm: { listConfigurableProviders: () => overrides.providers ?? [provider] },
    settings: {
      describe: () => [descriptor(overrides.value ?? routeValue({
        apiKeyEnv: 'OPENROUTER_API_KEY',
        api: 'openai-completions',
        models: [],
      }))],
      mutate,
    },
    credentials: { resolve },
    fetchModels: overrides.fetchModels ?? vi.fn(async () => fetched),
    log,
    now: () => Date.parse('2026-11-02T00:00:00Z'),
    sleep: vi.fn(async () => {}),
  }
  return { deps, config, mutate, log, resolve }
}

describe('synchronize', () => {
  it('skips when the provider is not declared', async () => {
    const { deps, config } = harness({ providers: [] })
    const report = await synchronize(deps, config)
    expect(report).toMatchObject({ status: 'skipped', reason: 'provider-missing' })
    expect(deps.fetchModels).not.toHaveBeenCalled()
  })

  it('skips when the route is not configured', async () => {
    const { deps, config } = harness({ value: { providers: {} } })
    const report = await synchronize(deps, config)
    expect(report).toMatchObject({ status: 'skipped', reason: 'route-missing' })
  })

  it('skips when modelOverrides would conflict with a models list', async () => {
    const { deps, config } = harness({
      value: routeValue({ apiKeyEnv: 'OPENROUTER_API_KEY', modelOverrides: { 'vendor/model': { name: 'X' } } }),
    })
    const report = await synchronize(deps, config)
    expect(report).toMatchObject({ status: 'skipped', reason: 'model-overrides-present' })
  })

  it('skips without a key when the key is required', async () => {
    const { deps, config } = harness({
      resolve: vi.fn(async () => undefined),
      fetchModels: vi.fn(async () => fetched),
    })
    const report = await synchronize(deps, config)
    expect(report).toMatchObject({ status: 'skipped', reason: 'no-key' })
    expect(deps.fetchModels).not.toHaveBeenCalled()
  })

  it('uses the route credential reference ahead of the configured fallback', async () => {
    const resolve = vi.fn(async () => ({ value: 'route-key' }))
    const fetchModels = vi.fn(async () => fetched)
    const { deps, config } = harness({
      resolve,
      fetchModels,
      value: routeValue({ apiKeyEnv: 'CUSTOM_REF', api: 'openai-completions', models: [] }),
    })

    await synchronize(deps, config)

    expect(resolve).toHaveBeenCalledWith('CUSTOM_REF')
    expect(fetchModels).toHaveBeenCalledWith(expect.objectContaining({ apiKey: 'route-key' }))
  })

  it('does not rewrite an already current route', async () => {
    const { deps, config, mutate } = harness()
    const expected = selectModels(fetched, config).models
    const value = routeValue({ apiKeyEnv: 'OPENROUTER_API_KEY', api: 'openai-completions', models: expected })

    deps.settings.describe = () => [descriptor(value)]
    const report = await synchronize(deps, config)

    expect(report).toMatchObject({ status: 'unchanged', fetched: 1, selected: 1 })
    expect(mutate).not.toHaveBeenCalled()
  })

  it('writes api and models with the descriptor revision', async () => {
    const { deps, config, mutate } = harness({
      value: routeValue({ apiKeyEnv: 'OPENROUTER_API_KEY', api: 'anthropic-messages', models: [] }),
    })

    const report = await synchronize(deps, config)

    expect(report).toMatchObject({ status: 'updated', added: ['vendor/model'], removed: [] })
    expect(mutate).toHaveBeenCalledWith('llm-pi-ai', [
      { op: 'set', path: ['providers', 'openrouter', 'api'], value: 'openai-completions' },
      {
        op: 'set',
        path: ['providers', 'openrouter', 'models'],
        value: selectModels(fetched, config).models,
      },
    ], 3)
    expect(deps.log.info).toHaveBeenCalled()
  })

  it('does not clear the route when filtering leaves nothing', async () => {
    const { deps, config, mutate } = harness({ fetchModels: vi.fn(async () => []) })
    const report = await synchronize(deps, config)
    expect(report).toMatchObject({ status: 'skipped', reason: 'empty-result' })
    expect(mutate).not.toHaveBeenCalled()
  })

  it('reports a fetch failure without touching settings', async () => {
    const { deps, config, mutate } = harness({
      fetchModels: vi.fn(async () => { throw new Error('network down') }),
    })
    const report = await synchronize(deps, config)
    expect(report).toMatchObject({ status: 'failed', reason: 'fetch-failed', detail: 'network down' })
    expect(mutate).not.toHaveBeenCalled()
    expect(deps.log.error).toHaveBeenCalled()
  })

  it('re-reads the revision and retries a transient settings conflict', async () => {
    const { deps, config } = harness()
    let revision = 3
    const revisions: Array<number | undefined> = []
    deps.settings.describe = () => [descriptor(routeValue({
      apiKeyEnv: 'OPENROUTER_API_KEY',
      api: 'openai-completions',
      models: [],
    }), revision)]
    deps.settings.mutate = vi.fn(async (_ns, _ops, expected) => {
      revisions.push(expected)
      if (revisions.length === 1) {
        revision = 4
        throw Object.assign(new Error('settings namespace "llm-pi-ai" changed since it was read'), {
          code: 'SETTINGS_CONFLICT',
        })
      }
    })

    const report = await synchronize(deps, config)

    expect(report).toMatchObject({ status: 'updated' })
    expect(revisions).toEqual([3, 4])
    expect(deps.log.warn).toHaveBeenCalled()
  })

  it('reports a persistent settings refusal with its detail', async () => {
    const { deps, config } = harness({
      mutate: vi.fn(async () => { throw new Error('validation exploded') }),
    })
    const report = await synchronize(deps, config)
    expect(report).toMatchObject({
      status: 'failed',
      reason: 'settings-write-failed',
      detail: 'validation exploded',
    })
  })
})

describe('currentKeyRef', () => {
  it('reads the route reference and falls back to config', () => {
    const { deps, config } = harness({
      value: routeValue({ apiKeyEnv: 'CUSTOM_REF', models: [] }),
    })
    expect(currentKeyRef(deps, config)).toBe('CUSTOM_REF')

    const fallback = harness({ value: routeValue({ models: [] }) })
    expect(currentKeyRef(fallback.deps, fallback.config)).toBe('OPENROUTER_API_KEY')
  })
})
