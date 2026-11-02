import { afterEach, describe, expect, it, vi } from 'vitest'
import { fetchOpenRouterModels, OpenRouterModelsError } from '../src/openrouter.ts'

/** Build a successful JSON response. */
function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  })
}

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('fetchOpenRouterModels', () => {
  it('sends the bearer token and returns the data array', async () => {
    const fetchMock = vi.fn(async () => jsonResponse({ data: [{ id: 'vendor/model' }] }))
    vi.stubGlobal('fetch', fetchMock)

    const models = await fetchOpenRouterModels({
      endpoint: 'https://openrouter.ai/api/v1/models',
      apiKey: 'secret',
      timeoutMs: 1_000,
    })

    expect(models).toEqual([{ id: 'vendor/model' }])
    const init = fetchMock.mock.calls[0]?.[1] as RequestInit
    expect(init.headers).toMatchObject({ authorization: 'Bearer secret', accept: 'application/json' })
  })

  it('omits authorization when no key is supplied', async () => {
    const fetchMock = vi.fn(async () => jsonResponse({ data: [] }))
    vi.stubGlobal('fetch', fetchMock)

    await fetchOpenRouterModels({
      endpoint: 'https://openrouter.ai/api/v1/models',
      timeoutMs: 1_000,
    })

    const init = fetchMock.mock.calls[0]?.[1] as RequestInit
    expect((init.headers as Record<string, string>).authorization).toBeUndefined()
  })

  it('reports the HTTP status on a refused request', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => jsonResponse({ error: 'unauthorized' }, 401)))

    await expect(fetchOpenRouterModels({
      endpoint: 'https://openrouter.ai/api/v1/models',
      apiKey: 'expired',
      timeoutMs: 1_000,
    })).rejects.toMatchObject({ name: 'OpenRouterModelsError', status: 401 })
  })

  it('rejects a response without a data array', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => jsonResponse({ total_count: 0 })))

    await expect(fetchOpenRouterModels({
      endpoint: 'https://openrouter.ai/api/v1/models',
      timeoutMs: 1_000,
    })).rejects.toBeInstanceOf(OpenRouterModelsError)
  })
})
