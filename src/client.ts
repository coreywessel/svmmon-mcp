/**
 * Shared Svmmon API client for svmmon-mcp.
 *
 * Responsibilities:
 *   - Read SVMMON_API_KEY + SVMMON_BASE_URL from env ONCE at construction.
 *   - request(): inject `Authorization: Bearer <key>`, parse JSON, and map
 *     upstream HTTP status codes into clean, human SvmmonApiError messages.
 *   - NEVER log the key, the Authorization header, or echo the key in any error.
 *   - NEVER auto-retry. The caller decides; cost-burning POSTs must never be
 *     retried by the wrapper (a timeout may have succeeded server-side).
 *
 * Security notes (non-negotiable, per build plan §5):
 *   - The key lives only in this object's private field + the outbound header.
 *   - It is never put in argv/process.title, never written to disk, never logged.
 *   - Error text is built only from the upstream `{ error }` body + status — the
 *     key cannot leak into it because we never interpolate the key anywhere.
 */

const DEFAULT_BASE_URL = 'https://app.svmmonapp.com';

/** A clean, already-human-readable error to surface as an MCP tool error. */
export class SvmmonApiError extends Error {
  /** HTTP status (0 for network/transport failures). */
  readonly status: number;
  /** Seconds to wait before retrying, when the upstream sent Retry-After (429/503). */
  readonly retryAfterSeconds?: number;
  /** Extra structured fields from the API error body (failure_mode, flagged_words, ...). */
  readonly details?: Record<string, unknown>;

  constructor(
    message: string,
    status: number,
    opts?: { retryAfterSeconds?: number; details?: Record<string, unknown> },
  ) {
    super(message);
    this.name = 'SvmmonApiError';
    this.status = status;
    this.retryAfterSeconds = opts?.retryAfterSeconds;
    this.details = opts?.details;
  }
}

/** Raised at startup when no key is configured. Surfaced as a setup message, never a crash. */
export class SvmmonConfigError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'SvmmonConfigError';
  }
}

export interface RequestOptions {
  /** HTTP method. Defaults to 'GET'. */
  method?: 'GET' | 'POST';
  /** JSON body for POST requests. Serialized with JSON.stringify. */
  body?: unknown;
  /** Query params appended to the path (string values only). */
  query?: Record<string, string | number | undefined>;
}

/** Shape of the API's JSON error body: `{ error: "msg", ...extra }`. */
interface ApiErrorBody {
  error?: string;
  [key: string]: unknown;
}

export class SvmmonClient {
  /** Private so it cannot be read off the instance by tool code or serialized into logs. */
  readonly #apiKey: string;
  readonly #baseUrl: string;

  private constructor(apiKey: string, baseUrl: string) {
    this.#apiKey = apiKey;
    this.#baseUrl = baseUrl;
  }

  /**
   * Build a client from the environment.
   *
   * Config precedence (per build plan §3): explicit arg → SVMMON_API_KEY env.
   * MCP clients pass the key via the server's `env` block, which lands in
   * process.env — so env is the channel. Throws SvmmonConfigError (handled by
   * the server as a friendly message) when no key is present. We do NOT read a
   * --key argv flag: keys in argv leak to `ps`/process listings.
   */
  static fromEnv(overrideKey?: string): SvmmonClient {
    const key = (overrideKey ?? process.env.SVMMON_API_KEY ?? '').trim();
    if (!key) {
      throw new SvmmonConfigError(
        'No Svmmon API key found. Set SVMMON_API_KEY to a key from ' +
          'app.svmmonapp.com → Settings → API Keys (any paid plan).',
      );
    }
    const baseUrl = normalizeBaseUrl(process.env.SVMMON_BASE_URL);
    return new SvmmonClient(key, baseUrl);
  }

