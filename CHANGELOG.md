# Changelog

All notable changes to this project are documented here.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

## [0.1.6] - 2026-11-02

### Fixed

- Schedule startup, periodic, and credential timers outside the HMR
  transaction's `AsyncLocalStorage` context. An install/update pass now queues
  its settings write behind the active reconciliation instead of failing with
  `HMR transactions cannot be nested`.
- Fall back to the public `plugin-manager/changed` event when that internal HMR
  scope cannot be escaped.

## [0.1.5] - 2026-11-02

### Fixed

- Re-read the provider route and settings revision after the catalog fetch, so
  an HMR recomposition during install/update no longer makes the write fail
  with a stale revision.
- Retry transient settings conflicts and reload races with the fresh revision.
- Retry the startup pass when it fails at the settings write.

### Added

- Failure detail in the last-attempt record at
  `$DSH_HOME/cache/openrouter-sync-models.json`.

## [0.1.4] - 2026-11-02

### Fixed

- A first sync during install/reload waits for both the provider directory and
  the active `llm-pi-ai` settings descriptor, then retries briefly instead of
  skipping until the six-hour interval.
- Refresh triggers are now strictly limited to the startup pass, a change of
  the route's own OpenRouter credential, and the periodic pass.

### Added

- A durable last-attempt record at
  `$DSH_HOME/cache/openrouter-sync-models.json` with trigger, attempt, status,
  and skip/failure reason.

## [0.1.3] - 2026-11-02

### Changed

- Aligned the README architecture diagram and documented the shipped and
  custom `<profile>` targets the plugin can be installed into.

## [0.1.2] - 2026-11-02

### Changed

- Restyled the README after the other DSH plugins: centered badges, highlights,
  an architecture diagram, a quick-start flow, and clearer behavior notes.

## [0.1.1] - 2026-11-02

### Changed

- The release workflow skips npm publication when the package version is
  already live, so a manual publish no longer makes a later tag run fail.

## [0.1.0] - 2026-11-02

### Added

- A host-only DSH bundle that synchronizes the `llm-pi-ai` OpenRouter model
  list with the authenticated OpenRouter catalog at startup, every six hours,
  and after the route credential changes.
- Authenticated catalog access so account-specific `@preset/...` models are
  included.
- Projection of OpenRouter capacities, modalities, reasoning efforts, and
  evidenced compatibility switches into DSH model profiles.
- Configurable filtering: presets, free-only, tools, text output, chat endpoint,
  context floor, exclusions, and output-cap clamping.
- Live `openrouter/models-synced` report event and `ctx.logger` diagnostics.
- Idempotent writes through `ctx.settings.mutate()`; no profile paths, YAML
  surgery, status files, or backups.
