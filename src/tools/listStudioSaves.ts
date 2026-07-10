/**
 * list_studio_saves — GET /api/v1/studio/saves
 *
 * Mirrors app/api/v1/studio/saves/route.ts. Any paid plan. The key owner's
 * SAVED Studio generations — metadata-only references, newest first, max 100.
 * `media_url` is the provider-hosted media URL and MAY BE EXPIRED — this is a
 * reference list, not durable storage (Studio never stores media bytes).
 * No request params. Saving via API is a later wave — this is read-only.
 */

import type { SvmmonTool, ToolResult, StudioSavesResponse } from '../types.js';
import { SvmmonApiError, type SvmmonClient } from '../client.js';

const tool: SvmmonTool = {
  name: 'list_studio_saves',
  description:
    "List the Svmmon account's saved Studio generations (items the user explicitly " +
    'saved in Studio), newest first (max 100): capability, provider, model, prompt, ' +
    'and a provider-hosted media_url per save. Use this for "show my saved Studio ' +
    'work" or to recover the prompt behind a saved result. IMPORTANT: media_url ' +
    'values are provider-hosted and MAY BE EXPIRED — treat them as references, not ' +
    'durable storage. No arguments. Read-only — consumes no quota.',
  inputSchema: { type: 'object', properties: {}, additionalProperties: false },

  async handler(_args: Record<string, unknown>, client: SvmmonClient): Promise<ToolResult> {
    try {
      const data = await client.request<StudioSavesResponse>('/api/v1/studio/saves');

      const saves = data.saves ?? [];
      if (saves.length === 0) {
        return {
          content: [
            {
              type: 'text',
              text: 'No saved Studio generations yet. Saves are made from the Studio UI at app.svmmonapp.com.',
            },
          ],
        };
      }

      const lines = saves.map((s) => {
        const promptRaw = s.prompt ?? '(no prompt)';
        const prompt = promptRaw.length > 120 ? `${promptRaw.slice(0, 117)}...` : promptRaw;
        return `• [${s.kind}] ${s.created_at} — ${s.provider}/${s.model} (${s.capability}) — "${prompt}" · ${s.media_url}`;
      });

      return {
        content: [
          {
            type: 'text',
            text:
              `${saves.length} saved Studio generation(s), newest first:\n${lines.join('\n')}\n\n` +
              'Note: media URLs are provider-hosted and may already be expired — Studio stores no media bytes.',
          },
        ],
      };
    } catch (err) {
      if (err instanceof SvmmonApiError) {
        return { content: [{ type: 'text', text: err.message }], isError: true };
      }
      throw err;
    }
  },
};

export default tool;