  /**
   * Perform one authenticated request against the Svmmon API.
   *
   * Returns the parsed JSON body typed as T on a 2xx. On any non-2xx, throws a
   * SvmmonApiError with a clean human message (mapped per status). On a
   * transport failure (DNS, TLS, abort), throws SvmmonApiError with status 0.
   *
   * Never retries. Never logs. The key only ever appears in the outbound
   * Authorization header built here.
   */
  async request<T>(path: string, opts: RequestOptions = {}): Promise<T> {
    const method = opts.method ?? 'GET';
    const url = this.#buildUrl(path, opts.query);

    const headers: Record<string, string> = {
      Authorization: `Bearer ${this.#apiKey}`,
      Accept: 'application/json',
    };
    let bodyInit: string | undefined;
    if (opts.body !== undefined) {
      headers['Content-Type'] = 'application/json';
      bodyInit = JSON.stringify(opts.body);
    }

    let res: Response;
    try {
      res = await fetch(url, { method, headers, body: bodyInit });
    } catch {
      // Transport-level failure. Do NOT include the caught error verbatim — it
      // can't contain the key, but keep the surface minimal and human.
      throw new SvmmonApiError(
        'Could not reach Svmmon. Check your connection and that the service is up, then try again.',
        0,
      );
    }

    const retryAfterSeconds = parseRetryAfter(res.headers.get('retry-after'));

    if (res.ok) {
      return (await safeJson(res)) as T;
    }

    // Non-2xx → map to a clean human message. Parse the body for the API's
    // `{ error, ...extra }` shape; tolerate a non-JSON body (e.g. an edge 502).
    const body = (await safeJson(res)) as ApiErrorBody | null;
    throw mapHttpError(res.status, body, retryAfterSeconds);
  }

