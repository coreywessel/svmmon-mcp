/**
 * get_tiktok_insights — GET /api/v1/tiktok/insights
 *
 * Mirrors app/api/v1/tiktok/insights/route.ts. GROWTH+ ONLY — the route adds
 * its own tier gate (403 { failure_mode: 'feature_blocked', upgrade_to:
 * 'growth' } below Growth). Live TikTok Display API pull: profile stats
 * (followers/likes/videos) + per-video stats for the last 30 days.
 *
 * Optional ?account_id=uuid picks a specific connected account (404 if not
 * the owner's); default is the most recently connected. A TikTok read failure
 * still returns 200 with { connected: true, error, needs_reconnect } so
 * "no account" and "read failed" are distinguishable.
 */

import type { SvmmonTool, ToolResult, TikTokInsightsResponse } from '../types.js';
import { SvmmonApiError, type SvmmonClient } from '../client.js';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const tool: SvmmonTool = {
  name: 'get_tiktok_insights',
  description:
    'Pull LIVE TikTok stats for a connected TikTok account via the TikTok Display API: ' +
    'follower count, total likes, video count, plus per-video views/likes/comments/shares ' +
    'for the last 30 days (newest first). Use this for "how is my TikTok doing", ' +
    '"views on my recent TikToks", or to check follower growth. Optional account_id ' +
    '(UUID of a connected account) — defaults to the most recently connected; the ' +
    'response lists all connected accounts so you can re-call with a specific one. ' +
    'REQUIRES THE GROWTH PLAN OR HIGHER — on lower plans this returns a clear ' +
    '"needs Growth plan" error. Heavier call (fans out to the TikTok API, rate ' +
    'limited 20/min). Read-only — consumes no Svmmon quota.',
  inputSchema: {
    type: 'object',
    properties: {
      account_id: {
        type: 'string',
        description:
          'Optional UUID of a specific connected TikTok account. Omit for the most recently connected. Ids come back in the `accounts` list of a previous call (or get_usage).',
      },
    },
    additionalProperties: false,
  },

  async handler(args: Record<string, unknown>, client: SvmmonClient): Promise<ToolResult> {
    const accountId = typeof args.account_id === 'string' ? args.account_id.trim() : '';
    if (accountId && !UUID_RE.test(accountId)) {
      return { content: [{ type: 'text', text: 'account_id must be a UUID.' }], isError: true };
    }

    try {
      const data = await client.request<TikTokInsightsResponse>('/api/v1/tiktok/insights', {
        query: { account_id: accountId || undefined },
      });

      if (!data.connected) {
        return {
          content: [
            {
              type: 'text',
              text: 'No TikTok account is connected to this Svmmon account. Connect one at app.svmmonapp.com → Settings.',
            },
          ],
        };
      }

      const acctLabel = data.account?.display_name ?? data.account?.id ?? 'account';

      if (data.needs_reconnect && !data.profile) {
        return {
          content: [
            {
              type: 'text',
              text:
                `TikTok account "${acctLabel}" needs to be reconnected (its token is stale or missing the stats scopes). ` +
                'Reconnect it at app.svmmonapp.com → Settings → TikTok.',
            },
          ],
          isError: true,
        };
      }

      if (data.error) {
        const reconnect = data.needs_reconnect
          ? ' Reconnect the account at app.svmmonapp.com → Settings → TikTok.'
          : '';
        return {
          content: [{ type: 'text', text: `TikTok read failed for "${acctLabel}": ${data.error}${reconnect}` }],
          isError: true,
        };
      }

      const lines: string[] = [];
      lines.push(`TikTok account: ${acctLabel}`);
      if (data.profile) {
        const p = data.profile;
        lines.push(
          `Profile: ${p.display_name} — ${p.follower_count} followers · ${p.likes_count} total likes · ${p.video_count} videos`,
        );
      }

      const videos = data.videos ?? [];
      if (videos.length === 0) {
        lines.push('No videos posted in the last 30 days.');
      } else {
        lines.push(`\nVideos (last 30 days, ${videos.length}):`);
        for (const v of videos) {
          const when = new Date(v.create_time * 1000).toISOString().slice(0, 10);
          const title = v.title && v.title.trim() ? v.title.trim() : '(no title)';
          const url = v.share_url ? ` · ${v.share_url}` : '';
          lines.push(
            `  • ${when} "${title}" — ${v.view_count} views · ${v.like_count} likes · ${v.comment_count} comments · ${v.share_count} shares${url}`,
          );
        }
      }

      if ((data.accounts ?? []).length > 1) {
        lines.push('\nOther connected accounts (pass account_id to switch):');
        for (const a of data.accounts!) {
          if (a.id === data.account?.id) continue;
          lines.push(`  • ${a.display_name ?? '(unnamed)'} — ${a.id}`);
        }
      }

      return { content: [{ type: 'text', text: lines.join('\n') }] };
    } catch (err) {
      if (err instanceof SvmmonApiError) {
        if (err.status === 403 && err.details?.failure_mode === 'feature_blocked') {
          return {
            content: [
              {
                type: 'text',
                text:
                  'TikTok Insights needs the Growth plan or higher — this account is on a lower plan. ' +
                  'Upgrade at app.svmmonapp.com/subscribe to unlock live TikTok stats.',
              },
            ],
            isError: true,
          };
        }
        return { content: [{ type: 'text', text: err.message }], isError: true };
      }
      throw err;
    }
  },
};

export default tool;
