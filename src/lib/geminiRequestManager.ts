export type GeminiErrorCategory =
  | 'RATE_LIMIT_TEMPORARY'
  | 'QUOTA_EXHAUSTED'
  | 'AUTH_OR_CONFIG_ERROR'
  | 'SERVER_TRANSIENT'
  | 'GENERATION_FAILED';

export interface ClassifiedGeminiError {
  category: GeminiErrorCategory;
  httpStatus: number;
  retryable: boolean;
  retryAfterMs?: number;
  userMessage: string;
  rawReason: string;
}

export interface GeminiManagerOptions {
  maxConcurrency?: number;
  maxRetries?: number;
  baseDelayMs?: number;
  maxDelayMs?: number;
  cacheTtlMs?: number;
  maxCacheEntries?: number;
  sleepFn?: (ms: number) => Promise<void>;
}

export interface GeminiOperationLog {
  timestamp: string;
  operation: string;
  model: string;
  status: 'success' | 'cached' | 'deduplicated' | 'failed';
  errorCategory?: GeminiErrorCategory;
  retries: number;
  durationMs: number;
  approxInputTokens: number;
  approxOutputTokens: number;
}

/**
 * Parses a Retry-After value or Google RPC retryDelay string (e.g., "4s", "2.5s", "3") into milliseconds.
 */
export function parseRetryAfterMs(rawRetryAfter: unknown): number | undefined {
  if (rawRetryAfter === null || rawRetryAfter === undefined) return undefined;

  if (typeof rawRetryAfter === 'number' && Number.isFinite(rawRetryAfter) && rawRetryAfter > 0) {
    return rawRetryAfter < 1000 ? Math.round(rawRetryAfter * 1000) : Math.round(rawRetryAfter);
  }

  const str = String(rawRetryAfter).trim();
  if (!str) return undefined;

  // Format like "3.5s" or "12s" from Google RPC RetryInfo
  const secMatch = str.match(/^(\d+(?:\.\d+)?)\s*s$/i);
  if (secMatch) {
    const secs = parseFloat(secMatch[1]);
    if (Number.isFinite(secs) && secs > 0) {
      return Math.min(30000, Math.round(secs * 1000));
    }
  }

  // Plain integer seconds header
  const num = Number(str);
  if (Number.isFinite(num) && num > 0) {
    return Math.min(30000, Math.round(num * 1000));
  }

  // HTTP-date Retry-After
  const parsedDate = Date.parse(str);
  if (!Number.isNaN(parsedDate)) {
    const diff = parsedDate - Date.now();
    if (diff > 0) {
      return Math.min(30000, diff);
    }
  }

  return undefined;
}

/**
 * Extracts any embedded Retry-After or Google RPC retryDelay from an SDK error object or message.
 */
export function extractServerRetryGuidanceMs(error: any): number | undefined {
  if (!error) return undefined;

  const headerRetry =
    error?.headers?.['retry-after'] ??
    error?.response?.headers?.['retry-after'] ??
    error?.retryAfter;
  const fromHeader = parseRetryAfterMs(headerRetry);
  if (fromHeader) return fromHeader;

  const details = error?.details || error?.error?.details;
  if (Array.isArray(details)) {
    for (const d of details) {
      if (d?.retryDelay) {
        const parsed = parseRetryAfterMs(d.retryDelay);
        if (parsed) return parsed;
      }
    }
  }

  const msg = String(error?.message || '');
  const retryInMatch = msg.match(/retry\s+(?:in|after)\s+(\d+(?:\.\d+)?)\s*(s|sec|seconds|ms)/i);
  if (retryInMatch) {
    const val = parseFloat(retryInMatch[1]);
    const unit = retryInMatch[2].toLowerCase();
    if (Number.isFinite(val) && val > 0) {
      return Math.min(30000, Math.round(unit === 'ms' ? val : val * 1000));
    }
  }

  return undefined;
}

/**
 * Classifies raw Gemini SDK / HTTP errors into actionable categories with user-friendly messages.
 * Distinguishes temporary rate limits from daily/project quota exhaustion, billing, and auth errors.
 */
