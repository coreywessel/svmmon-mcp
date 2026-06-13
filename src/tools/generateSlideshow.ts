/**
 * generate_slideshow — POST /api/v1/slideshows
 *
 * Maps 1:1 onto the POST handler in app/api/v1/slideshows/route.ts.
 *
 * COST-BEARING + NOT IDEMPOTENT: every call consumes ONE slideshow from the
 * monthly cap and generates a brand-new slideshow. A retry burns another slot.
 * This handler issues exactly ONE request() and the shared client never
 * auto-retries — a timeout may have succeeded server-side, so the agent must
 * check list_slideshows rather than re-calling. Takes 30-120s (route maxDuration
 * is 300s).
 *
 * Params mirrored from the real route (do NOT re-implement its logic):
 *   - profile_id:        string, required (route: 400 if empty, 404 if not owned,
 *                        400 if the profile has no hook/body image collection)
 *   - hook:              string, required, max 1000 chars — becomes slide 1 + title
 *   - preset_id:         string, optional — must resolve server-side (else 400);
 *                        default = profile's preset, then 'listicle'
 *   - deliver:           'tiktok' | 'telegram' | 'none' (default 'none')
 *   - tiktok_account_id: string, optional with deliver:'tiktok' — must match the
 *                        profile's linked account (else delivered.reason=mismatch)
 *
 * Response: { slideshow_id, status:'completed', export:{download_url (24h ZIP),
 * filename, expires_in_seconds, slide_count}, body_oversized?, warnings[],
 * delivered: null | {channel, status, reason?} }. Delivery failures NEVER fail
 * generation — they come back as delivered.status='failed' + a reason.
 */

import type { SvmmonClient } from '../client.js';
import { SvmmonApiError } from '../client.js';
import type { SlideshowCreateResponse, SvmmonTool, ToolResult } from '../types.js';

const MAX_HOOK_CHARS = 1000;
const DELIVER_CHANNELS = ['tiktok', 'telegram', 'none'] as const;

/** Human-readable text for each delivery reason the route can return. */
const DELIVERY_REASON_TEXT: Record<string, string> = {
  telegram_not_linked: 'Telegram is not linked to this account — link it in the app first.',
  telegram_not_configured: 'Telegram delivery is not configured on the server.',
  telegram_send_failed: 'Telegram rejected the send. Try again.',
  tiktok_account_mismatch: "The tiktok_account_id didn't match the profile's linked TikTok account.",
  tiktok_no_linked_account: 'This profile has no linked TikTok account to deliver to.',
  tiktok_needs_reconnect: 'The TikTok account needs to be reconnected in the app.',
  tiktok_inbox_full: 'TikTok inbox is full — finish or clear your pending drafts first (max 5 per 24h).',
  tiktok_daily_cap: 'TikTok daily post cap reached — try again tomorrow.',
  tiktok_push_failed: 'TikTok rejected the push. Try again.',
  pending_tiktok_confirmation:
    'Pushed to TikTok inbox — TikTok has not yet confirmed it as terminal. It should settle shortly.',
};

