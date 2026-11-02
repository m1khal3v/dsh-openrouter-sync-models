/**
 * Break out of the HMR transaction's AsyncLocalStorage context when scheduling
 * our own timers.
 *
 * `dsh-hmr` rejects a nested `runExclusive`, and its transaction marker lives
 * in an `AsyncLocalStorage` that Node propagates into timers created inside
 * `apply()`. A settings write triggered by such a timer therefore fails with
 * "HMR transactions cannot be nested" even after the reconciliation itself has
 * finished. `AsyncLocalStorage.exit` — which `dsh-hmr` also uses internally
 * for `watchConfig` — creates a timer outside that context. The actual HMR
 * transaction is untouched; our eventual `settings.mutate` queues behind it
 * through `runExclusive` and runs once it has completed.
 *
 * @module dsh-openrouter-sync-models/hmr-context
 */

import type { Context } from '@deepseek-ai/cordis'

/** Narrow runtime view of the HMR service's transaction scope. */
interface HmrTransactionScope {
  /** The private AsyncLocalStorage that carries the transaction marker. */
  executing?: {
    getStore?: () => unknown
    exit?: <T>(callback: () => T) => T
  }
}

/** Read the optional HMR service without importing its private types. */
function hmrScope(ctx: Context): HmrTransactionScope | undefined {
  try {
    return ctx.get('hmr') as HmrTransactionScope | undefined
  } catch {
    return undefined
  }
}

/**
 * Run `operation` outside an active HMR transaction's AsyncLocalStorage
 * context, so timers created by it do not inherit the transaction marker.
 * @param ctx - context possibly carrying `hmr`.
 * @param operation - synchronous timer registration.
 * @returns `true` when the operation ran; `false` when an active transaction
 *   could not be escaped because the internal scope API is unavailable.
 */
export function runOutsideHmr(ctx: Context, operation: () => void): boolean {
  const hmr = hmrScope(ctx)
  const executing = hmr?.executing
  try {
    const exit = executing?.exit
    if (typeof exit === 'function') {
      exit.call(executing, operation)
      return true
    }
  } catch {
    // Fall through to the conservative path below.
  }

  try {
    if (hmr?.executing?.getStore?.() === true) return false
  } catch {
    // An unreadable scope is treated as not nested.
  }

  operation()
  return true
}
