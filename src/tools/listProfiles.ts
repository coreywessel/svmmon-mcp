/**
 * list_profiles — GET /api/v1/profiles
 *
 * Mirrors app/api/v1/profiles/route.ts. No request params (auth header only).
 * Response shape (the route's public contract):
 *   { profiles: [{ id, name, kind, niche (comma-joined categories or null),
 *                  ready (bool), missing: ["hook_image_collection"|"body_image_collection"],
 *                  tiktok_linked (bool) }] }
 *
 * Only profiles where `ready` is true can generate a slideshow (the missing[]
 * checks mirror exactly what POST /api/v1/slideshows enforces before it spends
 * quota). `tiktok_linked` is informational — it only matters for deliver:"tiktok".
 */

import type { SvmmonTool, ToolResult, ProfilesResponse } from '../types.js';
import { SvmmonApiError, type SvmmonClient } from '../client.js';

const tool: SvmmonTool = {
  name: 'list_profiles',
  description:
    "List the Svmmon account's profiles (personas) with their id, name, niche, " +
    'generation readiness, and whether a TikTok account is linked. Use this for ' +
    '"what profiles do I have" or "list my Svmmon personas". IMPORTANT: only ' +
    'profiles where `ready` is true can generate a slideshow — if a profile is not ' +
    'ready, the `missing` list says which image collection it still needs. Never ' +
    'invent a profile id; call this first to get a real one. Consumes no quota.',
  inputSchema: { type: 'object', properties: {}, additionalProperties: false },

  async handler(_args: Record<string, unknown>, client: SvmmonClient): Promise<ToolResult> {
    try {
      const data = await client.request<ProfilesResponse>('/api/v1/profiles');

      if (data.profiles.length === 0) {
        return {
          content: [
            {
              type: 'text',
              text: 'No profiles found on this account. Create one at app.svmmonapp.com → Profiles.',
            },
          ],
        };
      }

      const lines: string[] = [`${data.profiles.length} profile(s):`];
      for (const p of data.profiles) {
        const name = p.name ?? '(unnamed)';
        const parts: string[] = [`id: ${p.id}`];
        if (p.kind) parts.push(`kind: ${p.kind}`);
        if (p.niche) parts.push(`niche: ${p.niche}`);
        parts.push(p.ready ? 'ready: yes' : `ready: NO (missing: ${p.missing.join(', ') || 'unknown'})`);
        parts.push(`tiktok_linked: ${p.tiktok_linked ? 'yes' : 'no'}`);
        lines.push(`  • ${name} — ${parts.join(' · ')}`);
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
