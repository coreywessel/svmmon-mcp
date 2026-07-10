/**
 * list_connections — GET /api/v1/connections
 *
 * Mirrors app/api/v1/connections/route.ts. No request params (auth header only).
 * Response shape (the route's public contract):
 *   { connections: [{ id, username, display_name, profile_id, connected,
 *                      needs_reconnect, connection_error, refresh_expires_at,
 *                      created_at }], count }
 *
 * Every listed row is a live, connected TikTok account (the route excludes
 * tokenless/archived rows) — needs_reconnect/connection_error carry a LIVE
 * decryptability check, not just a stale flag.
 */

import type { SvmmonTool, ToolResult, ConnectionsResponse } from '../types.js';
import { SvmmonApiError, type SvmmonClient } from '../client.js';

const tool: SvmmonTool = {
  name: 'list_connections',
  description:
    "List the account's connected TikTok accounts and their live connection health " +
    '(needs_reconnect, connection_error) — id, username, display_name, linked ' +
    'profile_id, refresh_expires_at, and created_at per account. Use this for ' +
    '"which of my TikTok accounts need reconnecting" or "what TikTok accounts are ' +
    'connected". Read-only — consumes no quota.',
  inputSchema: { type: 'object', properties: {}, additionalProperties: false },

  async handler(_args: Record<string, unknown>, client: SvmmonClient): Promise<ToolResult> {
    try {
      const data = await client.request<ConnectionsResponse>('/api/v1/connections');

      if (data.connections.length === 0) {
        return {
          content: [
            {
              type: 'text',
              text: 'No TikTok accounts connected on this account. Connect one at app.svmmonapp.com → Accounts.',
            },
          ],
        };
      }

      const lines: string[] = [`${data.count} connected TikTok account(s):`];
      for (const c of data.connections) {
        const label = c.display_name ?? c.username ?? c.id;
        const parts: string[] = [`id: ${c.id}`];
        if (c.username) parts.push(`@${c.username}`);
        parts.push(c.profile_id ? `profile: ${c.profile_id}` : 'profile: unlinked');
        parts.push(c.needs_reconnect ? 'NEEDS RECONNECT' : 'healthy');
        if (c.connection_error) parts.push(`error: ${c.connection_error}`);
        lines.push(`  • ${label} — ${parts.join(' · ')}`);
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
