/**
 * get_trending — GET /api/v1/trending
 *
 * Mirrors app/api/v1/trending/route.ts. GLOBAL, not owner-scoped — a shared
 * cache of public TikTok posts, so this is not account-specific. Optional
 * ?hashtag= and ?days= filters.
 */

import type { SvmmonTool, ToolResult, TrendingResponse } from '../types.js';
import { SvmmonApiError, type SvmmonClient } from '../client.js';

const tool: SvmmonTool = {
  name: 'get_trending',
  description:
    'Get globally trending TikTok posts from the shared trending cache — hashtag, ' +
    'description, author, play/like/comment/share counts, thumbnail, TikTok URL, ' +
    'and whether it is a slideshow. This is NOT scoped to your account — it is a ' +
    'shared public dataset. Optionally filter by hashtag and/or a lookback window ' +
    'in days. Use this for "what is trending right now" or "find trending posts ' +
    'in #niche". Read-only — consumes no quota.',
  inputSchema: {
    type: 'object',
    properties: {
      hashtag: {
        type: 'string',
        description: 'Optional hashtag to filter to (case-insensitive; leading # optional).',
      },
      days: {
        type: 'integer',
        minimum: 1,
        description: 'Optional lookback window in days — only posts created within the last N days.',
      },
    },
    additionalProperties: false,
  },

  async handler(args: Record<string, unknown>, client: SvmmonClient): Promise<ToolResult> {
    const hashtag = typeof args.hashtag === 'string' && args.hashtag.trim() ? args.hashtag.trim() : undefined;

    let days: number | undefined;
    if (args.days !== undefined && args.days !== null) {
      const parsed = typeof args.days === 'number' ? args.days : parseInt(String(args.days), 10);
      if (!Number.isFinite(parsed) || parsed < 1) {
        return { content: [{ type: 'text', text: 'days must be a positive integer.' }], isError: true };
      }
      days = Math.floor(parsed);
    }

    try {
      const data = await client.request<TrendingResponse>('/api/v1/trending', {
        query: { hashtag, days },
      });

      if (data.trending.length === 0) {
        return { content: [{ type: 'text', text: 'No trending posts found for that filter.' }] };
      }

      const lines: string[] = [`${data.count} trending post(s):`];
      for (const t of data.trending) {
        const author = t.author_name ?? t.author_nickname ?? 'unknown author';
        const slide = t.is_slideshow ? ' · slideshow' : '';
        lines.push(
          `  • #${t.hashtag} by ${author} — ${t.play_count} plays · ${t.like_count} likes · ${t.comment_count} comments · ${t.share_count} shares${slide}`,
        );
        if (t.description) lines.push(`      "${t.description}"`);
        if (t.tiktok_url) lines.push(`      ${t.tiktok_url}`);
      }

      return { content: [{ type: 'text', text: lines.join('\n') }] };
    } catch (err) {
      if (err instanceof SvmmonApiError) {
        return { content: [{ type: 'text', text: err.message }], isError: true };
      }
      throw err;
    }
  },
};

export default tool;
