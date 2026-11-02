import { AsyncLocalStorage } from 'node:async_hooks'
import type { Context } from '@deepseek-ai/cordis'
import { describe, expect, it, vi } from 'vitest'
import { runOutsideHmr } from '../src/hmr-context.ts'

/** Build a context whose optional HMR service exposes one transaction scope. */
function context(scope: unknown): Context {
  return {
    get: (name: string) => name === 'hmr' ? { executing: scope } : undefined,
  } as unknown as Context
}

describe('runOutsideHmr', () => {
  it('creates timers outside the active transaction context', async () => {
    const store = new AsyncLocalStorage<boolean>()
    const ctx = context(store)

    await new Promise<void>((resolve) => {
      const ran = store.run(true, () => runOutsideHmr(ctx, () => {
        setTimeout(() => {
          expect(store.getStore()).toBeUndefined()
          resolve()
        }, 0)
      }))
      expect(ran).toBe(true)
    })
  })

  it('refuses to run when an active scope has no exit primitive', () => {
    const ctx = context({ getStore: () => true })
    const operation = vi.fn()

    expect(runOutsideHmr(ctx, operation)).toBe(false)
    expect(operation).not.toHaveBeenCalled()
  })

  it('runs normally outside a transaction and without an HMR service', () => {
    const outside = context({ getStore: () => undefined })
    const operation = vi.fn()
    expect(runOutsideHmr(outside, operation)).toBe(true)
    expect(operation).toHaveBeenCalledOnce()

    const absent = { get: () => undefined } as unknown as Context
    const again = vi.fn()
    expect(runOutsideHmr(absent, again)).toBe(true)
    expect(again).toHaveBeenCalledOnce()
  })
})
