import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { Context } from '@deepseek-ai/cordis'
import type { LlmConfigurableProvider } from '@deepseek-ai/dsh-llm'
import type { SettingsDescriptor, SettingsNamespace } from '@deepseek-ai/dsh-settings'
import { afterEach, describe, expect, it } from 'vitest'
import { resolveConfig } from '../src/config.ts'
import { shouldRetryStartup, targetReady } from '../src/index.ts'
import { writeStatus } from '../src/status.ts'
import type { SyncReport } from '../src/types.ts'

const provider: LlmConfigurableProvider = {
  provider: 'openrouter',
  displayName: 'OpenRouter',
  settingsNs: 'llm-pi-ai',
  settingsPath: ['providers', 'openrouter'],
}

const descriptor = {
  ns: 'llm-pi-ai' as SettingsNamespace,
  autoGenerate: true,
  schema: {},
  value: {},
  revision: 1,
  applies: 'live',
} satisfies SettingsDescriptor

/** Build the two services `targetReady` reads. */
function target(providers: readonly LlmConfigurableProvider[], descriptors: readonly SettingsDescriptor[]) {
  return {
    llm: { listConfigurableProviders: () => providers },
    settings: { describe: () => [...descriptors] },
  } as unknown as Pick<Context, 'llm' | 'settings'>
}

/** Minimal report factory. */
function report(overrides: Partial<SyncReport>): SyncReport {
  return {
    at: '2026-11-02T00:00:00.000Z',
    trigger: 'startup',
    provider: 'openrouter',
    status: 'skipped',
    ...overrides,
  }
}

afterEach(() => {
  delete process.env.DSH_HOME
})

describe('install target readiness', () => {
  it('requires both the provider directory row and its settings descriptor', () => {
    const config = resolveConfig({})
    expect(targetReady(target([provider], [descriptor]), config)).toBe(true)
    expect(targetReady(target([], [descriptor]), config)).toBe(false)
    expect(targetReady(target([provider], []), config)).toBe(false)
  })
})

describe('startup retry policy', () => {
  it('retries only transient target-ordering skips', () => {
    for (const reason of ['provider-missing', 'settings-missing', 'route-missing']) {
      expect(shouldRetryStartup(report({ reason }))).toBe(true)
    }
    expect(shouldRetryStartup(report({ status: 'failed', reason: 'settings-write-failed' }))).toBe(true)
    expect(shouldRetryStartup(report({ status: 'failed', reason: 'fetch-failed' }))).toBe(true)
    for (const reason of ['no-key', 'empty-result', 'model-overrides-present', 'invalid-models']) {
      expect(shouldRetryStartup(report({ reason }))).toBe(false)
    }
    expect(shouldRetryStartup(report({ status: 'updated' }))).toBe(false)
    expect(shouldRetryStartup(undefined)).toBe(false)
  })
})

describe('status record', () => {
  it('writes the last attempt into the harness cache directory', async () => {
    const home = await mkdtemp(join(tmpdir(), 'dsh-openrouter-sync-models-'))
    process.env.DSH_HOME = home
    try {
      const value = report({ status: 'updated', attempt: 2, selected: 25, presets: 2, added: ['a'], removed: [] })
      const file = await writeStatus(value)
      expect(file).toBe(join(home, 'cache', 'openrouter-sync-models.json'))
      expect(JSON.parse(await readFile(file, 'utf8'))).toEqual(value)
    } finally {
      await rm(home, { recursive: true, force: true })
    }
  })
})