  #buildUrl(path: string, query?: RequestOptions['query']): string {
    const url = new URL(path.replace(/^\//, ''), `${this.#baseUrl}/`);
    if (query) {
      for (const [k, v] of Object.entries(query)) {
        if (v !== undefined) url.searchParams.set(k, String(v));
      }
    }
    return url.toString();
  }
}

/* ------------------------------------------------------------------ *
 * Helpers
 * ------------------------------------------------------------------ */

function normalizeBaseUrl(raw: string | undefined): string {
  const candidate = (raw ?? '').trim();
  if (!candidate) return DEFAULT_BASE_URL;
  // Guard the base-URL override: must be a valid http(s) URL. An invalid value
  // falls back to the locked default rather than throwing — the key still only
  // ever goes to a parseable host the user explicitly set.
  try {
    const u = new URL(candidate);
    if (u.protocol !== 'http:' && u.protocol !== 'https:') return DEFAULT_BASE_URL;
    return candidate.replace(/\/+$/, '');
  } catch {
    return DEFAULT_BASE_URL;
  }
}

function parseRetryAfter(header: string | null): number | undefined {
  if (!header) return undefined;
  const secs = parseInt(header, 10);
  if (!Number.isNaN(secs) && secs >= 0) return secs;
  // HTTP-date form: convert to a delta.
  const when = Date.parse(header);
  if (!Number.isNaN(when)) {
    const delta = Math.ceil((when - Date.now()) / 1000);
    return delta > 0 ? delta : 0;
  }
  return undefined;
}

async function safeJson(res: Response): Promise<unknown> {
  try {
    const text = await res.text();
    if (!text) return null;
    return JSON.parse(text);
  } catch {
    return null;
  }
}

/**
 * Map an HTTP status + API error body into a clean, human SvmmonApiError.
 * Mirrors build plan §4. The key is never referenced here.
 */
function mapHttpError(
  status: number,
  body: ApiErrorBody | null,
  retryAfterSeconds: number | undefined,
): SvmmonApiError {
  const apiMsg = typeof body?.error === 'string' && body.error.trim() ? body.error.trim() : '';
  const details = extractDetails(body);
  const code = typeof body?.code === 'string' ? body.code : undefined;
  const failureMode = typeof body?.failure_mode === 'string' ? body.failure_mode : undefined;

  switch (status) {
    case 401:
      return new SvmmonApiError(
        'Your Svmmon API key is missing, invalid, or revoked. Generate a new one at ' +
          'app.svmmonapp.com → Settings → API Keys and update SVMMON_API_KEY.',
        401,
        { details },
      );

    case 402: {
      // Pass the API's own reason (monthly cap / AI-credit cap / BYOK overflow).
      const reason = apiMsg || 'A usage cap was reached.';
      return new SvmmonApiError(`${reason} Check your remaining quota with get_usage.`, 402, {
        details,
      });
    }

    case 403:
      if (code === 'account_banned') {
        return new SvmmonApiError(
          'This Svmmon account is suspended. Contact support@svmmonapp.com.',
          403,
          { details },
        );
      }
      // Tier gate. Echo the API's own reason so tier wording never drifts on the
      // MCP side; fall back to a generic line only when the body has no error text.
      return new SvmmonApiError(
        apiMsg || 'This action requires an active Svmmon subscription. Subscribe at app.svmmonapp.com/subscribe.',
        403,
        { details },
      );

    case 400:
      if (failureMode === 'compliance_blocked') {
        const words = Array.isArray(body?.flagged_words) ? (body.flagged_words as unknown[]).join(', ') : '';
        const tail = words ? ` Flagged word(s): ${words}. Edit the hook and retry.` : '';
        return new SvmmonApiError((apiMsg || 'Generation was blocked by the compliance filter.') + tail, 400, {
          details,
        });
      }
      if (failureMode === 'prompt_injection') {
        const field = typeof body?.field === 'string' ? body.field : 'input';
        return new SvmmonApiError(
          `That text was rejected by the safety filter (field: ${field}). Rephrase and retry.`,
          400,
          { details },
        );
      }
      return new SvmmonApiError(apiMsg || 'The request was invalid.', 400, { details });

    case 404:
      return new SvmmonApiError(
        apiMsg || "That profile or slideshow wasn't found, or it isn't on this account.",
        404,
        { details },
      );

    case 413:
      return new SvmmonApiError(apiMsg || 'Request too large.', 413, { details });

    case 429: {
      // Two distinct 429s share this status: the per-minute rate limit (carries
      // Retry-After) and the daily AI-spend cap (no Retry-After, but a rich body
      // like "resets at midnight UTC — try again then, or upgrade"). Prefer the
      // upstream message so the agent keeps the wait/upgrade signal; only fall
      // back to the generic line when the body has nothing.
      const wait = retryAfterSeconds !== undefined ? ` Retry after ${retryAfterSeconds} seconds.` : '';
      return new SvmmonApiError(`${apiMsg || 'Rate limited by the Svmmon API.'}${wait}`, 429, {
        retryAfterSeconds,
        details,
      });
    }

    case 503:
      if (code === 'ban_check_unavailable') {
        return new SvmmonApiError(
          "Couldn't verify account status right now. Retry in a moment.",
          503,
          { retryAfterSeconds, details },
        );
      }
      return new SvmmonApiError(apiMsg || 'Svmmon is temporarily unavailable. Try again shortly.', 503, {
        retryAfterSeconds,
        details,
      });

    default:
      if (status >= 500) {
        return new SvmmonApiError(
          apiMsg || 'Svmmon had a server error. Try again in a moment.',
          status,
          { details },
        );
      }
      return new SvmmonApiError(apiMsg || `Svmmon API request failed (HTTP ${status}).`, status, {
        details,
      });
  }
}

/** Pull the non-`error` structured fields off the API error body (for the tool to surface). */
function extractDetails(body: ApiErrorBody | null): Record<string, unknown> | undefined {
  if (!body) return undefined;
  const { error: _error, ...rest } = body;
  return Object.keys(rest).length > 0 ? rest : undefined;
}
