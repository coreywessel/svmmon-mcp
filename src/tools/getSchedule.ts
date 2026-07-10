/**
 * get_schedule — GET /api/v1/schedule
 *
 * Mirrors app/api/v1/schedule/route.ts. No request params (auth header only).
 * Response shape (the route's public contract):
 *   { slots: [{ id, automation_id, automation_name, time_of_day, days_of_week,
 *               timezone, active, last_fired_at, created_at }], count }
 *
 * Owner-scoped, ordered by time_of_day.
 */

import type { SvmmonTool, ToolResult, ScheduleResponse } from '../types.js';
import { SvmmonApiError, type SvmmonClient } from '../client.js';

const DAY_NAMES = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

const tool: SvmmonTool = {
  name: 'get_schedule',
  description:
    "Get the account's posting schedule — every schedule slot with its time_of_day, " +
    'days_of_week, timezone, which automation it fires, active state, and ' +
    'last_fired_at. Use this for "when do my automations post" or "what does my ' +
    'posting schedule look like". Read-only — consumes no quota.',
  inputSchema: { type: 'object', properties: {}, additionalProperties: false },

  async handler(_args: Record<string, unknown>, client: SvmmonClient): Promise<ToolResult> {
    try {
      const data = await client.request<ScheduleResponse>('/api/v1/schedule');

      if (data.slots.length === 0) {
        return { content: [{ type: 'text', text: 'No schedule slots found on this account.' }] };
      }

      const lines: string[] = [`${data.count} schedule slot(s):`];
      for (const s of data.slots) {
        const days =
          s.days_of_week.length > 0
            ? s.days_of_week.map((d) => DAY_NAMES[d] ?? String(d)).join(',')
            : 'no days set';
        const name = s.automation_name ?? '(unlinked automation)';
        const status = s.active ? 'active' : 'paused';
        lines.push(
          `  • ${s.time_of_day} ${s.timezone ?? ''} — ${name} — ${days} — ${status} — last fired: ${s.last_fired_at ?? 'never'}`,
        );
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
