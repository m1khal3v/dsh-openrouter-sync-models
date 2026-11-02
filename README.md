# dsh-openrouter-sync-models

Keep the DeepSeek Harness `llm-pi-ai` OpenRouter model list synchronized with the live OpenRouter catalog — including the account-specific `@preset/...` models that OpenRouter returns only for an authenticated request.

A [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness) bundle plugin. Host-only: no client half, no React, no CSS.

## Why

OpenRouter retires models, adds new ones, and lets an account define custom presets. A hand-written `models:` list goes stale, and a public catalog request cannot see the presets at all. This plugin refreshes the list at startup, every six hours, and whenever the route's credential changes.

The plugin does not know whether it runs in the desktop app, the web surface, or the CLI. It discovers the OpenRouter route through `ctx.llm.listConfigurableProviders()` and writes through `ctx.settings.mutate()`, so the active profile patch, revision checks, atomic replacement, and HMR reconciliation are handled by DSH.

## Requirements

- DSH `>=0.2.1-rc.5 <0.3.0`
- Node `^22.19 || >=24`
- An `llm-pi-ai` route named `openrouter` with a credential reference such as `OPENROUTER_API_KEY`

The catalog endpoint is public, but the authenticated response is the one that carries account presets. The plugin therefore requires the key by default and never falls back to the anonymous catalog on its own, which would silently delete every preset.

## Install

```sh
dsh plugin --profile <profile> add dsh-openrouter-sync-models
```

Or install a local checkout:

```sh
pnpm install
pnpm run build
dsh plugin --profile <profile> add file:~/projects/mine/dsh-openrouter-sync-models
```

Enabling the bundle mounts the plugin. HMR applies configuration writes live; a restart is not needed for model updates.

The route must be owned by the profile patch (or inherited from a bundle beneath it). If the route is supplied by a higher-priority home or command-line patch, DSH refuses the settings write and the plugin reports a failure without touching anything.

## Route configuration

The plugin only writes `api` and `models` on the selected route. Everything else stays user-owned:

```yaml
- id: llm-pi-ai
  name: '@deepseek-ai/dsh-llm-pi-ai'
  config:
    providers:
      openrouter:
        apiKeyEnv: OPENROUTER_API_KEY
        # api and models are maintained by dsh-openrouter-sync-models
```

A route with `modelOverrides` is skipped: `models` replaces the installed catalog, and DSH refuses a profile that combines both.

## Configuration

Every field is optional. Defaults are:

| Key | Default | Meaning |
|---|---|---|
| `provider` | `openrouter` | `llm-pi-ai` provider route to synchronize |
| `endpoint` | `https://openrouter.ai/api/v1/models` | Catalog endpoint |
| `api` | `openai-completions` | Route-level wire protocol written beside the list |
| `apiKeyEnv` | `OPENROUTER_API_KEY` | Credential reference used when the route names none |
| `requireKey` | `true` | Refuse to sync when the credential cannot be resolved |
| `includePresets` | `true` | Include account-specific `@preset/...` models |
| `freeOnly` | `false` | Keep only zero-priced models |
| `requireTools` | `true` | Keep only models advertising tool calling |
| `requireTextOutput` | `true` | Keep only plain-text output models |
| `requireChatEndpoint` | `true` | Drop `:batch` entries with no chat endpoint |
| `minContextWindow` | `0` | Minimum advertised context in tokens |
| `maxOutputTokens` | `0` | Clamp a known output cap; `0` keeps the advertised value |
| `excludeModels` | `[]` | Exact model ids to leave out |
| `intervalHours` | `6` | Refresh interval |
| `timeoutMs` | `45000` | HTTP timeout |
| `startupGraceMs` | `30000` | How long startup waits for the provider directory |

Example override:

```yaml
- id: openrouter-sync-models
  name: dsh-openrouter-sync-models
  config:
    freeOnly: true
    minContextWindow: 64000
    excludeModels:
      - openrouter/auto
```

With the defaults, a 2026-11-02 authenticated sample of 416 catalog entries yields roughly 305 models, including account presets. Set `freeOnly: true` to reproduce the old free-only behavior.

## What gets mapped

OpenRouter fields are projected into the subset DSH can actually serve:

| OpenRouter | DSH |
|---|---|
| `id` | `id` |
| `name` | `name` |
| `min(context_length, top_provider.context_length)` | `contextWindow` |
| `top_provider.max_completion_tokens` | `maxTokens` |
| `architecture.input_modalities` | `input` (`text`/`image` only) |
| `reasoning.supported_efforts` | `reasoningEfforts` |
| `reasoning.mandatory` | removes the `off` level |
| `supported_parameters` | selected `compat` flags |

A field OpenRouter omits stays omitted. In particular, when `max_completion_tokens` is absent, `maxTokens` is not written: pi-ai falls back to the installed catalog entry and then to the route default exactly as it does for a hand-written profile.

Compatibility switches are only declared when evidenced:

- `thinkingFormat: 'openrouter'` for chat models
- `maxTokensField: 'max_tokens'` when the model accepts `max_tokens` but not `max_completion_tokens`
- `supportsStrictMode: true` when `structured_outputs` is advertised
- `cacheControlFormat: 'anthropic'` for Anthropic-backed entries, including presets identified by `canonical_slug`
- `supportsDeveloperRole: true` for OpenAI/Anthropic-backed entries
- `requiresReasoningContentOnAssistantMessages: true` for DeepSeek-backed entries

DSH has no model-config field for OpenRouter `description`, pricing, benchmarks, `default_parameters`, voices, links, or `alias_target`, so those are intentionally not projected.

## Behavior and failure policy

- First sync runs once the provider directory exposes `openrouter`.
- Subsequent syncs run every `intervalHours`; an in-flight pass is never overlapped.
- A credential update for the route's reference triggers an immediate pass, so changing accounts refreshes presets without a restart.
- Network errors, 401/403, empty results, revision conflicts, and settings validation failures leave the profile untouched and emit a `failed` or `skipped` report.
- An empty filtered list is never written.
- Removed models are reported in the log and in the `openrouter/models-synced` event.

Do not run the older `dsh-openrouter-sync` plugin at the same time: both target the same `models` list.

### OpenRouter OAuth

The synchronizer resolves `apiKeyEnv` through `ctx.credentials`. A route authenticated only through pi-ai's OAuth credential record has no environment reference; configure `apiKeyEnv` for catalog synchronization even if inference signs in interactively.

## Observability

The plugin logs through `ctx.logger('openrouter-sync-models')`. It also emits:

```ts
ctx.on('openrouter/models-synced', report => {
  // report.status: updated | unchanged | skipped | failed
  // report.reason: stable reason for a skip/failure
  // report.added / report.removed: model ids
})
```

The event is live-only and never enters the session log.

## Development

```sh
pnpm install
pnpm run verify    # typecheck + tests
pnpm run build
```

`lib/` is generated by `tsdown`; declarations come from `tsc -p tsconfig.types.json`. The package publishes through GitHub Actions on `v*` tags with npm provenance.

## License

MIT — see [LICENSE](./LICENSE).
