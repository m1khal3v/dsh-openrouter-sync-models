/**
 * One synchronization pass: discover the OpenRouter route, resolve its
 * credential, fetch the authenticated catalog, filter it, and persist the
 * resulting model list through the live settings seam.
 *
 * Persistence deliberately goes through `ctx.settings.mutate`: the settings
 * service owns the active profile patch, its revision check, YAML comment
 * preservation, atomic replacement, and Loader/HMR reconciliation. This module
 * never knows a profile name or a filesystem path.
 *
 * @module dsh-openrouter-sync-models/sync
 */

import { isDeepStrictEqual } from 'node:util'
import type { Logger } from '@deepseek-ai/cordis'
import { credentialRef } from '@deepseek-ai/dsh-credentials'
import type { CredentialRef } from '@deepseek-ai/dsh-credentials'
import type { LlmConfigurableProvider } from '@deepseek-ai/dsh-llm'
import type { PiAiModelProfile } from '@deepseek-ai/dsh-llm-pi-ai'
import type { SettingsDescriptor, SettingsPathOp } from '@deepseek-ai/dsh-settings'
import type { ResolvedConfig } from './config.ts'
import { selectModels } from './models.ts'
import type { OpenRouterModel } from './openrouter.ts'
import type { SyncReport, SyncTrigger } from './types.ts'

/** Credential seam needed by the synchronizer. */
export interface CredentialsLike {
  resolve(ref: CredentialRef): Promise<{ value: string } | undefined>
}

/** LLM directory seam needed to locate the provider route. */
export interface LlmDirectoryLike {
  listConfigurableProviders(): readonly LlmConfigurableProvider[]
}

/** Settings seam needed to inspect and persist the route configuration. */
export interface SettingsLike {
  describe(): SettingsDescriptor[]
  mutate(ns: string, ops: readonly SettingsPathOp[], expectedRevision?: number): Promise<void>
}

/** Catalog fetch function, injectable for tests. */
export type FetchModels = (options: {
  endpoint: string
  apiKey?: string
  timeoutMs: number
  signal?: AbortSignal
}) => Promise<OpenRouterModel[]>

/** Collaborators used by one synchronization pass. */
export interface SyncDeps {
  llm: LlmDirectoryLike
  settings: SettingsLike
  credentials: CredentialsLike
  fetchModels: FetchModels
  log: Logger
  now?: () => number
  /** Delay between write retries; injectable so tests stay fast. */
  sleep?: (ms: number) => Promise<void>
}

/** Invocation context for one pass. */
export interface SyncCallOptions {
  trigger?: SyncTrigger
  signal?: AbortSignal
}

/** Whether an unknown value is a plain record. */
function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

/** Read one nested value without trusting its shape. */
function readPath(value: unknown, path: readonly string[]): unknown {
  let node = value
  for (const key of path) {
    if (!isRecord(node)) return undefined
    node = node[key]
  }
  return node
}

/** Locate the provider directory entry for the configured route. */
function findProvider(deps: Pick<SyncDeps, 'llm'>, config: ResolvedConfig): LlmConfigurableProvider | undefined {
  return deps.llm.listConfigurableProviders().find(entry => entry.provider === config.provider)
}

/** Locate the settings descriptor that owns the provider route. */
function findDescriptor(deps: Pick<SyncDeps, 'settings'>, provider: LlmConfigurableProvider): SettingsDescriptor | undefined {
  return deps.settings.describe().find(entry => String(entry.ns) === provider.settingsNs)
}

/** Resolve the credential reference the route uses for inference. */
function keyRefOf(route: Record<string, unknown> | undefined, config: ResolvedConfig): string | undefined {
  const routeRef = route?.apiKeyEnv
  if (typeof routeRef === 'string' && routeRef.length > 0) return routeRef
  return config.apiKeyEnv.length > 0 ? config.apiKeyEnv : undefined
}

/**
 * Credential reference the current configuration will use. The credential
 * update listener calls this so only a relevant credential write triggers a
 * refresh.
 */
export function currentKeyRef(deps: Pick<SyncDeps, 'llm' | 'settings'>, config: ResolvedConfig): string | undefined {
  const provider = findProvider(deps, config)
  if (provider === undefined) return keyRefOf(undefined, config)
  const descriptor = findDescriptor(deps, provider)
  if (descriptor === undefined) return keyRefOf(undefined, config)
  const route = readPath(descriptor.value, provider.settingsPath)
  return keyRefOf(isRecord(route) ? route : undefined, config)
}

/** Extract model ids from a previously stored list. */
function modelIds(models: readonly unknown[]): string[] {
  return models.flatMap((model) => {
    if (!isRecord(model) || typeof model.id !== 'string') return []
    return [model.id]
  })
}

/** Read a message without trusting an unknown rejection value. */
function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

