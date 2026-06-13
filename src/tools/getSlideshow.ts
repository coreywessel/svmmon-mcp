/**
 * get_slideshow — GET /api/v1/slideshows/[id]
 *
 * Mirrors app/api/v1/slideshows/[id]/route.ts. Owner-scoped — another tenant's
 * id reads as 404. Read-only, consumes no quota. Its main use is to re-sign a
 * fresh download URL for a previously generated slideshow.
 *
 * Response (grounded in the route): { id, hook, profile_id, created_at,
 * export: { urls: [ ...1h signed URLs ] } }. urls is empty when no export file
 * exists in storage (e.g. a Telegram-only UI export). hook / profile_id may be null.
 */

import type { SvmmonClient } from '../client.js';
import { SvmmonApiError } from '../client.js';
import type { SvmmonTool, ToolResult, SlideshowGetResponse } from '../types.js';

const tool: SvmmonTool = {
  name: 'get_slideshow',
  description:
    'Fetch one slideshow by its id, including fresh 1-hour signed download URLs for its ' +
    'export ZIP. Use this when the user asks to "get the download link for slideshow X", ' +
    '"re-download a slideshow", or "get the link again" (the link from generate_slideshow ' +
    'expires after 24h; this mints fresh 1h links). Get the id from list_slideshows first. ' +
    'Read-only — consumes no quota. Download links may be empty if the slideshow has no ' +
    'export file (e.g. a Telegram-only export).',
  inputSchema: {
    type: 'object',
    properties: {
      id: {
        type: 'string',
        description: 'The slideshow id (uuid). Get it from list_slideshows.',
      },
    },
    required: ['id'],
    additionalProperties: false,
  },

  async handler(args: Record<string, unknown>, client: SvmmonClient): Promise<ToolResult> {
    const id = typeof args.id === 'string' ? args.id.trim() : '';
    if (!id) {
      return {
        content: [{ type: 'text', text: 'id is required. Get a slideshow id from list_slideshows.' }],
        isError: true,
      };
    }

    try {
      // Path segment is owner-scoped server-side; a non-owned id returns 404,
      // mapped to a clean message by the client. encodeURIComponent guards
      // against an id with URL-significant characters.
      const data = await client.request<SlideshowGetResponse>(
        `/api/v1/slideshows/${encodeURIComponent(id)}`,
        { method: 'GET' },
      );

      const hook = data.hook && data.hook.trim() ? data.hook.trim() : '(no hook text)';
      const profile = data.profile_id ? `\nProfile: ${data.profile_id}` : '';
      const urls = data.export?.urls ?? [];

      const downloadBlock =
        urls.length === 0
          ? 'Download links: none available (no export file — this may be a Telegram-only export).'
          : `Download link${urls.length === 1 ? '' : 's'} (valid 1 hour):\n` +
            urls.map((u) => `  ${u}`).join('\n');

      return {
        content: [
          {
            type: 'text',
            text:
              `Slideshow ${data.id}\n` +
              `Hook: "${hook}"${profile}\n` +
              `Created: ${data.created_at ?? 'unknown'}\n\n` +
              downloadBlock,
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
