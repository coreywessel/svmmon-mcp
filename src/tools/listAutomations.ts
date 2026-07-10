/**
 * list_automations — GET /api/v1/automations
 *
 * Mirrors app/api/v1/automations/route.ts. No request params (auth header only).
 * Response shape (the route's public contract):
 *   { automations: [{ id, name, active, profile_id, timezone, delivery_mode,
 *       hook_source, preset_rotation_ids, proven_ratio, slide_preset_id,
 *       slide_count_mode, slide_count_fixed, slide_count_min, slide_count_max,
 *       hook_count, last_run_status, last_run_at, soft_cta, force_cta_slide,
 *       cta_image_collection_id, created_at, updated_at }], count }
 *
 * Owner-scoped, newest first. Downgrade-archived automations (hidden_at) are
 * excluded until restored.
 */

import type { SvmmonTool, ToolResult, AutomationsResponse, AutomationSummary } from '../types.js';
import { SvmmonApiError, type SvmmonClient } from '../client.js';

const tool: SvmmonTool = {
  name: 'list_automations',
  description:
    "List the account's automations — id, name, active state, linked profile_id, " +
    'schedule timezone, delivery mode, hook source, preset rotation, slide-count ' +
    'settings, hook_count, and last_run_status/last_run_at. Use this for "what ' +
    'automations do I have running" or "which automations are active". Never ' +
    'invent an automation id; call this first to get a real one for get_automation. ' +
    'Read-only — consumes no quota.',
  inputSchema: { type: 'object', properties: {}, additionalProperties: false },

  async handler(_args: Record<string, unknown>, client: SvmmonClient): Promise<ToolResult> {
    try {
      const data = await client.request<AutomationsResponse>('/api/v1/automations');

      if (data.automations.length === 0) {
        return {
          content: [
            {
              type: 'text',
              text: 'No automations found on this account. Create one at app.svmmonapp.com → Automations.',
            },
          ],
        };
      }

      const lines: string[] = [`${data.count} automation(s):`];
      for (const a of data.automations) {
        lines.push(`  • ${formatSummaryLine(a)}`);
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

function formatSummaryLine(a: AutomationSummary): string {
  const parts: string[] = [`id: ${a.id}`, a.active ? 'active' : 'paused'];
  if (a.profile_id) parts.push(`profile: ${a.profile_id}`);
  parts.push(`hooks: ${a.hook_count}`);
  if (a.last_run_status) parts.push(`last run: ${a.last_run_status}`);
  return `${a.name} — ${parts.join(' · ')}`;
}

export default tool;
