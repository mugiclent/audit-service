/** Delays in ms for attempts 2 and 3 (attempt 1 is immediate). */
const BACKOFF_MS = [0, 2_000, 8_000] as const;

const sleep = (ms: number): Promise<void> =>
  new Promise((resolve) => setTimeout(resolve, ms));

/**
 * Execute `fn` up to `maxAttempts` times with exponential backoff.
 *
 * - Returns `{ result, attempts }` on success.
 * - Throws the last error after all attempts are exhausted.
 *
 * Errors tagged with `retryable: false` are re-thrown immediately without
 * further attempts (e.g. bad data that won't fix itself on retry).
 */
export const withRetry = async <T>(
  fn: () => Promise<T>,
  maxAttempts = 3,
): Promise<{ result: T; attempts: number }> => {
  let lastError: Error = new Error('Unknown error');

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    if (attempt > 1) {
      await sleep(BACKOFF_MS[attempt - 1] ?? 8_000);
    }

    try {
      const result = await fn();
      return { result, attempts: attempt };
    } catch (err) {
      const e = err as Error & { retryable?: boolean };
      lastError = e;

      if (e.retryable === false) {
        Object.assign(e, { attempts: attempt });
        throw e;
      }

      console.warn(`[retry] Attempt ${attempt}/${maxAttempts} failed: ${e.message}`);
    }
  }

  Object.assign(lastError, { attempts: maxAttempts });
  throw lastError;
};
