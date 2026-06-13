/**
 * list_presets — GET /api/v1/presets
 *
 * Mirrors app/api/v1/presets/route.ts. No request params (auth header only).
 * Read-only — the route does no DB access. Response shape (public contract):
 *   { presets: [{ id, name, structure_summary }] }
 *
 * Every `id` returned is a legal `preset_id` for POST /api/v1/slideshows — it
 * resolves through the same getPreset() the slideshows route validates against.
 * The list interleaves meta-presets with their concrete sub-shapes (e.g.
 * listicle, identity_shift); either form is an accepted preset_id.
 */

import type { SvmmonTool, ToolResult, PresetsResponse } from '../types.js';
import { SvmmonApiError, type SvmmonClient } from '../client.js';

const tool: SvmmonTool = {
  name: 'list_presets',
  description:
    'List the slide presets you can pass as `preset_id` to generate_slideshow. ' +
    'Use this for "what slide presets can I use" or before generating a slideshow ' +
    'when the user wants a specific structure. Every id returned is a valid ' +
    '`preset_id`. Consumes no quota.',
  inputSchema: { type: 'object', properties: {}, additionalProperties: false },

  async handler(_args: Record<string, unknown>, client: SvmmonClient): Promise<ToolResult> {
    try {
      const data = await client.request<PresetsResponse>('/api/v1/presets');

      if (data.presets.length === 0) {
        return { content: [{ type: 'text', text: 'No presets available.' }] };
      }

      const lines: string[] = [`${data.presets.length} preset(s) (any id is a valid preset_id):`];
      for (const p of data.presets) {
        lines.push(`  • ${p.id} — ${p.name}: ${p.structure_summary}`);
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
