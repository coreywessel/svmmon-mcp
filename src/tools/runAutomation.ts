/**
 * run_automation — POST /api/v1/automations/{automation_id}/run
 *
 * WRITE + two-step confirm. Triggers an IMMEDIATE run of an owned automation —
 * this SPENDS one slideshow from the monthly quota + AI credits, generates a
 * fresh deck, and posts it LIVE to the automation's linked TikTok account. This
 * cannot be undone. Owner-scoped (404).
 *
 * The first call (confirm omitted/false) reads GET /api/v1/automations/{id} for
 * the automation's name + active state and PREVIEWS the consequence — nothing
 * runs. A second call with confirm:true performs the run.
 *
 * A 409 run_cooldown (already running / fired within the 60s cooldown) is mapped
 * to a clear "already running — try again shortly" message.
 */

import type { SvmmonClient } from '../client.js';
import { SvmmonApiError } from '../client.js';
import type { SvmmonTool, ToolResult, AutomationSummary, RunAutomationResponse } from '../types.js';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const tool: SvmmonTool = {
  name: 'run_automation',
  description:
    'Run a Svmmon automation NOW — the programmatic "Generate Now" button. ' +
    'WRITE action — TWO-STEP: the first call previews the consequence (automation name + state) and does NOTHING; ' +
    'call again with confirm:true to actually run it. This SPENDS 1 slideshow from your monthly quota + AI credits, generates a fresh deck, and posts it LIVE to the linked TikTok account — it CANNOT be undone, so ALWAYS surface the cost + live-post consequence to the user and get their explicit go-ahead before passing confirm:true. ' +
    'Get an automation_id from list_automations. Check get_usage first if you may be near your monthly cap.',
  inputSchema: {
    type: 'object',
    properties: {
      automation_id: {
        type: 'string',
        description: 'UUID of an owned automation (from list_automations). Required.',
      },
      confirm: {
        type: 'boolean',
        description:
          'Must be true to EXECUTE. Omit/false to preview the exact consequence and cost first — nothing happens until you call again with confirm:true.',
      },
    },
    required: ['automation_id'],
    additionalProperties: false,
  },

  async handler(args: Record<string, unknown>, client: SvmmonClient): Promise<ToolResult> {
    const automationId = typeof args.automation_id === 'string' ? args.automation_id.trim() : '';
    if (!automationId || !UUID_RE.test(automationId)) {
      return errorResult('automation_id must be a UUID. Call list_automations to get real ids.');
    }

    if (args.confirm !== true) {
      // Fetch for accuracy: name + active state feed the preview.
      let name = automationId;
      let stateNote = '';
      try {
        const a = await client.request<AutomationSummary>(
          `/api/v1/automations/${encodeURIComponent(automationId)}`,
        );
        name = a.name || automationId;
        stateNote = a.active ? '' : ' NOTE: this automation is currently paused.';
      } catch (err) {
        if (err instanceof SvmmonApiError) {
          if (err.status === 404) {
            return errorResult("Automation not found, or it isn't on this account. Call list_automations for valid ids.");
          }
          return errorResult(err.message);
        }
        throw err;
      }
      const consequence =
        `Run automation '${name}' NOW. This SPENDS 1 slideshow from your monthly quota + AI credits, ` +
        'generates a fresh deck, and posts it LIVE to its linked TikTok account. This cannot be undone.' +
        stateNote;
      return previewResult('run_automation', consequence);
    }

    try {
      const res = await client.request<RunAutomationResponse>(
        `/api/v1/automations/${encodeURIComponent(automationId)}/run`,
        { method: 'POST' },
      );
      const lines: string[] = [];
      lines.push(`Automation ${res.automation_id} run complete (status: ${res.status}).`);
      if (res.slideshow_id) lines.push(`  Slideshow: ${res.slideshow_id}`);
      if (res.delivered !== undefined) lines.push(`  Delivered to TikTok: ${res.delivered ? 'yes' : 'no'}`);
      return { content: [{ type: 'text', text: lines.join('\n') }] };
    } catch (err) {
      if (err instanceof SvmmonApiError) {
        // 409 run_cooldown → clear "already running" message. Nothing was spent.
        const failureMode = typeof err.details?.failure_mode === 'string' ? err.details.failure_mode : '';
        if (err.status === 409 && failureMode === 'run_cooldown') {
          return errorResult(
            'This automation is already running or fired moments ago. Nothing was spent — try again shortly.',
          );
        }
        return errorResult(err.message);
      }
      throw err;
    }
  },
};

function previewResult(toolName: string, consequence: string): ToolResult {
  return {
    content: [
      {
        type: 'text',
        text: `⚠️ PREVIEW — nothing has happened yet.\n\n${consequence}\n\nCall ${toolName} again with confirm: true to execute.`,
      },
    ],
  };
}

function errorResult(text: string): ToolResult {
  return { content: [{ type: 'text', text }], isError: true };
}

export default tool;
