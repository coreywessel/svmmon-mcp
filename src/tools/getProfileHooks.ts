/**
 * get_profile_hooks — GET /api/v1/profiles/{id}/hooks
 *
 * Mirrors app/api/v1/profiles/[id]/hooks/route.ts. Owner-scoped — a profile
 * that isn't the caller's reads as 404. Optional ?source= filter. Results
 * are sorted by used_count ascending (least-used first) — the same order
 * the automation uses to pick the next hook.
 */

import type { SvmmonTool, ToolResult, ProfileHooksResponse } from '../types.js';
import { SvmmonApiError, type SvmmonClient } from '../client.js';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const tool: SvmmonTool = {
  name: 'get_profile_hooks',
  description:
    "List a profile's hook library — text, status (pending/active), source, " +
    'used_count, performance bucket, and virality_score (meaningful for ' +
    "'historical' source rows only). Sorted least-used first, matching the order " +
    'the automation picks the next hook. Optionally filter by source. Use ' +
    'list_profiles first to find the profile_id. Read-only — consumes no quota.',
  inputSchema: {
    type: 'object',
    properties: {
      profile_id: {
        type: 'string',
        description: 'UUID of the profile (from list_profiles). Required.',
      },
      source: {
        type: 'string',
        description:
          'Optional hook source filter (e.g. "library", "generated", "historical"). Omit for all sources.',
      },
    },
    required: ['profile_id'],
    additionalProperties: false,
  },

  async handler(args: Record<string, unknown>, client: SvmmonClient): Promise<ToolResult> {
    const profileId = typeof args.profile_id === 'string' ? args.profile_id.trim() : '';
    if (!profileId || !UUID_RE.test(profileId)) {
      return {
        content: [{ type: 'text', text: 'profile_id must be a UUID. Call list_profiles to get real ids.' }],
        isError: true,
      };
    }
    const source = typeof args.source === 'string' && args.source.trim() ? args.source.trim() : undefined;

    try {
      const data = await client.request<ProfileHooksResponse>(
        `/api/v1/profiles/${encodeURIComponent(profileId)}/hooks`,
        { query: { source } },
      );

      if (data.hooks.length === 0) {
        return {
          content: [
            {
              type: 'text',
              text: 'No hooks found for this profile' + (source ? ` with source "${source}"` : '') + '.',
            },
          ],
        };
      }

      const lines: string[] = [`${data.count} hook(s):`];
      for (const h of data.hooks) {
        const parts: string[] = [`status: ${h.status}`, `source: ${h.source}`, `used: ${h.used_count}`];
        if (h.bucket) parts.push(`bucket: ${h.bucket}`);
        if (h.virality_score !== null) parts.push(`virality: ${h.virality_score}`);
        lines.push(`  • "${h.text}" — ${parts.join(' · ')}`);
      }

      return { content: [{ type: 'text', text: lines.join('\n') }] };
    } catch (err) {
      if (err instanceof SvmmonApiError) {
        if (err.status === 404) {
          return {
            content: [
              { type: 'text', text: "Profile not found, or it isn't on this account. Call list_profiles for valid ids." },
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
