# Changelog

All notable changes to this project are documented here.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

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
