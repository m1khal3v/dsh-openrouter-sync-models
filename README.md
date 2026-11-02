<p align="center">
  <a href="https://www.npmjs.com/package/dsh-openrouter-sync-models"><img alt="npm" src="https://img.shields.io/npm/v/dsh-openrouter-sync-models?style=flat-square&color=4b6fff"></a>
  <img alt="DeepSeek Harness" src="https://img.shields.io/badge/deepseek--harness-v0.2.1--rc.5-263146?style=flat-square">
  <a href="LICENSE"><img alt="MIT License" src="https://img.shields.io/badge/license-MIT-263146?style=flat-square"></a>
</p>

<h1 align="center">dsh-openrouter-sync-models</h1>
<p align="center">
  <b>An always-current OpenRouter model catalog for <a href="https://github.com/deepseek-ai/deepseek-harness">DeepSeek Harness</a>.</b><br>
  Keeps the <code>llm-pi-ai</code> OpenRouter route in sync at startup, every six hours, and whenever your key changes — including account-only <code>@preset/...</code> models.
</p>

---

## ⚡️ Highlights

- 🔐 **Authenticated catalog** — uses your OpenRouter token, so custom presets and account-specific models are included, not just the public list.
- 🧩 **One plugin, every surface** — desktop, web, and CLI. It discovers the route through `ctx.llm` and writes through `ctx.settings`, with no profile paths or build-mode branches.
- 🧼 **Zero YAML surgery** — no regex, no `DSH_HOME`, no `DSH_PROFILE`, no backups or status files. DSH owns atomic writes, revision checks, and HMR.
- 🎛 **Useful by default** — tool-capable, text-output, chat-reachable models only. Presets on, paid and free models both included.
- 🧠 **Detail-aware mapping** — capacities, input modalities, reasoning efforts, and evidenced compatibility flags are projected into the model profiles.
- 📡 **Observable** — structured `ctx.logger` diagnostics plus a live `openrouter/models-synced` event.

---

## 🛠 How It Works

```text
OpenRouter              Sync Plugin               Settings (Patch)                llm-pi-ai
    │                         │                           │                             │
    │                         │ GET /api/v1/models        │                             │
    │◄────────────────────────│ (resolves token)          │                             │
    │ (Bearer token)          │                           │                             │
    │                         │                           │                             │
    │ JSON Catalog Array      │                           │                             │
    │────────────────────────►│                           │                             │
    │                         │ ctx.settings.mutate()     │                             │
    │                         │──────────────────────────►│                             │
    │                         │ (filtered & projected)    │                             │
    │                         │                           │ DSH persists &              │
    │                         │                           │ validates patch             │
    │                         │                           │─────────────────┐           │
    │                         │                           │                 │           │
    │                         │                           │◄────────────────┘           │
    │                         │                           │                             │
    │                         │                           │ Applies live via HMR        │
    │                         │                           │────────────────────────────►│
```

1. The plugin finds the `openrouter` route through `ctx.llm.listConfigurableProviders()`.
2. It resolves the route's `apiKeyEnv` through `ctx.credentials` and requests the authenticated catalog.
3. The response is filtered and projected into DSH model profiles.
4. Only `api` and `models` are written, through `ctx.settings.mutate()`.
5. DSH persists the active profile patch, validates the result, and applies it live through HMR.

No restart is needed for model updates.

---

## 🚀 Quick Start

### 1. Install the plugin

```sh
dsh plugin --profile <profile> add dsh-openrouter-sync-models
```

`<profile>` is the profile directory name under `$DSH_HOME/profiles/<name>`. Install the plugin into every profile you actually boot.

| `<profile>` | What it runs | How to install |
|---|---|---|
| `web` | Shipped browser surface, booted by `dsh web` or `dsh --profile web` | `dsh plugin --profile web add dsh-openrouter-sync-models` |
| `headless` | Shipped one-shot CLI, booted by `dsh --profile headless "job"` | `dsh plugin --profile headless add dsh-openrouter-sync-models` |
| `sdk` | Shipped SDK host over JSON-RPC stdio | `dsh plugin --profile sdk add dsh-openrouter-sync-models` |
| `sdk-minimal` | Shipped minimal SDK agent tree | `dsh plugin --profile sdk-minimal add dsh-openrouter-sync-models` |
| `acp` | Shipped ACP stdio host | `dsh plugin --profile acp add dsh-openrouter-sync-models` |
| `desktop` | Electron-owned desktop profile | Use the app's **Plugins** page, or the desktop-installed `dsh` command. The npm CLI rejects plugin management for `desktop`. |
| `<name>` (custom) | Any other profile directory | Initialize it with `dsh --profile <name> --from-default-profile web` (or another shipped template), then install the plugin into it. |

The shipped `web`, `headless`, `sdk`, `sdk-minimal`, and `acp` profiles initialize automatically on first use. A custom profile name is just a directory under `$DSH_HOME/profiles/`, so the same plugin can be installed independently into several profiles.

