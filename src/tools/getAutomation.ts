/**
 * get_automation — GET /api/v1/automations/{id}
 *
 * Mirrors app/api/v1/automations/[id]/route.ts. Owner-scoped — another
 * tenant's id (or an unknown id) reads as 404, never revealing existence.
 * Same fields as one entry in list_automations.
 */

import type { SvmmonTool, ToolResult, AutomationSummary } from '../types.js';
import { SvmmonApiError, type SvmmonClient } from '../client.js';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const tool: SvmmonTool = {
  name: 'get_automation',
  description:
    'Get one Svmmon automation by id — the same detailed fields as list_automations ' +
    '(active state, profile_id, timezone, delivery_mode, hook_source, preset ' +
    'rotation, slide-count settings, hook_count, last_run_status/last_run_at, ' +
    'soft_cta, force_cta_slide, cta_image_collection_id). Use list_automations ' +
    'first to find the id. Read-only — consumes no quota.',
  inputSchema: {
    type: 'object',
    properties: {
      automation_id: {
        type: 'string',
        description: 'UUID of the automation (from list_automations). Required.',
      },
    },
    required: ['automation_id'],
    additionalProperties: false,
  },

  async handler(args: Record<string, unknown>, client: SvmmonClient): Promise<ToolResult> {
    const automationId = typeof args.automation_id === 'string' ? args.automation_id.trim() : '';
    if (!automationId || !UUID_RE.test(automationId)) {
      return {
        content: [
          { type: 'text', text: 'automation_id must be a UUID. Call list_automations to get real ids.' },
        ],
        isError: true,
      };
    }

    try {
      const a = await client.request<AutomationSummary>(
        `/api/v1/automations/${encodeURIComponent(automationId)}`,
      );

      const lines: string[] = [];
      lines.push(`${a.name} (${a.id})`);
      lines.push(`Status: ${a.active ? 'active' : 'paused'}`);
      lines.push(`Profile: ${a.profile_id ?? 'unlinked'}`);
      lines.push(`Timezone: ${a.timezone ?? 'unset'} · Delivery: ${a.delivery_mode ?? 'unset'}`);
      lines.push(
        `Hook source: ${a.hook_source} · Hook count: ${a.hook_count} · Proven ratio: ${a.proven_ratio}`,
      );
      lines.push(
        `Preset rotation: ${a.preset_rotation_ids.length > 0 ? a.preset_rotation_ids.join(', ') : 'none set'}`,
      );
      lines.push(`Slide preset: ${a.slide_preset_id ?? 'unset'} · Slide count mode: ${a.slide_count_mode ?? 'unset'}`);
      if (a.slide_count_mode === 'fixed') {
        lines.push(`Slide count: ${a.slide_count_fixed ?? 'unset'}`);
      } else {
        lines.push(`Slide count range: ${a.slide_count_min ?? '?'}–${a.slide_count_max ?? '?'}`);
      }
      lines.push(`Last run: ${a.last_run_status ?? 'never'} (${a.last_run_at ?? 'n/a'})`);
      lines.push(`Soft CTA: ${a.soft_cta ?? 'none'} · Force CTA slide: ${a.force_cta_slide ? 'yes' : 'no'}`);
      lines.push(`CTA image collection: ${a.cta_image_collection_id ?? 'none'}`);
      lines.push(`Created: ${a.created_at ?? 'unknown'} · Updated: ${a.updated_at ?? 'unknown'}`);

      return { content: [{ type: 'text', text: lines.join('\n') }] };
    } catch (err) {
      if (err instanceof SvmmonApiError) {
        if (err.status === 404) {
          return {
            content: [
              {
                type: 'text',
                text: "Automation not found, or it isn't on this account. Call list_automations for valid ids.",
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
