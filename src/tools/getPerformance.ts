/**
 * get_performance — GET /api/v1/performance
 *
 * Mirrors app/api/v1/performance/route.ts. Any paid plan. Owner-scoped,
 * newest first. Lists post_performance rows (TikTok-ingested + historical).
 *
 * Query params: ?profile_id=uuid, ?slideshow_id=uuid, ?since=ISO-8601
 * (excludes rows without posted_at), ?limit (default 100, max 500).
 *
 * Response: { records: [{ id, slideshow_id, profile_id, platform, posted_at,
 *   url, day1_views, final_views, likes, shares, comments, engagement_rate,
 *   virality_score_predicted, created_at, ... }], count }
 */

import type { SvmmonTool, ToolResult, PerformanceResponse } from '../types.js';
import { SvmmonApiError, type SvmmonClient } from '../client.js';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const DEFAULT_LIMIT = 100;
const MAX_LIMIT = 500;

const tool: SvmmonTool = {
  name: 'get_performance',
  description:
    'List post-performance records for this Svmmon account (views, likes, shares, comments, ' +
    'engagement rate per posted slideshow — TikTok auto-ingested plus historical), newest first. ' +
    'Use this for "how are my posts doing", "views on my last posts", or to link a slideshow to ' +
    'its real results. Filter with profile_id (one persona), slideshow_id (one slideshow), ' +
    'since (ISO date — only posts on/after it; undated rows are excluded), and limit ' +
    '(1–500, default 100). Read-only — consumes no quota.',
  inputSchema: {
    type: 'object',
    properties: {
      profile_id: {
        type: 'string',
        description: 'Optional profile UUID — only records for this profile (get one from list_profiles).',
      },
      slideshow_id: {
        type: 'string',
        description: 'Optional slideshow UUID — only records for this slideshow (get one from list_slideshows).',
      },
      since: {
        type: 'string',
        description:
          'Optional ISO 8601 date or datetime (e.g. "2026-06-01"). Only records posted on/after this; records without a posted_at are excluded.',
      },
      limit: {
        type: 'integer',
        minimum: 1,
        maximum: MAX_LIMIT,
        description: 'Max records to return, newest first. 1–500, default 100.',
      },
    },
    additionalProperties: false,
  },

  async handler(args: Record<string, unknown>, client: SvmmonClient): Promise<ToolResult> {
    const profileId = typeof args.profile_id === 'string' ? args.profile_id.trim() : '';
    if (profileId && !UUID_RE.test(profileId)) {
      return { content: [{ type: 'text', text: 'profile_id must be a UUID.' }], isError: true };
    }
    const slideshowId = typeof args.slideshow_id === 'string' ? args.slideshow_id.trim() : '';
    if (slideshowId && !UUID_RE.test(slideshowId)) {
      return { content: [{ type: 'text', text: 'slideshow_id must be a UUID.' }], isError: true };
    }

    const since = typeof args.since === 'string' ? args.since.trim() : '';
    if (since && Number.isNaN(new Date(since).getTime())) {
      return {
        content: [{ type: 'text', text: 'since must be an ISO 8601 date or datetime (e.g. "2026-06-01").' }],
        isError: true,
      };
    }

    let limit: number | undefined;
    const raw = args.limit;
    if (raw !== undefined && raw !== null) {
      const parsed = typeof raw === 'number' ? raw : parseInt(String(raw), 10);
      if (!Number.isFinite(parsed) || parsed < 1) {
        return { content: [{ type: 'text', text: `limit must be a number between 1 and ${MAX_LIMIT}.` }], isError: true };
      }
      limit = Math.min(MAX_LIMIT, Math.floor(parsed));
    }

    try {
      const data = await client.request<PerformanceResponse>('/api/v1/performance', {
        query: {
          profile_id: profileId || undefined,
          slideshow_id: slideshowId || undefined,
          since: since || undefined,
          limit,
        },
      });

      const records = data.records ?? [];
      if (records.length === 0) {
        return {
          content: [
            {
              type: 'text',
              text: 'No performance records match. Stats appear after posts are published and the daily TikTok ingest runs (or narrow filters less).',
            },
          ],
        };
      }

      const lines = records.map((r) => {
        const views = r.final_views ?? r.day1_views;
        const parts: string[] = [];
        parts.push(views !== null && views !== undefined ? `${views} views` : 'views n/a');
        if (r.likes !== null) parts.push(`${r.likes} likes`);
        if (r.comments !== null) parts.push(`${r.comments} comments`);
        if (r.shares !== null) parts.push(`${r.shares} shares`);
        if (r.engagement_rate !== null) parts.push(`ER ${(r.engagement_rate * 100).toFixed(1)}%`);
        const when = r.posted_at ?? r.created_at;
        const refs: string[] = [];
        if (r.slideshow_id) refs.push(`slideshow ${r.slideshow_id}`);
        if (r.profile_id) refs.push(`profile ${r.profile_id}`);
        const url = r.url ? ` · ${r.url}` : '';
        return `• [${r.platform}] ${when} — ${parts.join(' · ')}${refs.length ? ` (${refs.join(', ')})` : ''}${url}`;
      });

      return {
        content: [
          {
            type: 'text',
            text: `${data.count} performance record${data.count === 1 ? '' : 's'}, newest first:\n${lines.join('\n')}`,
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
