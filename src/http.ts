export interface RetryOptions {
  retries?: number;
  baseDelayMs?: number;
  maxDelayMs?: number;
  timeoutMs?: number;
  retryOnStatus?: (status: number) => boolean;
  label?: string;
  onRetry?: (error: unknown, attempt: number, delayMs: number) => void;
}

/**
 * Checks if an error is a transient network or timeout error.
 */
export function isTransientNetworkError(err: unknown): boolean {
  if (!err) return false;
  if (err instanceof TypeError && err.message.includes("fetch failed")) {
    return true;
  }
  const errObj = err as { name?: string; code?: string; cause?: { code?: string } };
  if (errObj.name === "TimeoutError" || errObj.name === "AbortError") {
    return true;
  }
  const code = errObj.code || errObj.cause?.code;
  if (
    code === "ECONNRESET" ||
    code === "ETIMEDOUT" ||
    code === "EHOSTUNREACH" ||
    code === "ENOTFOUND" ||
    code === "ECONNREFUSED" ||
    code === "EPIPE"
  ) {
    return true;
  }
  return false;
}

/**
 * Default predicate for retryable HTTP status codes (rate limit and server errors).
 */
export function isRetryableStatusCode(status: number): boolean {
  return (
    status === 429 ||
    status === 500 ||
    status === 502 ||
    status === 503 ||
    status === 504
  );
}

/**
 * Helper to sleep for a given duration.
 */
export function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Fetch with automatic retries and exponential backoff for transient failures.
 */
export async function fetchWithRetry(
  url: string,
  init?: RequestInit,
  options?: RetryOptions,
): Promise<Response> {
  const isTest =
    typeof process !== "undefined" &&
    (process.env?.NODE_ENV === "test" || Boolean(process.env?.VITEST));

  const retries = options?.retries ?? 3;
  const baseDelayMs = options?.baseDelayMs ?? (isTest ? 10 : 1000);
  const maxDelayMs = options?.maxDelayMs ?? 5000;
  const timeoutMs = options?.timeoutMs ?? 10_000;
  const retryOnStatus = options?.retryOnStatus ?? isRetryableStatusCode;

  let lastError: unknown;
  let lastResponse: Response | undefined;

  for (let attempt = 1; attempt <= retries; attempt++) {
    const timeoutSignal = AbortSignal.timeout(timeoutMs);
    const combinedSignal = init?.signal
      ? AbortSignal.any([init.signal, timeoutSignal])
      : timeoutSignal;

    try {
      const response = await fetch(url, {
        ...init,
        signal: combinedSignal,
      });

      if (response.ok || attempt === retries || !retryOnStatus(response.status)) {
        return response;
      }

      lastResponse = response;
      const delayMs = Math.min(
        baseDelayMs * Math.pow(2, attempt - 1) + Math.random() * 50,
        maxDelayMs,
      );
      options?.onRetry?.(
        new Error(`HTTP ${response.status}`),
        attempt,
        Math.round(delayMs),
      );
      await delay(delayMs);
    } catch (err) {
      lastError = err;
      const canRetry = isTransientNetworkError(err) || attempt < retries;
      if (attempt === retries || !canRetry) {
        throw err;
      }

      const delayMs = Math.min(
        baseDelayMs * Math.pow(2, attempt - 1) + Math.random() * 50,
        maxDelayMs,
      );
      options?.onRetry?.(err, attempt, Math.round(delayMs));
      await delay(delayMs);
    }
  }

  if (lastResponse) {
    return lastResponse;
  }
  throw lastError ?? new Error(`fetchWithRetry failed for ${url}`);
}
