/**
 * list_collections — GET /api/v1/collections
 *
 * Mirrors app/api/v1/collections/route.ts. Any paid plan. Owner-scoped,
 * pinned first then newest. No request params.
 *
 * Response: { collections: [{ id, name, image_count, cover_path, is_pinned,
 *   created_at, health: { never_used, fresh, active, heavy, danger, at_max } }] }
 * health buckets images by slide_count (usage): 0 / 1–50 / 51–100 / 101–299 /
 * 300–399 / 400+ — the dashboard's image-fatigue tiers.
 */

import type { SvmmonTool, ToolResult, CollectionsResponse } from '../types.js';
import { SvmmonApiError, type SvmmonClient } from '../client.js';

const tool: SvmmonTool = {
  name: 'list_collections',
  description:
    "List the Svmmon account's image collections with image counts and per-collection " +
    'usage-health tiers (never_used / fresh / active / heavy / danger / at_max — how ' +
    'worn each collection\'s images are from repeated slideshow use). Use this for ' +
    '"what image collections do I have", to find a collection id for get_collection, ' +
    'or to spot image fatigue (large heavy/danger/at_max counts mean the collection ' +
    'needs fresh images). Read-only — consumes no quota.',
  inputSchema: { type: 'object', properties: {}, additionalProperties: false },

  async handler(_args: Record<string, unknown>, client: SvmmonClient): Promise<ToolResult> {
    try {
      const data = await client.request<CollectionsResponse>('/api/v1/collections');

      const collections = data.collections ?? [];
      if (collections.length === 0) {
        return {
          content: [
            {
              type: 'text',
              text: 'No image collections on this account yet. Create one at app.svmmonapp.com → Collections.',
            },
          ],
        };
      }

      const lines: string[] = [`${collections.length} collection(s):`];
      for (const c of collections) {
        const h = c.health;
        const worn = h.heavy + h.danger + h.at_max;
        const healthBits: string[] = [];
        if (h.never_used) healthBits.push(`${h.never_used} never used`);
        if (h.fresh) healthBits.push(`${h.fresh} fresh`);
        if (h.active) healthBits.push(`${h.active} active`);
        if (h.heavy) healthBits.push(`${h.heavy} heavy`);
        if (h.danger) healthBits.push(`${h.danger} danger`);
        if (h.at_max) healthBits.push(`${h.at_max} at max`);
        const pin = c.is_pinned ? ' · pinned' : '';
        const fatigue = worn > 0 ? ` · ⚠ ${worn} heavily-used image(s)` : '';
        lines.push(
          `  • ${c.name} — id: ${c.id} · ${c.image_count} image(s)${pin}${fatigue}` +
            (healthBits.length ? `\n      health: ${healthBits.join(', ')}` : ''),
        );
      }
      lines.push('\nUse get_collection with an id to page through its images.');

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
