/**
 * list_slideshows — GET /api/v1/slideshows
 *
 * Mirrors app/api/v1/slideshows/route.ts (the GET handler). Owner-scoped,
 * newest first. Read-only, consumes no quota. Optional ?limit (default 20,
 * max 100; non-numeric or < 1 → the API returns 400).
 *
 * Response (grounded in the route): { slideshows: [{ id, hook, profile_id, created_at }] }.
 * profile_id is null for slideshows created before migration 152 or without a
 * profile; hook may be null.
 */

import type { SvmmonClient } from '../client.js';
import { SvmmonApiError } from '../client.js';
import type { SvmmonTool, ToolResult, SlideshowListResponse } from '../types.js';

const DEFAULT_LIMIT = 20;
const MAX_LIMIT = 100;

const tool: SvmmonTool = {
  name: 'list_slideshows',
  description:
    'List the most recent slideshows on this Svmmon account, newest first. ' +
    'Use this when the user asks to "show my recent slideshows", "what have I generated", ' +
    'or wants a slideshow id to fetch its download link with get_slideshow. ' +
    'Returns id, hook text, profile_id, and created_at for each. Read-only — consumes no quota. ' +
    'Optional limit (1–100, default 20).',
  inputSchema: {
    type: 'object',
    properties: {
      limit: {
        type: 'integer',
        minimum: 1,
        maximum: MAX_LIMIT,
        description: 'How many slideshows to return, newest first. 1–100, default 20.',
      },
    },
    additionalProperties: false,
  },

  async handler(args: Record<string, unknown>, client: SvmmonClient): Promise<ToolResult> {
    // Mirror the API's documented bound only (1–100, default 20). The route
    // itself 400s on non-numeric / < 1, so we coerce locally for a nicer error
    // and clamp the upper end the same way the route does (Math.min).
    let limit: number | undefined;
    const raw = args.limit;
    if (raw !== undefined && raw !== null) {
      const parsed = typeof raw === 'number' ? raw : parseInt(String(raw), 10);
      if (!Number.isFinite(parsed) || parsed < 1) {
        return {
          content: [{ type: 'text', text: 'limit must be a number between 1 and 100.' }],
          isError: true,
        };
      }
      limit = Math.min(MAX_LIMIT, Math.floor(parsed));
    }

    try {
      const data = await client.request<SlideshowListResponse>('/api/v1/slideshows', {
        method: 'GET',
        query: limit !== undefined ? { limit } : undefined,
      });

      const list = data.slideshows ?? [];
      if (list.length === 0) {
        return {
          content: [
            {
              type: 'text',
              text: 'No slideshows yet on this account. Generate one with generate_slideshow.',
            },
          ],
        };
      }

      const lines = list.map((s) => {
        const hook = s.hook && s.hook.trim() ? s.hook.trim() : '(no hook text)';
        const when = s.created_at ?? 'unknown date';
        const profile = s.profile_id ? ` · profile ${s.profile_id}` : '';
        return `• ${s.id} — "${hook}"${profile} · ${when}`;
      });

      const header =
        `${list.length} slideshow${list.length === 1 ? '' : 's'}` +
        `${limit !== undefined ? ` (limit ${limit})` : ''}, newest first:`;

      return {
        content: [
          {
            type: 'text',
            text: `${header}\n${lines.join('\n')}\n\nUse get_slideshow with an id to fetch its download link.`,
          },
        ],
      };
    } catch (err) {
      if (err instanceof SvmmonApiError) {
        return { content: [{ type: 'text', text: err.message }], isError: true };
      }
      throw err;
    }
  },
};

export default tool;
