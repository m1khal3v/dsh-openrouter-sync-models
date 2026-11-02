/**
 * Observable result of one catalog synchronization.
 *
 * The report is emitted on the live Cordis event bus, not written to the
 * Session log: it describes host configuration maintenance, not model-visible
 * conversation state, so a harness that does not know this event can still
 * resume sessions that ran with the plugin.
 *
 * @module dsh-openrouter-sync-models/types
 */

/** What initiated one synchronization. */
export type SyncTrigger = 'startup' | 'interval' | 'credential'

/** Terminal outcome of one synchronization. */
export type SyncStatus = 'updated' | 'unchanged' | 'skipped' | 'failed'

/** One synchronization result. */
export interface SyncReport {
  /** ISO timestamp of the completed attempt. */
  at: string
  /** What initiated the attempt. */
  trigger: SyncTrigger
  /** Provider route the attempt targeted. */
  provider: string
  /** Settings namespace that owns the route, when discovered. */
  ns?: string
  /** Terminal outcome. */
  status: SyncStatus
  /** One-based attempt number within this host process. */
  attempt?: number
  /** Stable machine-readable reason for a skip or failure. */
  reason?: string
  /** Entries returned by the endpoint. */
  fetched?: number
  /** Entries kept after filtering. */
  selected?: number
  /** Account presets among the kept entries. */
  presets?: number
  /** Model ids added by this write. */
  added?: string[]
  /** Model ids removed by this write. */
  removed?: string[]
}

declare module '@deepseek-ai/cordis' {
  interface Events {
    /**
     * One OpenRouter model synchronization completed or was skipped.
     * @param report - the terminal result.
     * @mode emit
     */
    'openrouter/models-synced'(report: SyncReport): void
  }
}