If a profile omits the `settings` or `credentials` services, the plugin still loads but leaves synchronization inactive.

Or from a local checkout:

```sh
pnpm install
pnpm run build
dsh plugin --profile <profile> add file:~/projects/mine/dsh-openrouter-sync-models
```

### 2. Configure the OpenRouter route

The plugin only writes `api` and `models`; the route itself stays user-owned:

```yaml
- id: llm-pi-ai
  name: '@deepseek-ai/dsh-llm-pi-ai'
  config:
    providers:
      openrouter:
        apiKeyEnv: OPENROUTER_API_KEY
        # api and models are maintained by dsh-openrouter-sync-models
```

### 3. Provide the key

Store `OPENROUTER_API_KEY` through the harness credential store, the environment, or the profile's credential layer.

The catalog endpoint is public, but the authenticated response is the one that contains `@preset/...` models. Without a key the plugin skips the pass by default rather than deleting every preset.

---

## ⚙️ Configuration

Every field is optional.

| Key | Default | Description |
|---|---|---|
| `provider` | `openrouter` | `llm-pi-ai` provider route to synchronize |
| `endpoint` | `https://openrouter.ai/api/v1/models` | Catalog endpoint |
| `api` | `openai-completions` | Route-level wire protocol written beside the list |
| `apiKeyEnv` | `OPENROUTER_API_KEY` | Credential reference used when the route names none |
| `requireKey` | `true` | Skip when the credential cannot be resolved |
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

---

## 🧬 What Gets Mapped

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

---

## 🧠 Behavior & Good to Know

- **Strict refresh policy.** Within one host process the catalog refreshes on exactly three triggers:
  - the startup pass;
  - a change of the route's own OpenRouter credential;
  - the periodic pass six hours after the last completed attempt.
- **No event storms.** HMR, settings, adapter, plugin-manager, and profile-reload events do not start a catalog request.
- **Startup waits for both halves.** The first pass waits for the provider directory entry and the active `llm-pi-ai` settings descriptor, then retries briefly (`0 → 1 → 3 → 10 s`) if the loader is still settling. This prevents an install-time pass from skipping with `settings-missing` and sleeping until the next interval.
- **Credential pass** runs only when the exact route reference (`apiKeyEnv`, then the configured fallback) changes. Updates are debounced, and a change during a running pass queues at most one follow-up.
- **Periodic pass** is rescheduled six hours after every completed attempt; it is never overlapped with another pass.
- **Install/update writes survive HMR.** The first timer is created outside the HMR transaction's `AsyncLocalStorage` context, so the settings write queues behind the active reconciliation instead of failing with `HMR transactions cannot be nested`. The route and settings revision are then re-read after the catalog fetch, and a transient `SETTINGS_CONFLICT` or reload race is retried with the fresh revision before the pass is reported as failed.
- **Empty results are never written.** Network errors, 401/403, empty catalogs, revision conflicts, and validation failures leave the profile untouched.
- **`modelOverrides` is respected.** If the route uses `modelOverrides`, the plugin skips it because DSH refuses `models` beside `modelOverrides`.
- **Route ownership matters.** The route should come from the profile patch or a layer beneath it. A higher-priority home or command-line patch blocks the write; the plugin reports the failure without changing anything.
- **Do not run `dsh-openrouter-sync` beside this plugin.** Both target the same `models` list.
- **OpenRouter OAuth:** the synchronizer resolves `apiKeyEnv`. A route authenticated only through pi-ai's OAuth record has no environment reference; configure `apiKeyEnv` for catalog synchronization even if inference signs in interactively.

### Observability

Logs go through:

```ts
ctx.logger('openrouter-sync-models')
```

Every attempt, including a skip, also writes its last terminal report to:

```text
$DSH_HOME/cache/openrouter-sync-models.json
```

The record includes `at`, `trigger`, `attempt`, `status`, and `reason`, which answers “did the install-time pass run, and if not, why” even when the desktop build sends stdout to `/dev/null`. A failure also carries the provider or settings error message in `detail`.

Model changes are also published as a live event:

```ts
ctx.on('openrouter/models-synced', report => {
  // report.status: updated | unchanged | skipped | failed
  // report.reason: stable reason for a skip/failure
  // report.added / report.removed: model ids
})
```

The event never enters the session log.

---

## 🧑‍💻 Development

```sh
pnpm install
pnpm run verify    # typecheck + tests
pnpm run build
```

`lib/` is generated by `tsdown`; declarations come from `tsc -p tsconfig.types.json`.

The package publishes through GitHub Actions on `v*` tags with npm provenance. Before the first release tag, configure the package's npm **Trusted Publisher** for the `m1khal3v/dsh-openrouter-sync-models` repository and the `release.yml` workflow. The workflow uses OIDC and stores no npm token.

## 📄 License

[MIT](LICENSE)
