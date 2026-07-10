/**
 * list_studio_history — GET /api/v1/studio/history
 *
 * Mirrors app/api/v1/studio/history/route.ts. Any paid plan. The key owner's
 * Studio generation history — METADATA ONLY, newest first. `source_url` is
 * the provider-hosted result URL and MAY BE EXPIRED (Replicate ~1h; fal
 * longer) — Studio stores no media bytes. Optional ?limit (default 50,
 * max 100; the route 400s outside 1–100).
 */

import type { SvmmonTool, ToolResult, StudioHistoryResponse } from '../types.js';
import { SvmmonApiError, type SvmmonClient } from '../client.js';

const MAX_LIMIT = 100;

const tool: SvmmonTool = {
  name: 'list_studio_history',
  description:
    "List the Svmmon account's Studio generation history (images/videos made with " +
    'generate_image / generate_video and the Studio UI), newest first: capability, ' +
    'provider, model, prompt, and a provider-hosted source_url per item. Use this for ' +
    '"what have I generated in Studio" or to recover a recent prompt. IMPORTANT: ' +
    'source_url values are provider-hosted and MAY BE EXPIRED (Replicate ~1 hour) — ' +
    'treat them as best-effort pointers, not durable storage. Optional limit ' +
    '(1–100, default 50). Read-only — consumes no quota.',
  inputSchema: {
    type: 'object',
    properties: {
      limit: {
        type: 'integer',
        minimum: 1,
        maximum: MAX_LIMIT,
        description: 'How many history items to return, newest first. 1–100, default 50.',
      },
    },
    additionalProperties: false,
  },

  async handler(args: Record<string, unknown>, client: SvmmonClient): Promise<ToolResult> {
    let limit: number | undefined;
    const raw = args.limit;
    if (raw !== undefined && raw !== null) {
      const parsed = typeof raw === 'number' ? raw : parseInt(String(raw), 10);
      if (!Number.isFinite(parsed) || parsed < 1 || parsed > MAX_LIMIT) {
        return {
          content: [{ type: 'text', text: `limit must be an integer between 1 and ${MAX_LIMIT}.` }],
          isError: true,
        };
      }
      limit = Math.floor(parsed);
    }

    try {
      const data = await client.request<StudioHistoryResponse>('/api/v1/studio/history', {
        query: limit !== undefined ? { limit } : undefined,
      });

      const items = data.items ?? [];
      if (items.length === 0) {
        return {
          content: [
            { type: 'text', text: 'No Studio generations yet. Create one with generate_image or generate_video.' },
          ],
        };
      }

      const lines = items.map((it) => {
        const prompt = it.prompt && it.prompt.length > 120 ? `${it.prompt.slice(0, 117)}...` : it.prompt;
        const url = it.source_url ? ` · ${it.source_url}` : '';
        return `• [${it.kind}] ${it.created_at} — ${it.provider}/${it.model} (${it.capability}) — "${prompt}"${url}`;
      });

      return {
        content: [
          {
            type: 'text',
            text:
              `${items.length} Studio generation(s), newest first:\n${lines.join('\n')}\n\n` +
              'Note: URLs are provider-hosted and may already be expired — Studio stores no media bytes.',
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