export function classifyGeminiError(error: any, preserveExistingNotice = false): ClassifiedGeminiError {
  const status = Number(error?.status || error?.statusCode || error?.error?.code || 0);
  const rawMessage = String(error?.message || error?.error?.message || 'Unknown AI error');
  const lower = rawMessage.toLowerCase();
  const retryAfterMs = extractServerRetryGuidanceMs(error);

  const is429OrQuota =
    status === 429 ||
    lower.includes('429') ||
    lower.includes('resource_exhausted') ||
    lower.includes('exceeded your current quota') ||
    lower.includes('quota_exceeded') ||
    lower.includes('rate limit') ||
    lower.includes('too many requests');

  // 1. Non-retryable Authentication, API Key, or Billing errors (excluding 429 quota messages that mention billing details)
  if (
    !is429OrQuota &&
    (status === 401 ||
      status === 403 ||
      lower.includes('api_key_invalid') ||
      lower.includes('api key not valid') ||
      lower.includes('gemini_api_key is not configured') ||
      lower.includes('permission_denied') ||
      lower.includes('billing') ||
      lower.includes('account is disabled'))
  ) {
    return {
      category: 'AUTH_OR_CONFIG_ERROR',
      httpStatus: status === 401 || status === 403 ? status : 403,
      retryable: false,
      userMessage: preserveExistingNotice
        ? 'AI configuration or billing issue detected. Your existing notes are safe.'
        : 'AI service credentials or project billing require attention. Please check your Gemini API configuration.',
      rawReason: rawMessage.slice(0, 240),
    };
  }

  // 2. Distinguish Daily / Project Quota Exhaustion (non-retryable) from Temporary Rate Limits (retryable)
  const isQuotaExhausted =
    lower.includes('per day') ||
    lower.includes('per_day') ||
    lower.includes('daily quota') ||
    lower.includes('exceeded your current quota') ||
    lower.includes('quota_exceeded') ||
    lower.includes('check your plan and billing') ||
    lower.includes('free_tier_requests_per_day') ||
    lower.includes('generate_content_free_tier_requests');

  if (isQuotaExhausted) {
    return {
      category: 'QUOTA_EXHAUSTED',
      httpStatus: 429,
      retryable: false,
      userMessage: preserveExistingNotice
        ? "Your project's AI quota has been reached. Your existing notes are safe."
        : "Your project's AI quota has been reached.",
      rawReason: rawMessage.slice(0, 240),
    };
  }

  // 3. Temporary Rate Limit (429 / RESOURCE_EXHAUSTED per minute)
  if (
    is429OrQuota ||
    lower.includes('requests per minute') ||
    lower.includes('rpm')
  ) {
    return {
      category: 'RATE_LIMIT_TEMPORARY',
      httpStatus: 429,
      retryable: true,
      retryAfterMs,
      userMessage: preserveExistingNotice
        ? 'Gemini is temporarily busy. Try again shortly. Your existing notes are safe.'
        : 'Gemini is temporarily busy. Try again shortly.',
      rawReason: rawMessage.slice(0, 240),
    };
  }

  // 4. Transient Server Overload (500 / 502 / 503 / 504 / UNAVAILABLE)
  if (
    status === 500 ||
    status === 502 ||
    status === 503 ||
    status === 504 ||
    lower.includes('503') ||
    lower.includes('unavailable') ||
    lower.includes('overloaded') ||
    lower.includes('deadline_exceeded') ||
    lower.includes('internal error')
  ) {
    return {
      category: 'SERVER_TRANSIENT',
      httpStatus: 503,
      retryable: true,
      retryAfterMs,
      userMessage: preserveExistingNotice
        ? 'Gemini is temporarily busy. Try again shortly. Your existing notes are safe.'
        : 'Gemini is temporarily busy. Try again shortly.',
      rawReason: rawMessage.slice(0, 240),
    };
  }

  // 5. Other non-retryable generation errors
  return {
    category: 'GENERATION_FAILED',
    httpStatus: status >= 400 && status < 600 ? status : 500,
    retryable: false,
    userMessage: 'Generation failed. Your existing notes are safe.',
    rawReason: rawMessage.slice(0, 240),
  };
}

