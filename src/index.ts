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
 * Refresh policy is deliberately narrow. Within one host process only three
 * triggers exist: the startup pass (including short retries while the loader
 * settles), a change of the route's own OpenRouter credential, and the
 * periodic pass six hours after the last completed attempt. No HMR, settings,
 * adapter, or plugin-manager event starts a catalog request.
 *
 * @module dsh-openrouter-sync-models
 */

import type { Context, Logger } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/cordis-plugin-timer'
import type { Config as PluginConfig, ResolvedConfig } from './config.ts'
import { resolveConfig } from './config.ts'
import { fetchOpenRouterModels } from './openrouter.ts'
import { writeStatus } from './status.ts'
import { currentKeyRef, synchronize } from './sync.ts'
import type { SyncReport, SyncTrigger } from './types.ts'

/** Cordis plugin name. */
export const name = 'openrouter-sync-models'

export { Config } from './config.ts'
export type { Config as PluginConfig, ResolvedConfig } from './config.ts'
export type { SyncReport, SyncStatus, SyncTrigger } from './types.ts'

/** Delay between provider/settings probes during startup. */
const PROVIDER_POLL_MS = 250

/** Startup attempts after the first: settle HMR/loader races without events. */
export const STARTUP_RETRY_DELAYS = [0, 1_000, 3_000, 10_000] as const

/** Coalesce the burst of writes one credential update can emit. */
const CREDENTIAL_DEBOUNCE_MS = 500

/** Ignore duplicate credential events from the same operation. */
const CREDENTIAL_COOLDOWN_MS = 5_000

/** Let the loader finish the reload that exposed the target before writing. */
const STARTUP_SETTLE_MS = 250

/** Whether the provider and its settings descriptor are both ready. */
export function targetReady(ctx: Pick<Context, 'llm' | 'settings'>, config: ResolvedConfig): boolean {
  const provider = ctx.llm.listConfigurableProviders().find(entry => entry.provider === config.provider)
  if (provider === undefined) return false
  return ctx.settings.describe().some(entry => String(entry.ns) === provider.settingsNs)
}

/**
 * Wait for both halves of the target: `llm-pi-ai` registers the provider in
 * the directory before its settings entry necessarily reaches the active
 * state. Waiting only for the directory is what let an install-time pass skip
 * with `settings-missing` and then sleep until the six-hour timer.
 */
async function waitForTarget(ctx: Context, config: ResolvedConfig, signal: AbortSignal): Promise<boolean> {
  const deadline = Date.now() + config.startupGraceMs
  for (;;) {
    if (signal.aborted) return false
    try {
      if (targetReady(ctx, config)) return true
    } catch {
      // A settings reload can transiently reject; the next poll retries.
    }
    if (Date.now() >= deadline) return false
    await ctx.timeout(PROVIDER_POLL_MS)
  }
}

