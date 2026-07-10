/**
 * add_hooks — POST /api/v1/profiles/{profile_id}/hooks
 *
 * WRITE + two-step confirm. Adds one or many manual hooks to a profile's hook
 * library (source='manual'). Body: { hooks: string[] }. Max 50 per request;
 * empty/whitespace-only entries are dropped server-side. Owner-scoped (404).
 *
 * The first call (confirm omitted/false) only PREVIEWS the hooks to be added and
 * does NOTHING. A second call with confirm:true performs the write.
 */

import type { SvmmonClient } from '../client.js';
import { SvmmonApiError } from '../client.js';
import type { SvmmonTool, ToolResult, AddHooksResponse } from '../types.js';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const MAX_HOOKS = 50;

const tool: SvmmonTool = {
  name: 'add_hooks',
  description:
    "Add one or many manual hooks to a Svmmon profile's hook library. " +
    'WRITE action — TWO-STEP: the first call previews the hooks and does NOTHING; ' +
    'call again with confirm:true to actually add them. ALWAYS show the user the exact hooks that will be added and get their go-ahead before passing confirm:true. ' +
    'Max 50 hooks per call; empty entries are dropped. Get a profile_id from list_profiles. Consumes no generation quota.',
  inputSchema: {
    type: 'object',
    properties: {
      profile_id: {
        type: 'string',
        description: 'UUID of an owned profile (from list_profiles). Required.',
      },
      hooks: {
        type: 'array',
        maxItems: MAX_HOOKS,
        description: `The hook lines to add (max ${MAX_HOOKS}). Each is a plain string.`,
        items: { type: 'string' },
      },
      confirm: {
        type: 'boolean',
        description:
          'Must be true to EXECUTE. Omit/false to preview the exact consequence and cost first — nothing happens until you call again with confirm:true.',
      },
    },
    required: ['profile_id', 'hooks'],
    additionalProperties: false,
  },

  async handler(args: Record<string, unknown>, client: SvmmonClient): Promise<ToolResult> {
    const profileId = typeof args.profile_id === 'string' ? args.profile_id.trim() : '';
    if (!profileId || !UUID_RE.test(profileId)) {
      return errorResult('profile_id must be a UUID. Call list_profiles to get real ids.');
    }

    if (!Array.isArray(args.hooks)) {
      return errorResult('hooks must be an array of strings.');
    }
    const hooks = args.hooks
      .filter((h): h is string => typeof h === 'string' && h.trim().length > 0)
      .map((h) => h.trim());
    if (hooks.length === 0) {
      return errorResult('No non-empty hook text provided.');
    }
    if (hooks.length > MAX_HOOKS) {
      return errorResult(`Too many hooks — max ${MAX_HOOKS} per call (got ${hooks.length}).`);
    }

    if (args.confirm !== true) {
      const list = hooks.map((h) => `  • ${h}`).join('\n');
      const consequence = `Add ${hooks.length} hook(s) to profile ${profileId}:\n${list}`;
      return previewResult('add_hooks', consequence);
    }

    try {
      const res = await client.request<AddHooksResponse>(
        `/api/v1/profiles/${encodeURIComponent(profileId)}/hooks`,
        { method: 'POST', body: { hooks } },
      );

      const lines: string[] = [];
      lines.push(`Added ${res.count} hook(s) to profile ${profileId}.`);
      for (const h of res.created ?? []) {
        lines.push(`  • "${h.text}" (${h.id})`);
      }
      return { content: [{ type: 'text', text: lines.join('\n') }] };
    } catch (err) {
      if (err instanceof SvmmonApiError) {
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
