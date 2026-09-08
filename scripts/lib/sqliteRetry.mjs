/**
 * Retry helper for `database disk image is malformed` on the live database.
 *
 * Mirror of `server/src/lib/sqliteRetry.ts` — the maintenance scripts are plain
 * node and run without a build step, so they cannot import the compiled module.
 * Keep the two in sync.
 *
 * The file is not actually corrupt. A read that stays open long enough for the
 * writer to check the WAL back in loses the snapshot it was holding, and SQLite
 * reports that as a malformed image. Waiting for the writer to move on and
 * running the identical statement again is the fix.
 */
const MALFORMED_PATTERN = /malformed|database disk image/i

export const MALFORMED_RETRIES = 3
export const MALFORMED_RETRY_DELAY_MS = 2000

export function isMalformedError(error) {
  return error instanceof Error && MALFORMED_PATTERN.test(error.message)
}

/** better-sqlite3 is synchronous, so there is nothing to await between attempts. */
function sleepSync(ms) {
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms)
}

/**
 * Run `fn`, retrying it on a malformed-image error. Any other error, and the
 * error that survives the last retry, propagates to the caller unchanged.
 */
export function withMalformedRetry(fn, options = {}) {
  const { label = 'statement', retries = MALFORMED_RETRIES, delayMs = MALFORMED_RETRY_DELAY_MS } = options

  for (let attempt = 1; ; attempt++) {
    try {
      return fn()
    } catch (error) {
      if (!isMalformedError(error) || attempt > retries) throw error
      console.warn(
        `${label}: ${error.message} — WAL snapshot lost, retrying in ${delayMs}ms ` +
          `(attempt ${attempt}/${retries})`
      )
      sleepSync(delayMs)
    }
  }
}
