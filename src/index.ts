/**
 * Keep the DSH `llm-pi-ai` OpenRouter model list synchronized with the live
 * OpenRouter catalog, including account-specific `@preset/...` models.
 *
 * The plugin is host-only and composition-agnostic: it discovers the provider
 * route through `ctx.llm.listConfigurableProviders()`, reads the credential
 * reference the route uses, fetches the authenticated catalog, and writes the
 * result through `ctx.settings.mutate()`. That path owns the active profile
 * patch, revision checks, atomic replacement, and Loader/HMR reconciliation,
 * so the same code works in the desktop app, the web surface, and the CLI
 * without knowing a profile name or a filesystem path.
 *
 * A first pass runs once the provider directory is available, then every
 * `intervalHours` hours, and immediately after the route's credential changes
 * so a different account's presets are picked up without a restart.
 *
 * @module dsh-openrouter-sync-models
 */

import type { Context, Logger } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/cordis-plugin-timer'
import type { Config as PluginConfig, ResolvedConfig } from './config.ts'
import { resolveConfig } from './config.ts'
import { fetchOpenRouterModels } from './openrouter.ts'
import { currentKeyRef, synchronize } from './sync.ts'
import type { SyncReport, SyncTrigger } from './types.ts'

/** Cordis plugin name. */
export const name = 'openrouter-sync-models'

export { Config } from './config.ts'
export type { Config as PluginConfig, ResolvedConfig } from './config.ts'
export type { SyncReport, SyncStatus, SyncTrigger } from './types.ts'

/** Delay between provider-directory probes during startup. */
const PROVIDER_POLL_MS = 250

/**
 * Wait for the provider route to appear in the LLM directory. The directory is
 * populated by `dsh-llm-pi-ai` during loader settlement, which can finish
 * slightly after this plugin activates.
 * @param ctx - context carrying the LLM directory.
 * @param config - resolved plugin configuration.
 * @returns nothing; the caller checks the directory again before syncing.
 */
async function waitForProvider(ctx: Context, config: ResolvedConfig): Promise<void> {
  const deadline = Date.now() + config.startupGraceMs
  while (Date.now() < deadline) {
    if (ctx.llm.listConfigurableProviders().some(entry => entry.provider === config.provider)) return
    await ctx.timeout(PROVIDER_POLL_MS)
  }
}

/**
 * Install the synchronizer.
 * @param ctx - plugin context.
 * @param config - composition entry config; the schemastery defaults are
 *   normally applied before this callback, and {@link resolveConfig} repeats
 *   them defensively for hosts that bypass the schema.
 */
export function apply(ctx: Context, config: PluginConfig): void {
  const resolved = resolveConfig(config)
  const log = ctx.logger('openrouter-sync-models')

  // Optional services: a headless/SDK composition without settings or
  // credentials must still load this plugin, just without synchronization.
  ctx.inject(['llm', 'settings', 'credentials', 'timer'], (ctx) => {
    const lifetime = new AbortController()
    let running = false

    const run = async (trigger: SyncTrigger): Promise<void> => {
      if (running || lifetime.signal.aborted) return
      running = true
      try {
        const report: SyncReport = await synchronize({
          llm: ctx.llm,
          settings: ctx.settings,
          credentials: ctx.credentials,
          fetchModels: options => fetchOpenRouterModels({ ...options, signal: lifetime.signal }),
          log,
        }, resolved, { trigger, signal: lifetime.signal })
        ctx.emit('openrouter/models-synced', report)
      } catch (error) {
        // `synchronize` contains operational failures; this guard covers a
        // programming error or a disposed service and keeps the host alive.
        log.error('unexpected synchronization failure: %s', error instanceof Error ? error.message : String(error))
      } finally {
        running = false
      }
    }

    const bootstrap = async (): Promise<void> => {
      try {
        await waitForProvider(ctx, resolved)
      } catch (error) {
        log.warn('provider discovery was interrupted: %s', error instanceof Error ? error.message : String(error))
      }
      await run('startup')
    }

    ctx.timeout(() => void bootstrap(), 0)
    ctx.interval(() => void run('interval'), Math.round(resolved.intervalHours * 3_600_000))

    ctx.on('credentials/reference-updated', (ref) => {
      if (lifetime.signal.aborted) return
      try {
        const watched = currentKeyRef(ctx, resolved)
        if (watched !== undefined && String(ref) === watched) void run('credential')
      } catch (error) {
        log.warn('credential update could not be matched to the route: %s', error instanceof Error ? error.message : String(error))
      }
    })

    ctx.effect(() => () => {
      lifetime.abort(new Error('openrouter-sync-models disposed'))
    }, 'openrouter-sync-models: abort in-flight catalog request')
  })
}

/** Logger type re-exported for test doubles and downstream consumers. */
export type { Logger }