const tool: SvmmonTool = {
  name: 'generate_slideshow',

  description:
    'Generate ONE complete TikTok slideshow from a Svmmon profile and a hook, render it, and optionally deliver it to TikTok or Telegram. ' +
    'The profile is the source of truth for tone, preset, images, slide counts, and CTA. ' +
    'Use when the user asks to make/create/build a slideshow or post from a hook. ' +
    'CONSUMES ONE SLIDESHOW from the monthly cap and is NOT idempotent — never call it twice for the same request; ' +
    'if it times out, check list_slideshows before retrying (the slideshow may already exist). ' +
    'Takes 30-120 seconds. Check get_usage first if you may be near the monthly cap. ' +
    'Returns a slideshow_id and a signed ZIP download_url valid for 24 hours. ' +
    'Delivery failures never fail generation — a failed TikTok/Telegram send comes back as a reason, not an error. ' +
    'Requires a ready profile_id (call list_profiles; only ready:true profiles can generate).',

  inputSchema: {
    type: 'object',
    properties: {
      profile_id: {
        type: 'string',
        description:
          'The id of a READY Svmmon profile (ready:true in list_profiles). The profile must have hook/body image collections configured. Must belong to the key owner.',
      },
      hook: {
        type: 'string',
        description:
          'The hook line — becomes slide 1 and the TikTok post title. Max 1000 chars. Often the top result from generate_hooks.',
        maxLength: MAX_HOOK_CHARS,
      },
      preset_id: {
        type: 'string',
        description:
          "Optional slide-structure preset id (from list_presets). Defaults to the profile's preset, then 'listicle'. An unknown id is rejected by the API.",
      },
      deliver: {
        type: 'string',
        enum: ['tiktok', 'telegram', 'none'],
        default: 'none',
        description:
          "Where to send the rendered slideshow. 'tiktok' pushes to the profile's linked TikTok inbox draft; 'telegram' sends the photo album; 'none' (default) just returns the download link.",
      },
      tiktok_account_id: {
        type: 'string',
        description:
          "Optional, only with deliver:'tiktok'. A confirmation that must match the profile's linked TikTok account, or delivery fails with a mismatch reason.",
      },
    },
    required: ['profile_id', 'hook'],
    additionalProperties: false,
  },

  async handler(args: Record<string, unknown>, client: SvmmonClient): Promise<ToolResult> {
    // ---- Local validation mirroring the route's documented bounds ----
    const profileId = typeof args.profile_id === 'string' ? args.profile_id.trim() : '';
    if (!profileId) {
      return errorResult('profile_id is required. Call list_profiles to get a ready profile id.');
    }

    const hook = typeof args.hook === 'string' ? args.hook.trim() : '';
    if (!hook) {
      return errorResult('hook is required (it becomes slide 1 and the post title).');
    }
    if (hook.length > MAX_HOOK_CHARS) {
      return errorResult(`hook exceeds ${MAX_HOOK_CHARS} chars (got ${hook.length}). Shorten it and try again.`);
    }

    let presetId: string | undefined;
    if (args.preset_id !== undefined && args.preset_id !== null) {
      if (typeof args.preset_id !== 'string') {
        return errorResult('preset_id must be a string. See list_presets for valid ids.');
      }
      presetId = args.preset_id.trim() || undefined;
    }

    let deliver: (typeof DELIVER_CHANNELS)[number] = 'none';
    if (args.deliver !== undefined && args.deliver !== null) {
      if (typeof args.deliver !== 'string' || !DELIVER_CHANNELS.includes(args.deliver as never)) {
        return errorResult("deliver must be 'tiktok', 'telegram', or 'none'.");
      }
      deliver = args.deliver as (typeof DELIVER_CHANNELS)[number];
    }

    let tiktokAccountId: string | undefined;
    if (args.tiktok_account_id !== undefined && args.tiktok_account_id !== null) {
      if (typeof args.tiktok_account_id !== 'string') {
        return errorResult('tiktok_account_id must be a string.');
      }
      tiktokAccountId = args.tiktok_account_id.trim() || undefined;
    }

    // ---- Build the exact body the route reads ----
    const body: Record<string, unknown> = { profile_id: profileId, hook, deliver };
    if (presetId !== undefined) body.preset_id = presetId;
    if (tiktokAccountId !== undefined) body.tiktok_account_id = tiktokAccountId;

    // ---- One request. NO retry: this is cost-bearing + not idempotent. ----
    let res: SlideshowCreateResponse;
    try {
      res = await client.request<SlideshowCreateResponse>('/api/v1/slideshows', {
        method: 'POST',
        body,
      });
    } catch (err) {
      if (err instanceof SvmmonApiError) {
        // A timeout (status 0) may have succeeded server-side — steer the agent
        // to verify rather than blind-retry this non-idempotent, cost-bearing call.
        if (err.status === 0) {
          return errorResult(
            err.message +
              ' Important: this call is not idempotent and may have succeeded — check list_slideshows before retrying.',
          );
        }
        return errorResult(err.message);
      }
      throw err; // server.ts catch-all maps anything unexpected
    }

    return successResult(res);
  },
};

function successResult(res: SlideshowCreateResponse): ToolResult {
  const lines: string[] = [];
  lines.push(`Slideshow generated (id: ${res.slideshow_id}).`);

  if (res.export) {
    lines.push(`Slides: ${res.export.slide_count}.`);
    lines.push(
      `Download (ZIP, expires in ~24h): ${res.export.download_url}` +
        (res.export.filename ? `\nFile: ${res.export.filename}` : ''),
    );
  }

  // Delivery outcome — never a failure of generation, just reported.
  if (res.delivered) {
    const d = res.delivered;
    const reasonText = d.reason ? DELIVERY_REASON_TEXT[d.reason] ?? d.reason : '';
    if (d.status === 'sent' && !d.reason) {
      lines.push(`Delivered to ${d.channel}: sent.`);
    } else if (d.status === 'sent' && d.reason) {
      lines.push(`Delivered to ${d.channel}: sent — ${reasonText}`);
    } else {
      lines.push(`Delivery to ${d.channel} failed: ${reasonText}`);
    }
  }

  // Oversized bodies (may be clipped on render).
  if (Array.isArray(res.body_oversized) && res.body_oversized.length > 0) {
    const idxs = res.body_oversized.map((o) => `slide ${o.slide_index} (${o.length} chars)`).join(', ');
    lines.push(`Heads up — these slides exceeded the safe text cap and may be clipped: ${idxs}.`);
  }

  // Soft warnings (truncation / soft compliance flags).
  if (Array.isArray(res.warnings) && res.warnings.length > 0) {
    const w = res.warnings.map((x) => `- [${x.code}] slide ${x.slide_index}: ${x.detail}`).join('\n');
    lines.push(`Warnings:\n${w}`);
  }

  return { content: [{ type: 'text', text: lines.join('\n') }] };
}

function errorResult(text: string): ToolResult {
  return { content: [{ type: 'text', text }], isError: true };
}

export default tool;
