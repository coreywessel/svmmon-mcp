/**
 * get_profile — GET /api/v1/profiles/{id}
 *
 * Mirrors app/api/v1/profiles/[id]/route.ts. Owner-scoped — another tenant's
 * id (or an unknown id) reads as 404, never revealing existence. Deep
 * single-profile read: the safe descriptive fields plus linked TikTok
 * accounts and automations, and the same ready/missing readiness contract
 * list_profiles exposes.
 */

import type { SvmmonTool, ToolResult, ProfileDetail } from '../types.js';
import { SvmmonApiError, type SvmmonClient } from '../client.js';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const tool: SvmmonTool = {
  name: 'get_profile',
  description:
    "Get one Svmmon profile's full detail — persona bio, audience, tone, CTA " +
    'settings, hashtag libraries, slide-count settings, learning state, readiness ' +
    '(ready/missing), linked TikTok accounts, and linked automations. This is the ' +
    'deep-read companion to list_profiles — use list_profiles first to find the ' +
    'id, then this to inspect one profile fully. Read-only — consumes no quota.',
  inputSchema: {
    type: 'object',
    properties: {
      profile_id: {
        type: 'string',
        description: 'UUID of the profile (from list_profiles). Required.',
      },
    },
    required: ['profile_id'],
    additionalProperties: false,
  },

  async handler(args: Record<string, unknown>, client: SvmmonClient): Promise<ToolResult> {
    const profileId = typeof args.profile_id === 'string' ? args.profile_id.trim() : '';
    if (!profileId || !UUID_RE.test(profileId)) {
      return {
        content: [{ type: 'text', text: 'profile_id must be a UUID. Call list_profiles to get real ids.' }],
        isError: true,
      };
    }

    try {
      const p = await client.request<ProfileDetail>(`/api/v1/profiles/${encodeURIComponent(profileId)}`);

      const lines: string[] = [];
      lines.push(`${p.name ?? '(unnamed)'} (${p.id})`);
      if (p.kind) lines.push(`Kind: ${p.kind}`);
      if (p.niche) lines.push(`Niche: ${p.niche}`);
      lines.push(p.ready ? 'Ready: yes' : `Ready: NO (missing: ${p.missing.join(', ') || 'unknown'})`);
      if (p.persona_bio) lines.push(`\nPersona bio:\n${p.persona_bio}`);
      if (p.audience) lines.push(`\nAudience:\n${p.audience}`);
      if (p.tone_prompt) lines.push(`\nTone:\n${p.tone_prompt}`);
      lines.push(
        `\nCTA: ${p.soft_cta ?? 'none'} (mode: ${p.cta_mode ?? 'unset'}, framing: ${p.cta_framing ?? 'unset'})`,
      );
      if (p.cta_description) lines.push(`CTA description: ${p.cta_description}`);
      lines.push(
        `Hashtags: primary [${p.primary_hashtags.join(', ') || 'none'}] · secondary [${p.secondary_hashtags.join(', ') || 'none'}]`,
      );
      lines.push(`Slide count mode: ${p.slide_count_mode ?? 'unset'}`);
      if (p.slide_count_mode === 'fixed') {
        lines.push(`Slide count: ${p.slide_count_fixed ?? 'unset'}`);
      } else {
        lines.push(`Slide count range: ${p.slide_count_min ?? '?'}–${p.slide_count_max ?? '?'}`);
      }
      if (p.words_per_slide) lines.push(`Words per slide: ${p.words_per_slide}`);
      lines.push(
        `Learning active: ${p.learning_active ? 'yes' : 'no'} · Auto-learning enabled: ${p.auto_learning_enabled ? 'yes' : 'no'}`,
      );

      if (p.linked_tiktok_accounts.length > 0) {
        lines.push('\nLinked TikTok accounts:');
        for (const acct of p.linked_tiktok_accounts) {
          lines.push(`  • ${acct.display_name ?? acct.id} (${acct.id})`);
        }
      } else {
        lines.push('\nLinked TikTok accounts: none');
      }

      if (p.automations.length > 0) {
        lines.push('\nLinked automations:');
        for (const a of p.automations) {
          lines.push(`  • ${a.name} (${a.id}) — ${a.active ? 'active' : 'paused'}`);
        }
      } else {
        lines.push('\nLinked automations: none');
      }

      if (p.archived_at) lines.push(`\nArchived: ${p.archived_at}`);

      return { content: [{ type: 'text', text: lines.join('\n') }] };
    } catch (err) {
      if (err instanceof SvmmonApiError) {
        if (err.status === 404) {
          return {
            content: [
              { type: 'text', text: "Profile not found, or it isn't on this account. Call list_profiles for valid ids." },
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
