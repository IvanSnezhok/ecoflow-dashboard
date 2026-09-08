/**
 * Retry helper for `database disk image is malformed` on the live database.
 *
 * The file is not actually corrupt. A read that stays open long enough for the
 * writer to check the WAL back in loses the snapshot it was holding, and SQLite
 * reports that as a malformed image. Empirically it takes a single `fetchall` of
 * roughly 150K rows on `device_states` to hit it; the app's queries are bounded
 * well below that and maintenance scripts scan forward by primary key in batches
 * of 5000. This is the defence-in-depth layer under those batches: wait for the
 * writer to move on, then run the identical statement again.
 */
const MALFORMED_PATTERN = /malformed|database disk image/i

export const MALFORMED_RETRIES = 3
export const MALFORMED_RETRY_DELAY_MS = 2000

export function isMalformedError(error: unknown): boolean {
  return error instanceof Error && MALFORMED_PATTERN.test(error.message)
}

export interface MalformedRetryOptions {
  /** Shown in the retry log so the operator can see which read is struggling. */
  label?: string
  retries?: number
  delayMs?: number
}

/** better-sqlite3 is synchronous, so there is nothing to await between attempts. */
function sleepSync(ms: number): void {
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms)
}

/**
 * Run `fn`, retrying it on a malformed-image error. Any other error, and the
 * error that survives the last retry, propagates to the caller unchanged.
 */
export function withMalformedRetry<T>(fn: () => T, options: MalformedRetryOptions = {}): T {
  const { label = 'statement', retries = MALFORMED_RETRIES, delayMs = MALFORMED_RETRY_DELAY_MS } = options

  for (let attempt = 1; ; attempt++) {
    try {
      return fn()
    } catch (error) {
      if (!isMalformedError(error) || attempt > retries) throw error
      console.warn(
        `${label}: ${(error as Error).message} — WAL snapshot lost, retrying in ${delayMs}ms ` +
          `(attempt ${attempt}/${retries})`
      )
      sleepSync(delayMs)
    }
  }
}