/** Whether a startup outcome is worth another attempt shortly. */
export function shouldRetryStartup(report: SyncReport | undefined): boolean {
  if (report?.status === 'failed') return report.reason === 'settings-write-failed'
  if (report?.status !== 'skipped') return false
  return report.reason === 'provider-missing'
    || report.reason === 'settings-missing'
    || report.reason === 'route-missing'
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
    const intervalMs = Math.round(resolved.intervalHours * 3_600_000)
    let running = false
    let pendingCredential = false
    let attempt = 0
    let periodicDispose: (() => void) | undefined
    let credentialDebounceDispose: (() => void) | undefined
    let lastCredentialStartedAt = 0

    const schedulePeriodic = (): void => {
      if (periodicDispose !== undefined) {
        periodicDispose()
        periodicDispose = undefined
      }
      if (lifetime.signal.aborted) return
      periodicDispose = ctx.timeout(() => {
        periodicDispose = undefined
        void runSync('interval')
      }, intervalMs)
    }

    const doSync = async (trigger: SyncTrigger, attemptNo: number): Promise<SyncReport | undefined> => {
      let report: SyncReport
      try {
        report = await synchronize({
          llm: ctx.llm,
          settings: ctx.settings,
          credentials: ctx.credentials,
          fetchModels: options => fetchOpenRouterModels({ ...options, signal: lifetime.signal }),
          log,
        }, resolved, { trigger, signal: lifetime.signal })
      } catch (error) {
        // `synchronize` contains operational failures; this guard covers a
        // programming error or a disposed service and keeps the host alive.
        log.error('unexpected synchronization failure: %s', error instanceof Error ? error.message : String(error))
        return undefined
      }

      const withAttempt: SyncReport = { ...report, attempt: attemptNo }
      if (!lifetime.signal.aborted) {
        ctx.emit('openrouter/models-synced', withAttempt)
        try {
          await writeStatus(withAttempt)
        } catch (error) {
          log.warn('could not write sync status: %s', error instanceof Error ? error.message : String(error))
        }
      }
      return withAttempt
    }

    /**
     * Run one serialized synchronization. A credential change observed while
     * a pass is running earns at most one follow-up pass; startup and interval
     * triggers are dropped rather than queued.
     */
    const runSync = async (trigger: SyncTrigger, forcedAttempt?: number): Promise<SyncReport | undefined> => {
      if (lifetime.signal.aborted) return undefined
      if (running) {
        if (trigger === 'credential') pendingCredential = true
        return undefined
      }

      running = true
      let last: SyncReport | undefined
      let nextTrigger: SyncTrigger = trigger
      let attemptNo = forcedAttempt ?? ++attempt
      try {
        for (;;) {
          last = await doSync(nextTrigger, attemptNo)
          if (lifetime.signal.aborted || !pendingCredential) break
          pendingCredential = false
          nextTrigger = 'credential'
          attemptNo = ++attempt
        }
      } finally {
        running = false
        schedulePeriodic()
      }
      return last
    }

    const bootstrap = async (): Promise<void> => {
      let first = true
      for (const [attemptIndex, delay] of STARTUP_RETRY_DELAYS.entries()) {
        if (lifetime.signal.aborted) return
        if (delay > 0) {
          await ctx.timeout(delay)
          if (lifetime.signal.aborted) return
        }
        if (first) {
          first = false
          const ready = await waitForTarget(ctx, resolved, lifetime.signal)
          if (lifetime.signal.aborted) return
          if (ready) {
            await ctx.timeout(STARTUP_SETTLE_MS)
            if (lifetime.signal.aborted) return
          }
        }
        const report = await runSync('startup')
        if (report?.status === 'failed' && report.reason === 'settings-write-failed' && attemptIndex >= 1) return
        if (!shouldRetryStartup(report)) return
      }
    }

    const requestCredentialSync = (): void => {
      if (credentialDebounceDispose !== undefined) {
        credentialDebounceDispose()
        credentialDebounceDispose = undefined
      }
      credentialDebounceDispose = ctx.timeout(() => {
        credentialDebounceDispose = undefined
        if (lifetime.signal.aborted) return
        const now = Date.now()
        if (now - lastCredentialStartedAt < CREDENTIAL_COOLDOWN_MS) return
        lastCredentialStartedAt = now
        if (running) {
          pendingCredential = true
          return
        }
        void runSync('credential')
      }, CREDENTIAL_DEBOUNCE_MS)
    }

    ctx.timeout(() => void bootstrap(), 0)

    ctx.on('credentials/reference-updated', (ref) => {
      if (lifetime.signal.aborted) return
      try {
        const watched = currentKeyRef(ctx, resolved)
        if (watched !== undefined && String(ref) === watched) requestCredentialSync()
      } catch (error) {
        log.warn('credential update could not be matched to the route: %s', error instanceof Error ? error.message : String(error))
      }
    })

    ctx.effect(() => () => {
      lifetime.abort(new Error('openrouter-sync-models disposed'))
      if (credentialDebounceDispose !== undefined) credentialDebounceDispose()
      if (periodicDispose !== undefined) periodicDispose()
    }, 'openrouter-sync-models: abort in-flight catalog request and timers')
  })
}

/** Logger type re-exported for test doubles and downstream consumers. */
export type { Logger }