/** Delays between a fresh descriptor read and the settings write. */
const WRITE_RETRY_DELAYS = [0, 250, 1_000] as const

/**
 * Whether a settings rejection is a reload race rather than a real refusal.
 * HMR can replace the entry or bump its revision between the catalog fetch and
 * the write; both cases are safe to retry with a freshly read descriptor.
 */
function isTransientWriteError(error: unknown): boolean {
  const code = isRecord(error) && typeof error.code === 'string' ? error.code : undefined
  if (code === 'SETTINGS_CONFLICT') return true
  const message = errorMessage(error)
  return /SETTINGS_CONFLICT|settings namespace .* changed|changed since it was read|No configurable plugin entry|no longer configurable/i.test(message)
}

/** Result of re-reading the route and attempting the write. */
interface PersistResult {
  status: 'updated' | 'unchanged' | 'skipped'
  reason?: string
  added: string[]
  removed: string[]
}

/**
 * Re-read the descriptor immediately before writing so a catalog fetch that
 * overlapped an HMR recomposition cannot submit a stale revision. Transient
 * reload races are retried; persistent failures are thrown to the caller so
 * the status record can carry their message.
 */
async function persistSelection(
  deps: SyncDeps,
  config: ResolvedConfig,
  provider: LlmConfigurableProvider,
  models: readonly PiAiModelProfile[],
  signal: AbortSignal | undefined,
): Promise<PersistResult> {
  const sleep = deps.sleep ?? (async (ms: number): Promise<void> => {
    await new Promise(resolve => setTimeout(resolve, ms))
  })

  for (let attempt = 0; attempt < WRITE_RETRY_DELAYS.length; attempt += 1) {
    const delay = WRITE_RETRY_DELAYS[attempt]!
    if (delay > 0) await sleep(delay)
    if (signal?.aborted) return { status: 'skipped', reason: 'aborted', added: [], removed: [] }

    let descriptor: SettingsDescriptor | undefined
    try {
      descriptor = findDescriptor(deps, provider)
    } catch (error) {
      if (attempt < WRITE_RETRY_DELAYS.length - 1) continue
      throw error
    }
    if (descriptor === undefined) {
      if (attempt < WRITE_RETRY_DELAYS.length - 1) continue
      return { status: 'skipped', reason: 'settings-missing', added: [], removed: [] }
    }

    const route = readPath(descriptor.value, provider.settingsPath)
    if (!isRecord(route)) {
      if (attempt < WRITE_RETRY_DELAYS.length - 1) continue
      return { status: 'skipped', reason: 'route-missing', added: [], removed: [] }
    }

    const overrides = route.modelOverrides
    if (isRecord(overrides) && Object.keys(overrides).length > 0) {
      return { status: 'skipped', reason: 'model-overrides-present', added: [], removed: [] }
    }

    const currentModels = route.models === undefined ? [] : route.models
    if (!Array.isArray(currentModels)) {
      return { status: 'skipped', reason: 'invalid-models', added: [], removed: [] }
    }

    const beforeIds = modelIds(currentModels)
    const afterIds = models.map(model => model.id)
    const added = afterIds.filter(id => !beforeIds.includes(id))
    const removed = beforeIds.filter(id => !afterIds.includes(id))

    const apiNeedsUpdate = route.api !== config.api
    const modelsNeedUpdate = !isDeepStrictEqual(currentModels, models)
    if (!apiNeedsUpdate && !modelsNeedUpdate) {
      return { status: 'unchanged', added, removed }
    }

    const ops: SettingsPathOp[] = []
    if (apiNeedsUpdate) {
      ops.push({ op: 'set', path: [...provider.settingsPath, 'api'], value: config.api })
    }
    if (modelsNeedUpdate) {
      ops.push({ op: 'set', path: [...provider.settingsPath, 'models'], value: models })
    }

    try {
      await deps.settings.mutate(provider.settingsNs, ops, descriptor.revision)
      return { status: 'updated', added, removed }
    } catch (error) {
      if (attempt < WRITE_RETRY_DELAYS.length - 1 && isTransientWriteError(error)) {
        deps.log.warn('settings write raced with a reload; retrying: %s', errorMessage(error))
        continue
      }
      throw error
    }
  }

  return { status: 'skipped', reason: 'settings-missing', added: [], removed: [] }
}

/**
 * Execute one synchronization.
 * @param deps - live directory, settings, credential, fetch, and logger seams.
 * @param config - resolved plugin configuration.
 * @param options - trigger label and lifetime cancellation.
 * @returns a terminal report; operational failures are reported, never thrown.
 */
