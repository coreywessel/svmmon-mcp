/**
 * deliver_slideshow — POST /api/v1/slideshows/{slideshow_id}/deliver
 *
 * WRITE + two-step confirm. Re-posts an ALREADY-generated slideshow to TikTok or
 * Telegram WITHOUT regenerating it — no Anthropic call, no monthly slideshow
 * quota consumed, no new row. Owner-scoped (404). For TikTok it pushes a draft to
 * the profile's linked account and uses one of the 5 rolling-24h inbox slots.
 *
 * The first call (confirm omitted/false) only PREVIEWS the delivery and does
 * NOTHING. A second call with confirm:true performs the deliver.
 */

import type { SvmmonClient } from '../client.js';
import { SvmmonApiError } from '../client.js';
import type { SvmmonTool, ToolResult, DeliverSlideshowResponse } from '../types.js';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const TARGETS = ['tiktok', 'telegram'] as const;

const tool: SvmmonTool = {
  name: 'deliver_slideshow',
  description:
    'Re-post an ALREADY-generated Svmmon slideshow to TikTok or Telegram WITHOUT regenerating it — no AI call and NO monthly slideshow quota is spent. ' +
    'WRITE action — TWO-STEP: the first call previews the delivery and does NOTHING; ' +
    'call again with confirm:true to actually post. For TikTok this posts a draft to your linked account and uses one of your 5 rolling-24h inbox slots — ALWAYS surface the destination to the user and get their go-ahead before passing confirm:true. ' +
    'Get a slideshow_id from list_slideshows. The slideshow must already have an exported artifact to re-deliver.',
  inputSchema: {
    type: 'object',
    properties: {
      slideshow_id: {
        type: 'string',
        description: 'UUID of an owned, already-generated slideshow (from list_slideshows). Required.',
      },
      target: {
        type: 'string',
        enum: ['tiktok', 'telegram'],
        description: "Where to deliver: 'tiktok' pushes to the profile's linked TikTok inbox draft; 'telegram' sends the photo album.",
      },
      tiktok_account_id: {
        type: 'string',
        description:
          "Optional, only with target:'tiktok'. A confirmation that must match the profile's linked TikTok account, or delivery is rejected as a mismatch.",
      },
      confirm: {
        type: 'boolean',
        description:
          'Must be true to EXECUTE. Omit/false to preview the exact consequence and cost first — nothing happens until you call again with confirm:true.',
      },
    },
    required: ['slideshow_id', 'target'],
    additionalProperties: false,
  },

  async handler(args: Record<string, unknown>, client: SvmmonClient): Promise<ToolResult> {
    const slideshowId = typeof args.slideshow_id === 'string' ? args.slideshow_id.trim() : '';
    if (!slideshowId || !UUID_RE.test(slideshowId)) {
      return errorResult('slideshow_id must be a UUID. Call list_slideshows to get real ids.');
    }

    if (typeof args.target !== 'string' || !TARGETS.includes(args.target as never)) {
      return errorResult("target must be 'tiktok' or 'telegram'.");
    }
    const target = args.target as (typeof TARGETS)[number];

    let tiktokAccountId: string | undefined;
    if (args.tiktok_account_id !== undefined && args.tiktok_account_id !== null) {
      if (typeof args.tiktok_account_id !== 'string' || !UUID_RE.test(args.tiktok_account_id.trim())) {
        return errorResult('tiktok_account_id must be a UUID when provided.');
      }
      tiktokAccountId = args.tiktok_account_id.trim();
    }

    if (args.confirm !== true) {
      const tail =
        target === 'tiktok'
          ? ' For TikTok this posts a draft to your linked account and uses 1 of your 5 rolling-24h inbox slots. No generation quota is spent (re-posts existing content).'
          : ' No generation quota is spent (re-posts existing content).';
      const consequence = `Deliver slideshow ${slideshowId} to ${target}.${tail}`;
      return previewResult('deliver_slideshow', consequence);
    }

    const body: Record<string, unknown> = { target };
    if (tiktokAccountId !== undefined) body.tiktok_account_id = tiktokAccountId;

    try {
      const res = await client.request<DeliverSlideshowResponse>(
        `/api/v1/slideshows/${encodeURIComponent(slideshowId)}/deliver`,
        { method: 'POST', body },
      );

      const lines: string[] = [];
      lines.push(`Delivered slideshow ${res.slideshow_id} to ${res.target}.`);
      if (res.account) {
        lines.push(`  Account: ${res.account.username ?? res.account.id} (${res.account.id})`);
      }
      if (res.pending_confirmation) {
        lines.push('  TikTok accepted the draft but has not confirmed it as terminal yet — it should settle shortly.');
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