/**
 * Computes exponential backoff with full jitter, respecting Retry-After guidance when present.
 */
export function computeBackoffDelayMs(params: {
  attemptIndex: number; // 0-based retry index (0 = first retry)
  baseDelayMs?: number;
  maxDelayMs?: number;
  retryAfterMs?: number;
  randomValue?: number; // injectable for deterministic tests [0, 1)
}): number {
  const {
    attemptIndex,
    baseDelayMs = 1200,
    maxDelayMs = 10000,
    retryAfterMs,
    randomValue = Math.random(),
  } = params;

  const exponential = baseDelayMs * Math.pow(2, Math.max(0, attemptIndex));
  const jitterMs = Math.round(randomValue * 450);
  const computed = Math.min(maxDelayMs, exponential + jitterMs);

  if (retryAfterMs && retryAfterMs > 0) {
    return Math.min(maxDelayMs, Math.max(computed, retryAfterMs) + Math.round(randomValue * 200));
  }

  return computed;
}

/**
 * Generates a fast, deterministic FNV-1a hash string for cache and deduplication keys
 * without storing raw study text in logs.
 */
export function hashRequestPayload(operation: string, payload: unknown): string {
  const raw = typeof payload === 'string' ? payload : JSON.stringify(payload ?? {});
  let hash = 2166136261;
  for (let i = 0; i < raw.length; i++) {
    hash ^= raw.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  const unsigned = (hash >>> 0).toString(16).padStart(8, '0');
  return `${operation}::${unsigned}::len${raw.length}`;
}

/**
 * Centralized Gemini Request Manager:
 * - Bounded concurrency queue
 * - In-flight request deduplication
 * - Bounded TTL cache for deterministic resources
 * - Exponential backoff with jitter for transient 429/503 errors
 * - Privacy-safe telemetry logging
 */
export class GeminiRequestManager {
  private readonly maxConcurrency: number;
  private readonly maxRetries: number;
  private readonly baseDelayMs: number;
  private readonly maxDelayMs: number;
  private readonly cacheTtlMs: number;
  private readonly maxCacheEntries: number;
  private readonly sleepFn: (ms: number) => Promise<void>;

  private activeCount = 0;
  private readonly waitQueue: Array<() => void> = [];
  private readonly inFlight = new Map<string, Promise<any>>();
  private readonly cache = new Map<string, { value: any; expiresAt: number }>();
  private readonly recentLogs: GeminiOperationLog[] = [];
  private totalRequests = 0;
  private cacheHits = 0;
  private deduplicatedHits = 0;
  private totalInputTokensSaved = 0;

  constructor(options: GeminiManagerOptions = {}) {
    this.maxConcurrency = options.maxConcurrency ?? 3;
    this.maxRetries = options.maxRetries ?? 2;
    this.baseDelayMs = options.baseDelayMs ?? 900;
    this.maxDelayMs = options.maxDelayMs ?? 7500;
    this.cacheTtlMs = options.cacheTtlMs ?? 60 * 60 * 1000; // 60 minutes
    this.maxCacheEntries = options.maxCacheEntries ?? 300;
    this.sleepFn =
      options.sleepFn ?? ((ms: number) => new Promise((resolve) => setTimeout(resolve, ms)));
  }

  private async acquireSlot(): Promise<void> {
    if (this.activeCount < this.maxConcurrency) {
      this.activeCount += 1;
      return;
    }
    await new Promise<void>((resolve) => {
      this.waitQueue.push(resolve);
    });
    this.activeCount += 1;
  }

  private releaseSlot(): void {
    this.activeCount = Math.max(0, this.activeCount - 1);
    const next = this.waitQueue.shift();
    if (next) {
      next();
    }
  }

  private recordLog(entry: GeminiOperationLog): void {
    this.totalRequests += 1;
    if (entry.status === 'cached') {
      this.cacheHits += 1;
      this.totalInputTokensSaved += entry.approxInputTokens;
    } else if (entry.status === 'deduplicated') {
      this.deduplicatedHits += 1;
      this.totalInputTokensSaved += entry.approxInputTokens;
    }
    this.recentLogs.push(entry);
    if (this.recentLogs.length > 150) {
      this.recentLogs.shift();
    }
    const logLine = `[GeminiManager] op=${entry.operation} model=${entry.model} status=${entry.status}${
      entry.errorCategory ? ` category=${entry.errorCategory}` : ''
    } retries=${entry.retries} durationMs=${entry.durationMs} approxInTokens=${entry.approxInputTokens} approxOutTokens=${entry.approxOutputTokens}`;
    if (entry.status === 'failed') {
      console.warn(logLine);
    } else {
      console.info(logLine);
    }
  }

  public getRecentLogs(): GeminiOperationLog[] {
    return [...this.recentLogs];
  }

  public getPerformanceStats(): {
    totalRequests: number;
    cacheHits: number;
    deduplicatedHits: number;
    cacheEntriesCount: number;
    activeCount: number;
    queuedCount: number;
    totalInputTokensSaved: number;
    byOperation: Record<
      string,
      {
        count: number;
        avgDurationMs: number;
        cachedCount: number;
        avgInputTokens: number;
      }
    >;
  } {
    const byOperation: Record<
      string,
      {
        count: number;
        totalDurationMs: number;
        avgDurationMs: number;
        cachedCount: number;
        totalInputTokens: number;
        avgInputTokens: number;
      }
    > = {};

    for (const log of this.recentLogs) {
      const entry = byOperation[log.operation] || {
        count: 0,
        totalDurationMs: 0,
        avgDurationMs: 0,
        cachedCount: 0,
        totalInputTokens: 0,
        avgInputTokens: 0,
      };
      entry.count += 1;
      entry.totalDurationMs += log.durationMs;
      if (log.status === 'cached' || log.status === 'deduplicated') {
        entry.cachedCount += 1;
      }
      entry.totalInputTokens += log.approxInputTokens;
      byOperation[log.operation] = entry;
    }

    const formattedOps: Record<
      string,
      {
        count: number;
        avgDurationMs: number;
        cachedCount: number;
        avgInputTokens: number;
      }
    > = {};
    for (const [op, stats] of Object.entries(byOperation)) {
      formattedOps[op] = {
        count: stats.count,
        avgDurationMs: Math.round(stats.totalDurationMs / Math.max(1, stats.count)),
        cachedCount: stats.cachedCount,
        avgInputTokens: Math.round(stats.totalInputTokens / Math.max(1, stats.count)),
      };
    }

    return {
      totalRequests: this.totalRequests,
      cacheHits: this.cacheHits,
      deduplicatedHits: this.deduplicatedHits,
      cacheEntriesCount: this.cache.size,
      activeCount: this.activeCount,
      queuedCount: this.waitQueue.length,
      totalInputTokensSaved: this.totalInputTokensSaved,
      byOperation: formattedOps,
    };
  }

  public getCachedValue<T>(dedupeKey: string): T | undefined {
    const entry = this.cache.get(dedupeKey);
    if (entry && entry.expiresAt > Date.now()) {
      return entry.value as T;
    }
    return undefined;
  }

  public setCachedValue<T>(dedupeKey: string, value: T, customTtlMs?: number): void {
    if (this.cache.size >= this.maxCacheEntries) {
      const oldestKey = this.cache.keys().next().value;
      if (oldestKey) this.cache.delete(oldestKey);
    }
    this.cache.set(dedupeKey, {
      value,
      expiresAt: Date.now() + (customTtlMs ?? this.cacheTtlMs),
    });
  }

  public clearCache(): void {
    this.cache.clear();
  }

  public async execute<T>(params: {
    operation: string;
    model: string;
    dedupeKey: string;
    cacheable?: boolean;
    forceRefresh?: boolean;
    preserveExistingNotice?: boolean;
    approxInputChars?: number;
    task: () => Promise<T>;
  }): Promise<T> {
    const {
      operation,
      model,
      dedupeKey,
      cacheable = true,
      forceRefresh = false,
      preserveExistingNotice = true,
      approxInputChars = 0,
      task,
    } = params;

    const startMs = Date.now();
    const approxInputTokens = Math.max(1, Math.round(approxInputChars / 4));

    // 1. Check server-side result cache unless forceRefresh is requested
    if (cacheable && !forceRefresh) {
      const cachedEntry = this.cache.get(dedupeKey);
      if (cachedEntry && cachedEntry.expiresAt > Date.now()) {
        this.recordLog({
          timestamp: new Date().toISOString(),
          operation,
          model,
          status: 'cached',
          retries: 0,
          durationMs: Date.now() - startMs,
          approxInputTokens,
          approxOutputTokens: 0,
        });
        return cachedEntry.value as T;
      }
    }

    // 2. Deduplicate identical in-flight requests
    const existingFlight = this.inFlight.get(dedupeKey);
    if (existingFlight) {
      this.recordLog({
        timestamp: new Date().toISOString(),
        operation,
        model,
        status: 'deduplicated',
        retries: 0,
        durationMs: Date.now() - startMs,
        approxInputTokens,
        approxOutputTokens: 0,
      });
      return existingFlight as Promise<T>;
    }

    // 3. Queue and execute with bounded retries
    const executionPromise = (async (): Promise<T> => {
      await this.acquireSlot();
      let retriesUsed = 0;

      try {
        for (let attempt = 0; attempt <= this.maxRetries; attempt++) {
          try {
            const result = await task();
            const serializedLen =
              typeof result === 'string'
                ? result.length
                : JSON.stringify(result ?? {}).length;
            const approxOutputTokens = Math.max(1, Math.round(serializedLen / 4));

            if (cacheable) {
              if (this.cache.size >= this.maxCacheEntries) {
                const oldestKey = this.cache.keys().next().value;
                if (oldestKey) this.cache.delete(oldestKey);
              }
              this.cache.set(dedupeKey, {
                value: result,
                expiresAt: Date.now() + this.cacheTtlMs,
              });
            }

            this.recordLog({
              timestamp: new Date().toISOString(),
              operation,
              model,
              status: 'success',
              retries: retriesUsed,
              durationMs: Date.now() - startMs,
              approxInputTokens,
              approxOutputTokens,
            });

            return result;
          } catch (err: any) {
            const classified = classifyGeminiError(err, preserveExistingNotice);
            const canRetry = classified.retryable && attempt < this.maxRetries;

            if (!canRetry) {
              this.recordLog({
                timestamp: new Date().toISOString(),
                operation,
                model,
                status: 'failed',
                errorCategory: classified.category,
                retries: retriesUsed,
                durationMs: Date.now() - startMs,
                approxInputTokens,
                approxOutputTokens: 0,
              });

              const enrichedError: any = new Error(classified.userMessage);
              enrichedError.status = classified.httpStatus;
              enrichedError.category = classified.category;
              enrichedError.retryable = classified.retryable;
              enrichedError.rawReason = classified.rawReason;
              throw enrichedError;
            }

            retriesUsed += 1;
            const delayMs = computeBackoffDelayMs({
              attemptIndex: attempt,
              baseDelayMs: this.baseDelayMs,
              maxDelayMs: this.maxDelayMs,
              retryAfterMs: classified.retryAfterMs,
            });
            await this.sleepFn(delayMs);
          }
        }

        throw new Error('Generation failed. Your existing notes are safe.');
      } finally {
        this.releaseSlot();
      }
    })();

    this.inFlight.set(dedupeKey, executionPromise);
    try {
      return await executionPromise;
    } finally {
      this.inFlight.delete(dedupeKey);
    }
  }
}
