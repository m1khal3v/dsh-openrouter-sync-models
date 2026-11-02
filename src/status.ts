/**
 * Best-effort diagnostic record of the last synchronization attempt.
 *
 * `ctx.logger` is the canonical logging seam, but desktop builds keep its
 * messages in an in-memory buffer and send stdout/stderr to `/dev/null`. This
 * file is the durable answer to "did the install-time pass run, and if not,
 * why" without adding another event listener or network request.
 *
 * @module dsh-openrouter-sync-models/status
 */

import { mkdir, writeFile } from 'node:fs/promises'
import { dirname } from 'node:path'
import { dshCachePath } from '@deepseek-ai/dsh-home-paths'
import type { SyncReport } from './types.ts'

/** File name inside `$DSH_HOME/cache`. */
const STATUS_FILE = 'openrouter-sync-models.json'

/**
 * Persist one attempt's terminal report.
 * @param report - the report already emitted for this attempt.
 * @returns the written path.
 * @throws when the cache directory or file cannot be written; callers treat
 *   this as a diagnostic failure, never a synchronization failure.
 */
export async function writeStatus(report: SyncReport): Promise<string> {
  const file = dshCachePath(STATUS_FILE)
  await mkdir(dirname(file), { recursive: true })
  await writeFile(file, `${JSON.stringify(report, null, 2)}\n`, 'utf8')
  return file
}
