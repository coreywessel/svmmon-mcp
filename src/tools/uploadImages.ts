/**
 * upload_images — POST /api/v1/collections/{collection_id}/images
 *
 * WRITE + two-step confirm. Uploads base64 images into an owned collection.
 * Body: { images: [{ filename, data }] } (data = raw base64; a data: URI prefix
 * is tolerated server-side). Max 20 per request. Owner-scoped (404 otherwise);
 * per-file 25 MB cap and a per-tier storage cap enforced by the route.
 *
 * The first call (confirm omitted/false) only PREVIEWS the size + destination —
 * nothing is uploaded. A second call with confirm:true performs the write.
 */

import type { SvmmonClient } from '../client.js';
import { SvmmonApiError } from '../client.js';
import type { SvmmonTool, ToolResult, UploadImagesResponse } from '../types.js';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const MAX_IMAGES = 20;

const tool: SvmmonTool = {
  name: 'upload_images',
  description:
    'Upload one or more images (base64) into an owned Svmmon image collection. ' +
    'WRITE action — TWO-STEP: the first call previews the payload size and destination and does NOTHING; ' +
    'call again with confirm:true to actually upload. ALWAYS surface the preview (image count + total size + destination collection) to the user and get their go-ahead before passing confirm:true. ' +
    'Max 20 images per call; each file must be under 25 MB and counts against your per-tier image-storage cap. ' +
    'Get a collection_id from list_collections. Consumes no generation quota.',
  inputSchema: {
    type: 'object',
    properties: {
      collection_id: {
        type: 'string',
        description: 'UUID of an owned image collection (from list_collections). Required.',
      },
      images: {
        type: 'array',
        maxItems: MAX_IMAGES,
        description: `The images to upload (max ${MAX_IMAGES}). Each item is { filename, data } where data is raw base64 (a data: URI prefix is tolerated).`,
        items: {
          type: 'object',
          properties: {
            filename: { type: 'string', description: 'Original filename, e.g. "shot.png".' },
            data: { type: 'string', description: 'Base64-encoded image bytes.' },
          },
          required: ['filename', 'data'],
          additionalProperties: false,
        },
      },
      confirm: {
        type: 'boolean',
        description:
          'Must be true to EXECUTE. Omit/false to preview the exact consequence and cost first — nothing happens until you call again with confirm:true.',
      },
    },
    required: ['collection_id', 'images'],
    additionalProperties: false,
  },

  async handler(args: Record<string, unknown>, client: SvmmonClient): Promise<ToolResult> {
    const collectionId = typeof args.collection_id === 'string' ? args.collection_id.trim() : '';
    if (!collectionId || !UUID_RE.test(collectionId)) {
      return errorResult('collection_id must be a UUID. Call list_collections to get real ids.');
    }

    if (!Array.isArray(args.images) || args.images.length === 0) {
      return errorResult('images must be a non-empty array of { filename, data } objects.');
    }
    if (args.images.length > MAX_IMAGES) {
      return errorResult(`Too many images — max ${MAX_IMAGES} per call (got ${args.images.length}).`);
    }

    // Validate each item locally so a preview reflects the exact payload.
    const images: Array<{ filename: string; data: string }> = [];
    for (let i = 0; i < args.images.length; i++) {
      const item = args.images[i] as { filename?: unknown; data?: unknown };
      const filename = typeof item?.filename === 'string' ? item.filename.trim() : '';
      const data = typeof item?.data === 'string' ? item.data : '';
      if (!filename) return errorResult(`images[${i}] is missing a filename.`);
      if (!data) return errorResult(`images[${i}] is missing base64 data.`);
      images.push({ filename, data });
    }

    // Approximate decoded size from base64 length (3/4 of the char count, minus
    // padding) — good enough to warn the user before the write.
    const totalBytes = images.reduce((sum, img) => sum + Math.floor((img.data.length * 3) / 4), 0);
    const mb = (totalBytes / 1024 / 1024).toFixed(2);

    if (args.confirm !== true) {
      const list = images.map((img) => `  • ${img.filename}`).join('\n');
      const consequence =
        `Upload ${images.length} image(s) (~${mb} MB, estimated from base64 length) to collection ${collectionId}:\n${list}\n\n` +
        'This counts against your per-tier image-storage cap. Each file must be under 25 MB.';
      return previewResult('upload_images', consequence);
    }

    try {
      const res = await client.request<UploadImagesResponse>(
        `/api/v1/collections/${encodeURIComponent(collectionId)}/images`,
        { method: 'POST', body: { images } },
      );

      const lines: string[] = [];
      lines.push(`Uploaded ${res.count} image(s) to collection ${collectionId}.`);
      for (const u of res.uploaded ?? []) {
        lines.push(`  • ${u.filename} (${(u.bytes / 1024).toFixed(0)} KB) → ${u.id}`);
      }
      // 207 partial — surface the per-file failures.
      const failures = (res.results ?? []).filter((r) => !r.ok);
      if (failures.length > 0) {
        lines.push('\nSome files did not store:');
        for (const f of failures) lines.push(`  • ${f.filename}: ${f.error ?? 'unknown error'}`);
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
