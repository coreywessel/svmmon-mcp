/**
 * get_usage — GET /api/v1/usage
 *
 * Mirrors app/api/v1/usage/route.ts. No request params (auth header only).
 * Response shape (the route's public contract):
 *   { tier, slideshows: { used, cap }, period_end (null for admin),
 *     tiktok_accounts: [{ account_id, display_name, tiktok_slots: { used, cap, available } }] }
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
    "Check the Svmmon account's current usage and limits: subscription tier, " +
    'monthly slideshows used vs. cap, when the counter resets, and per-TikTok-account ' +
    'inbox draft slots (used/cap/available). Use this to answer "how many slideshows ' +
    'do I have left", "check my Svmmon usage", or "how many TikTok slots are free" — ' +
    'and call it before a batch of generations to confirm there is quota and TikTok ' +
    'slot headroom. Consumes no quota.',
  inputSchema: { type: 'object', properties: {}, additionalProperties: false },

  async handler(_args: Record<string, unknown>, client: SvmmonClient): Promise<ToolResult> {
    try {
      const data = await client.request<UsageResponse>('/api/v1/usage');

      const { used, cap } = data.slideshows;
      const remaining = Math.max(0, cap - used);
      const lines: string[] = [];
      lines.push(`Tier: ${data.tier}`);
      lines.push(`Slideshows this period: ${used} used / ${cap} cap (${remaining} remaining)`);
      lines.push(`Period resets: ${data.period_end ?? 'never (admin key)'}`);

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
