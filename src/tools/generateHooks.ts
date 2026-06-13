/**
 * generate_hooks — POST /api/v1/hooks/generate
 *
 * Maps 1:1 onto app/api/v1/hooks/generate/route.ts. COST-BEARING: each batch of
 * 3 candidates consumes 1 ai_credit. count=5 → 2 Claude calls → 2 ai_credits.
 *
 * Param bounds mirrored from the real route (do NOT re-implement its logic):
 *   - profile_id: string, required (route: 400 if empty, 404 if not owned)
 *   - direction:  string, optional. Route hard-caps at 1500 chars (400 above),
 *     then truncates to 500 effective chars. We mirror the 1500 local guard.
 *   - count:      integer 1–10, default 5 (route: 400 if out of range/non-int)
 *
 * Response: { hooks: [{ text, score }] } — MAY be fewer than `count` if the
 * ai_credit cap is hit mid-request (the route returns what it generated).
 *
 * NO client-side retry: a retry could re-spend ai_credits. The shared client
 * already never auto-retries; this handler issues exactly one request().
 */

import type { SvmmonClient } from '../client.js';
import { SvmmonApiError } from '../client.js';
import type { HooksGenerateResponse, SvmmonTool, ToolResult } from '../types.js';

const MAX_DIRECTION_CHARS = 1500; // route returns 400 above this
const MIN_COUNT = 1;
const MAX_COUNT = 10;
const DEFAULT_COUNT = 5;

const tool: SvmmonTool = {
  name: 'generate_hooks',

  description:
    'Generate scored TikTok hook candidates for one of the user\'s Svmmon profiles. ' +
    'Use when the user asks for hooks, openers, or angles for a profile (e.g. "give me 5 hooks for my Marcus profile about staying consistent"). ' +
    'Returns hooks ranked by a 0-100 virality score and persists them to the profile\'s hook library. ' +
    'COST: each batch of 3 candidates spends one AI credit (count=5 → 2 credits). ' +
    'May return FEWER hooks than requested if the AI-credit cap is hit mid-request — that is expected, not an error. ' +
    'Requires a valid profile_id: call list_profiles first and never invent one.',

  inputSchema: {
    type: 'object',
    properties: {
      profile_id: {
        type: 'string',
        description:
          'The id of the Svmmon profile to generate hooks for. Must belong to the key owner. Get it from list_profiles.',
      },
      direction: {
        type: 'string',
        description:
          'Optional steer for the angle/topic (e.g. "about quitting gambling, skeptic tone"). ' +
          'Max 1500 chars; only the first 500 are used by the generator. Omit to let Svmmon pick the strongest angles.',
        maxLength: MAX_DIRECTION_CHARS,
      },
      count: {
        type: 'integer',
        description: 'How many hooks to return (1-10). Defaults to 5.',
        minimum: MIN_COUNT,
        maximum: MAX_COUNT,
        default: DEFAULT_COUNT,
      },
    },
    required: ['profile_id'],
    additionalProperties: false,
  },

  async handler(args: Record<string, unknown>, client: SvmmonClient): Promise<ToolResult> {
    // ---- Local validation mirroring the route's documented bounds ----
    const profileId = typeof args.profile_id === 'string' ? args.profile_id.trim() : '';
    if (!profileId) {
      return errorResult('profile_id is required. Call list_profiles to get a valid id.');
    }

    let direction: string | undefined;
    if (args.direction !== undefined && args.direction !== null) {
      if (typeof args.direction !== 'string') {
        return errorResult('direction must be a string.');
      }
      const trimmed = args.direction.trim();
      if (trimmed.length > MAX_DIRECTION_CHARS) {
        return errorResult(
          `direction exceeds ${MAX_DIRECTION_CHARS} chars (got ${trimmed.length}). Shorten it and try again.`,
        );
      }
      direction = trimmed || undefined;
    }

    let count = DEFAULT_COUNT;
    if (args.count !== undefined && args.count !== null) {
      const n = args.count;
      if (typeof n !== 'number' || !Number.isInteger(n) || n < MIN_COUNT || n > MAX_COUNT) {
        return errorResult('count must be an integer between 1 and 10.');
      }
      count = n;
    }

    // ---- Build the exact body the route reads (profile_id, direction?, count) ----
    const body: Record<string, unknown> = { profile_id: profileId, count };
    if (direction !== undefined) body.direction = direction;

    // ---- One request. NO retry on this cost-bearing POST. ----
    let res: HooksGenerateResponse;
    try {
      res = await client.request<HooksGenerateResponse>('/api/v1/hooks/generate', {
        method: 'POST',
        body,
      });
    } catch (err) {
      if (err instanceof SvmmonApiError) return errorResult(err.message);
      throw err; // server.ts catch-all maps anything unexpected
    }

    return successResult(res, count);
  },
};

function successResult(res: HooksGenerateResponse, requested: number): ToolResult {
  const hooks = Array.isArray(res.hooks) ? res.hooks : [];

  if (hooks.length === 0) {
    return {
      content: [
        {
          type: 'text',
          text: 'No hooks were generated. Your AI-credit cap may have been reached — check get_usage.',
        },
      ],
    };
  }

  const lines = hooks
    .slice()
    .sort((a, b) => (b.score ?? 0) - (a.score ?? 0))
    .map((h, i) => `${i + 1}. [score ${h.score}] ${h.text}`);

  // Partial-result note when the AI-credit cap clipped the batch (route returns
  // what it generated rather than erroring once at least one hook exists).
  const partial =
    hooks.length < requested
      ? `\n\nNote: returned ${hooks.length} of ${requested} requested — the AI-credit cap was likely hit mid-request. Check get_usage.`
      : '';

  return {
    content: [
      {
        type: 'text',
        text:
          `Generated ${hooks.length} hook${hooks.length === 1 ? '' : 's'} ` +
          `(ranked by virality score, also saved to the profile's hook library):\n\n` +
          lines.join('\n') +
          partial,
      },
    ],
  };
}

function errorResult(text: string): ToolResult {
  return { content: [{ type: 'text', text }], isError: true };
}

export default tool;
