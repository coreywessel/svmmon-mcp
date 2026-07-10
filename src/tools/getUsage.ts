/**
 * get_usage — GET /api/v1/usage
 *
 * Mirrors app/api/v1/usage/route.ts. No request params (auth header only).
 * Response shape (the route's public contract):
 *   { tier, slideshows: { used, cap }, period_end (null for admin),
 *     tiktok_accounts: [{ account_id, display_name, tiktok_slots: { used, cap, available } }],
 *     ai_credits: { used, cap }, rerolls: { used, cap, remaining },
 *     shorts: { cap, blocked }, face_swaps: { cap, blocked },
 *     plan: { tier, plan_period }, caps: { tiktok_accounts, automations,
 *     image_collections, image_storage_bytes } }   // caps: null = unlimited
 *
 * tiktok_slots.available = inbox draft headroom (max 5 unpublished drafts per
 * account / rolling 24h). A slot read failure on the server fails CLOSED
 * (available 0). Empty tiktok_accounts when no TikTok account is connected.
 */

import type { SvmmonTool, ToolResult, UsageResponse } from '../types.js';
import { SvmmonApiError, type SvmmonClient } from '../client.js';

const tool: SvmmonTool = {
  name: 'get_usage',
  description:
    "Check the Svmmon account's current usage and limits: subscription tier + billing " +
    'period, monthly slideshows used vs. cap, AI credits (hook generation) used vs. cap, ' +
    'free re-rolls remaining, shorts/face-swap availability, per-TikTok-account inbox ' +
    'draft slots (used/cap/available), and account-level caps (TikTok accounts, ' +
    'automations, image collections, image storage). Use this to answer "how many ' +
    'slideshows / AI credits do I have left", "what plan am I on", or "how many TikTok ' +
    'slots are free" — and call it before a batch of generations to confirm there is ' +
    'quota and TikTok slot headroom. Consumes no quota.',
  inputSchema: { type: 'object', properties: {}, additionalProperties: false },

  async handler(_args: Record<string, unknown>, client: SvmmonClient): Promise<ToolResult> {
    try {
      const data = await client.request<UsageResponse>('/api/v1/usage');

      const { used, cap } = data.slideshows;
      const remaining = Math.max(0, cap - used);
      const lines: string[] = [];
      const period = data.plan?.plan_period ? ` (${data.plan.plan_period})` : '';
      lines.push(`Plan: ${data.tier}${period}`);
      lines.push(`Slideshows this period: ${used} used / ${cap} cap (${remaining} remaining)`);

      // Additive fields (API 2026-07-09). Guard each so this tool keeps working
      // against an older server that doesn't send them yet.
      if (data.ai_credits) {
        const aiRemaining = Math.max(0, data.ai_credits.cap - data.ai_credits.used);
        lines.push(
          `AI credits this period: ${data.ai_credits.used} used / ${data.ai_credits.cap} cap (${aiRemaining} remaining) — hook gen + quality check cost 1 each`,
        );
      }
      if (data.rerolls) {
        lines.push(
          `Free re-rolls this period: ${data.rerolls.used} used / ${data.rerolls.cap} cap (${data.rerolls.remaining} remaining)`,
        );
      }
      if (data.shorts) {
        lines.push(
          data.shorts.blocked
            ? 'Shorts: not available on this plan'
            : `Shorts: available (cap ${data.shorts.cap})`,
        );
      }
      if (data.face_swaps) {
        lines.push(
          data.face_swaps.blocked
            ? 'Face swaps: not available on this plan'
            : `Face swaps: available (cap ${data.face_swaps.cap})`,
        );
      }

      lines.push(`Period resets: ${data.period_end ?? 'never (admin key)'}`);

      if (data.caps) {
        const capStr = (n: number | null): string => (n === null ? 'unlimited' : String(n));
        const gb = (n: number | null): string =>
          n === null ? 'unlimited' : `${(n / (1024 * 1024 * 1024)).toFixed(1)} GB`;
        lines.push(
          'Account caps: ' +
            `${capStr(data.caps.tiktok_accounts)} TikTok accounts · ` +
            `${capStr(data.caps.automations)} automations · ` +
            `${capStr(data.caps.image_collections)} image collections · ` +
            `${gb(data.caps.image_storage_bytes)} image storage`,
        );
      }

      if (data.tiktok_accounts.length === 0) {
        lines.push('TikTok accounts: none connected');
      } else {
        lines.push('TikTok inbox slots (per account, max 5 drafts / rolling 24h):');
        for (const acct of data.tiktok_accounts) {
          const label = acct.display_name ?? acct.account_id;
          const s = acct.tiktok_slots;
          lines.push(`  • ${label}: ${s.available} available (${s.used} used / ${s.cap} cap)`);
        }
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