export async function synchronize(
  deps: SyncDeps,
  config: ResolvedConfig,
  options: SyncCallOptions = {},
): Promise<SyncReport> {
  const trigger = options.trigger ?? 'interval'
  const nowMs = deps.now?.() ?? Date.now()
  const at = new Date(nowMs).toISOString()
  const base = { at, trigger, provider: config.provider }

  const provider = findProvider(deps, config)
  if (provider === undefined) {
    deps.log.warn('provider "%s" is not declared by the LLM directory; skipping', config.provider)
    return { ...base, status: 'skipped', reason: 'provider-missing' }
  }

  const descriptor = findDescriptor(deps, provider)
  if (descriptor === undefined) {
    deps.log.warn('settings entry "%s" is not configurable; skipping', provider.settingsNs)
    return { ...base, ns: provider.settingsNs, status: 'skipped', reason: 'settings-missing' }
  }

  const route = readPath(descriptor.value, provider.settingsPath)
  if (!isRecord(route)) {
    deps.log.warn('provider "%s" has no configured route; skipping', config.provider)
    return { ...base, ns: provider.settingsNs, status: 'skipped', reason: 'route-missing' }
  }

  const overrides = route.modelOverrides
  if (isRecord(overrides) && Object.keys(overrides).length > 0) {
    deps.log.warn('provider "%s" uses modelOverrides; models cannot be synchronized beside it', config.provider)
    return { ...base, ns: provider.settingsNs, status: 'skipped', reason: 'model-overrides-present' }
  }

  const currentModels = route.models === undefined ? [] : route.models
  if (!Array.isArray(currentModels)) {
    deps.log.warn('provider "%s" has a non-array models field; skipping', config.provider)
    return { ...base, ns: provider.settingsNs, status: 'skipped', reason: 'invalid-models' }
  }

  const keyRef = keyRefOf(route, config)
  let apiKey: string | undefined
  if (keyRef !== undefined) {
    try {
      apiKey = (await deps.credentials.resolve(credentialRef(keyRef)))?.value
    } catch (error) {
      const detail = errorMessage(error)
      deps.log.error('could not resolve credential reference "%s": %s', keyRef, detail)
      return { ...base, ns: provider.settingsNs, status: 'failed', reason: 'credential-error', detail }
    }
  }

  if ((apiKey === undefined || apiKey.length === 0) && config.requireKey) {
    deps.log.warn('credential reference "%s" is not configured; skipping (presets require a token)', keyRef ?? '<none>')
    return { ...base, ns: provider.settingsNs, status: 'skipped', reason: 'no-key' }
  }

  let fetched: OpenRouterModel[]
  try {
    fetched = await deps.fetchModels({
      endpoint: config.endpoint,
      ...(apiKey === undefined ? {} : { apiKey }),
      timeoutMs: config.timeoutMs,
      ...(options.signal === undefined ? {} : { signal: options.signal }),
    })
  } catch (error) {
    const detail = errorMessage(error)
    deps.log.error('catalog request failed: %s', detail)
    return { ...base, ns: provider.settingsNs, status: 'failed', reason: 'fetch-failed', detail }
  }

  const selection = selectModels(fetched, config, nowMs)
  if (selection.selected === 0) {
    deps.log.warn('catalog returned no eligible models (%d entries); leaving the profile untouched', selection.fetched)
    return {
      ...base,
      ns: provider.settingsNs,
      status: 'skipped',
      reason: 'empty-result',
      fetched: selection.fetched,
      selected: 0,
      presets: 0,
    }
  }

  try {
    const persisted = await persistSelection(deps, config, provider, selection.models, options.signal)
    if (persisted.status === 'skipped') {
      deps.log.warn('catalog write skipped after the fetch: %s', persisted.reason ?? 'unknown')
      return {
        ...base,
        ns: provider.settingsNs,
        status: 'skipped',
        reason: persisted.reason,
        fetched: selection.fetched,
        selected: selection.selected,
        presets: selection.presets,
      }
    }

    if (persisted.status === 'unchanged') {
      deps.log.debug('catalog is already current (%d models, %d presets)', selection.selected, selection.presets)
      return {
        ...base,
        ns: provider.settingsNs,
        status: 'unchanged',
        fetched: selection.fetched,
        selected: selection.selected,
        presets: selection.presets,
      }
    }

    deps.log.info(
      'synchronized provider "%s": %d models (%d presets), +%d -%d',
      config.provider,
      selection.selected,
      selection.presets,
      persisted.added.length,
      persisted.removed.length,
    )

    return {
      ...base,
      ns: provider.settingsNs,
      status: 'updated',
      fetched: selection.fetched,
      selected: selection.selected,
      presets: selection.presets,
      added: persisted.added,
      removed: persisted.removed,
    }
  } catch (error) {
    const detail = errorMessage(error)
    deps.log.error('could not persist the OpenRouter catalog: %s', detail)
    return {
      ...base,
      ns: provider.settingsNs,
      status: 'failed',
      reason: 'settings-write-failed',
      detail,
    }
  }
}
