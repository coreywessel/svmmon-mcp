/**
 * remove_hook — DELETE /api/v1/profiles/{profile_id}/hooks?hookId={hook_id}
 *
 * WRITE + two-step confirm. Permanently deletes one hook from a profile's hook
 * library. Owner-scoped AND scoped to the profile's library (404 if the hook
 * isn't the caller's or isn't in this profile). Irreversible.
 *
 * The first call (confirm omitted/false) only PREVIEWS the deletion and does
 * NOTHING. A second call with confirm:true performs the delete.
 */

import type { SvmmonClient } from '../client.js';
import { SvmmonApiError } from '../client.js';
import type { SvmmonTool, ToolResult, RemoveHookResponse } from '../types.js';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const tool: SvmmonTool = {
  name: 'remove_hook',
  description:
    "Permanently delete one hook from a Svmmon profile's hook library. " +
    'WRITE action — TWO-STEP: the first call previews the deletion and does NOTHING; ' +
    'call again with confirm:true to actually delete it. This is IRREVERSIBLE — ALWAYS confirm with the user which hook is being removed before passing confirm:true. ' +
    'Get profile_id from list_profiles and hook_id from get_profile_hooks. Consumes no generation quota.',
  inputSchema: {
    type: 'object',
    properties: {
      profile_id: {
        type: 'string',
        description: 'UUID of the owned profile the hook belongs to (from list_profiles). Required.',
      },
      hook_id: {
        type: 'string',
        description: 'UUID of the hook to delete (from get_profile_hooks). Required.',
      },
      confirm: {
        type: 'boolean',
        description:
          'Must be true to EXECUTE. Omit/false to preview the exact consequence and cost first — nothing happens until you call again with confirm:true.',
      },
    },
    required: ['profile_id', 'hook_id'],
    additionalProperties: false,
  },

  async handler(args: Record<string, unknown>, client: SvmmonClient): Promise<ToolResult> {
    const profileId = typeof args.profile_id === 'string' ? args.profile_id.trim() : '';
    if (!profileId || !UUID_RE.test(profileId)) {
      return errorResult('profile_id must be a UUID. Call list_profiles to get real ids.');
    }
    const hookId = typeof args.hook_id === 'string' ? args.hook_id.trim() : '';
    if (!hookId || !UUID_RE.test(hookId)) {
      return errorResult('hook_id must be a UUID. Call get_profile_hooks to get real ids.');
    }

    if (args.confirm !== true) {
      const consequence =
        `Remove hook ${hookId} from profile ${profileId}. This permanently deletes it from the library.`;
      return previewResult('remove_hook', consequence);
    }

    try {
      const res = await client.request<RemoveHookResponse>(
        `/api/v1/profiles/${encodeURIComponent(profileId)}/hooks`,
        { method: 'DELETE', query: { hookId } },
      );
      const ok = res.deleted === true;
      return {
        content: [
          {
            type: 'text',
            text: ok
              ? `Hook ${res.id} permanently deleted from profile ${profileId}.`
              : `The API did not confirm deletion of hook ${hookId}.`,
          },
        ],
        ...(ok ? {} : { isError: true }),
      };
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
