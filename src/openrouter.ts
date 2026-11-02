/**
 * Authenticated OpenRouter catalog client.
 *
 * The models endpoint is public, but the authenticated response is the one
 * that includes the caller's custom `@preset/...` models. Presets are part of
 * the account's model surface, so the synchronizer always prefers an
 * authenticated request and never falls back to the anonymous response on its
 * own: an anonymous refresh would silently remove every preset from the
 * profile.
 *
 * @module dsh-openrouter-sync-models/openrouter
 */

/** One OpenRouter model as returned by `GET /api/v1/models`. */
export interface OpenRouterModel {
  /** Model or preset id accepted by the chat-completions endpoint. */
  id: string
  /** Human-readable name. */
  name?: string
  /** Canonical slug of the underlying model; preset ids differ from it. */
  canonical_slug?: string
  /** Token/context and modality facts. */
  architecture?: {
    modality?: string
    input_modalities?: string[]
    output_modalities?: string[]
    tokenizer?: string | null
    instruct_type?: string | null
  }
  /** Model context window in tokens. */
  context_length?: number
  /** Per-token prices as decimal strings. */
  pricing?: {
    prompt?: string
    completion?: string
    request?: string
    image?: string
    audio?: string
    web_search?: string
    input_cache_read?: string
    input_cache_write?: string
    [field: string]: unknown
  }
  /** Serving facts of the top provider. */
  top_provider?: {
    context_length?: number
    max_completion_tokens?: number
    is_moderated?: boolean
  }
  /** Request parameters the model accepts. */
  supported_parameters?: string[]
  /** ISO date after which the model is retired, when advertised. */
  expiration_date?: string | null
  /** Reasoning capabilities, when the model reasons. */
  reasoning?: {
    mandatory?: boolean
    default_enabled?: boolean
    supported_efforts?: string[]
    default_effort?: string
    supports_max_tokens?: boolean
    [field: string]: unknown
  }
  /** Endpoints the model is reachable through. */
  endpoints?: string[]
  /** Additional catalog facts this plugin intentionally does not map. */
  [field: string]: unknown
}

/** Response envelope of the OpenRouter models endpoint. */
export interface OpenRouterModelsResponse {
  data?: OpenRouterModel[]
  total_count?: number
  links?: unknown
}

/** Inputs for one catalog request. */
export interface FetchModelsOptions {
  /** Catalog endpoint. */
  endpoint: string
  /** Resolved API key; omitted for an explicitly anonymous request. */
  apiKey?: string
  /** Request timeout in milliseconds. */
  timeoutMs: number
  /** Plugin lifetime cancellation. */
  signal?: AbortSignal
}

/** One HTTP failure from the catalog endpoint. */
export class OpenRouterModelsError extends Error {
  /** HTTP status when a response was received. */
  readonly status?: number

  /**
   * @param message - redacted failure summary.
   * @param status - response status, when available.
   */
  constructor(message: string, status?: number) {
    super(message)
    this.name = 'OpenRouterModelsError'
    this.status = status
  }
}

/**
 * Flatten a network rejection and its causes into one diagnostic string.
 * Node's `fetch` reports only `fetch failed`; the useful code
 * (`ENOTFOUND`, `ECONNRESET`, `CERT_HAS_EXPIRED`, …) lives on `cause`.
 * @param error - unknown rejection value.
 * @returns the message/code chain, without repeating frames.
 */
export function describeFetchError(error: unknown): string {
  const parts: string[] = []
  const seen = new Set<unknown>()
  let current: unknown = error

  for (let depth = 0; depth < 4 && current !== undefined && current !== null && !seen.has(current); depth += 1) {
    seen.add(current)
    if (current instanceof Error) {
      if (current.message.length > 0) parts.push(current.message)
      const code = (current as { code?: unknown }).code
      if (typeof code === 'string' && code.length > 0) parts.push(code)
      current = (current as { cause?: unknown }).cause
    } else {
      parts.push(String(current))
      break
    }
  }

  return [...new Set(parts)].filter(part => part.length > 0).join(': ')
}

/**
 * Fetch the authenticated OpenRouter catalog.
 * @param options - endpoint, credential, timeout, and lifetime signal.
 * @returns the raw model list in endpoint order.
 * @throws {OpenRouterModelsError} on transport failure, non-2xx status, or a
 *   response that carries no model array.
 */
export async function fetchOpenRouterModels(options: FetchModelsOptions): Promise<OpenRouterModel[]> {
  const headers: Record<string, string> = { accept: 'application/json' }
  if (options.apiKey !== undefined && options.apiKey.length > 0) {
    headers.authorization = `Bearer ${options.apiKey}`
  }

  const timeout = AbortSignal.timeout(options.timeoutMs)
  const signal = options.signal === undefined ? timeout : AbortSignal.any([options.signal, timeout])

  let response: Response
  try {
    response = await fetch(options.endpoint, { headers, signal })
  } catch (error) {
    throw new OpenRouterModelsError(`models request failed: ${describeFetchError(error)}`)
  }

  if (!response.ok) {
    throw new OpenRouterModelsError(`models request failed: HTTP ${response.status}`, response.status)
  }

  let payload: OpenRouterModelsResponse
  try {
    payload = await response.json() as OpenRouterModelsResponse
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error)
    throw new OpenRouterModelsError(`models response is not JSON: ${detail}`)
  }

  if (!Array.isArray(payload.data)) {
    throw new OpenRouterModelsError('models response carries no data array')
  }

  return payload.data
}
