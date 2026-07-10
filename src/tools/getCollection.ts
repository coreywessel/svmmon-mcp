/**
 * get_collection — GET /api/v1/collections/[id]
 *
 * Mirrors app/api/v1/collections/[id]/route.ts. Any paid plan. Owner-scoped —
 * a foreign or unknown id reads as 404.
 *
 * Query params: ?limit (default 50, max 200), ?offset, ?include_image_urls
 * ("true"/"1" → each image gets a 10-minute signed URL for vision use).
 *
 * Response: { collection: { id, name, is_pinned, created_at, image_count },
 *   images: [{ id, slide_count, export_count, valid, created_at, url? }],
 *   total, limit, offset }
 */

import type { SvmmonTool, ToolResult, CollectionGetResponse } from '../types.js';
import { SvmmonApiError, type SvmmonClient } from '../client.js';

const DEFAULT_LIMIT = 50;
const MAX_LIMIT = 200;

const tool: SvmmonTool = {
  name: 'get_collection',
  description:
    'Get one Svmmon image collection with a paginated list of its images (per-image ' +
    'slide_count = how many slides it has appeared on, export_count, and valid flag). ' +
    'Use list_collections first to find the collection_id. Set include_image_urls to ' +
    'get a short-lived (10 minute) signed URL per image so a vision-capable agent can ' +
    'actually LOOK at the images — the URLs expire fast, so use them immediately and ' +
    'never store them. Page with limit (1–200, default 50) and offset. Read-only — ' +
    'consumes no quota.',
  inputSchema: {
    type: 'object',
    properties: {
      collection_id: {
        type: 'string',
        description: 'UUID of the collection (from list_collections). Required.',
      },
      limit: {
        type: 'integer',
        minimum: 1,
        maximum: MAX_LIMIT,
        description: 'Images per page. 1–200, default 50.',
      },
      offset: {
        type: 'integer',
        minimum: 0,
        description: 'Pagination offset (default 0).',
      },
      include_image_urls: {
        type: 'boolean',
        description:
          'When true, each image includes a 10-minute signed URL for viewing the image bytes. Default false.',
      },
    },
    required: ['collection_id'],
    additionalProperties: false,
  },

  async handler(args: Record<string, unknown>, client: SvmmonClient): Promise<ToolResult> {
    const collectionId = typeof args.collection_id === 'string' ? args.collection_id.trim() : '';
    if (!collectionId) {
      return {
        content: [{ type: 'text', text: 'collection_id is required. Call list_collections to get one.' }],
        isError: true,
      };
    }

    let limit: number | undefined;
    if (args.limit !== undefined && args.limit !== null) {
      const parsed = typeof args.limit === 'number' ? args.limit : parseInt(String(args.limit), 10);
      if (!Number.isFinite(parsed) || parsed < 1) {
        return { content: [{ type: 'text', text: `limit must be a number between 1 and ${MAX_LIMIT}.` }], isError: true };
      }
      limit = Math.min(MAX_LIMIT, Math.floor(parsed));
    }

    let offset: number | undefined;
    if (args.offset !== undefined && args.offset !== null) {
      const parsed = typeof args.offset === 'number' ? args.offset : parseInt(String(args.offset), 10);
      if (!Number.isFinite(parsed) || parsed < 0) {
        return { content: [{ type: 'text', text: 'offset must be a number >= 0.' }], isError: true };
      }
      offset = Math.floor(parsed);
    }

    const includeUrls = args.include_image_urls === true;

    try {
      const data = await client.request<CollectionGetResponse>(
        `/api/v1/collections/${encodeURIComponent(collectionId)}`,
        {
          query: {
            limit,
            offset,
            include_image_urls: includeUrls ? 'true' : undefined,
          },
        },
      );

      const col = data.collection;
      const lines: string[] = [];
      lines.push(
        `Collection: ${col.name} (${col.id}) — ${col.image_count} image(s)${col.is_pinned ? ' · pinned' : ''} · created ${col.created_at}`,
      );

      const images = data.images ?? [];
      if (images.length === 0) {
        lines.push('No images in this page (the collection may be empty, or offset is past the end).');
      } else {
        const end = data.offset + images.length;
        lines.push(`Images ${data.offset + 1}–${end} of ${data.total}:`);
        for (const img of images) {
          const flags: string[] = [`${img.slide_count} slide use(s)`, `${img.export_count} export(s)`];
          if (!img.valid) flags.push('FLAGGED INVALID');
          const url = includeUrls ? ` · ${img.url ?? '(url unavailable)'}` : '';
          lines.push(`  • ${img.id} — ${flags.join(' · ')}${url}`);
        }
        if (end < data.total) {
          lines.push(`\nMore available — call again with offset=${end}.`);
        }
        if (includeUrls) {
          lines.push('\nImage URLs expire in 10 minutes — view them now, do not store or share them.');
        }
      }

      return { content: [{ type: 'text', text: lines.join('\n') }] };
    } catch (err) {
      if (err instanceof SvmmonApiError) {
        if (err.status === 404) {
          return {
            content: [
              { type: 'text', text: "Collection not found, or it isn't on this account. Call list_collections for valid ids." },
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
