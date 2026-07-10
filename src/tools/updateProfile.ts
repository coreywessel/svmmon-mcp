/**
 * update_profile — PATCH /api/v1/profiles/{profile_id}
 *
 * WRITE + two-step confirm with a DIFF ECHO. Updates a restricted set of safe
 * descriptive / voice / CTA / hashtag / product fields (mirrors the server's
 * API_PROFILE_WRITE_FIELDS whitelist — any other key is dropped server-side).
 * Owner-scoped (404). Editing voice/tone changes every FUTURE post's output.
 *
 * The first call (confirm omitted/false) reads the CURRENT profile via
 * GET /api/v1/profiles/{id} and shows `field: <current> → <new>` for each field
 * the caller wants to change — nothing is written. A second call with
 * confirm:true performs the PATCH.
 *
 * Field schema is FLAT: writable fields are top-level properties alongside
 * profile_id + confirm (cleaner for the agent than a nested `fields` object).
 */

import type { SvmmonClient } from '../client.js';
import { SvmmonApiError } from '../client.js';
import type { SvmmonTool, ToolResult, ProfileDetail } from '../types.js';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Writable fields, mirroring API_PROFILE_WRITE_FIELDS. Non-field props are excluded. */
const WRITABLE_FIELDS = [
  'display_name', 'persona_bio', 'tone_prompt',
  'audience', 'audience_secondary', 'audience_gender', 'audience_age_range',
  'audience_core_desire', 'audience_pain_points', 'content_angles',
  'consistency_notes', 'persona_appearance',
  'speaker_age', 'speaker_life_stage', 'speaker_gender', 'energy_level',
  'use_lowercase', 'use_casual_spelling',
  'soft_cta', 'cta_description', 'cta_framing', 'cta_mode',
  'primary_hashtags', 'secondary_hashtags',
  'hashtag_select_mode', 'hashtag_random_count', 'hashtag_fixed_primary', 'hashtag_fixed_secondary',
  'tagline', 'website_url', 'product_type',
] as const;

/** Fields whose JSON type is not a plain string, for the input schema. */
const STRING_ARRAY_FIELDS = new Set(['primary_hashtags', 'secondary_hashtags']);
const NUMBER_FIELDS = new Set(['speaker_age', 'hashtag_random_count', 'hashtag_fixed_primary', 'hashtag_fixed_secondary']);
const BOOLEAN_FIELDS = new Set(['use_lowercase', 'use_casual_spelling']);

function fieldSchema(field: string): Record<string, unknown> {
  if (STRING_ARRAY_FIELDS.has(field)) {
    return { type: 'array', items: { type: 'string' }, description: `New value for ${field} (array of strings).` };
  }
  if (NUMBER_FIELDS.has(field)) {
    return { type: 'number', description: `New value for ${field}.` };
  }
  if (BOOLEAN_FIELDS.has(field)) {
    return { type: 'boolean', description: `New value for ${field}.` };
  }
  return { type: 'string', description: `New value for ${field}.` };
}

const properties: Record<string, unknown> = {
  profile_id: {
    type: 'string',
    description: 'UUID of the owned profile to edit (from list_profiles). Required.',
  },
  confirm: {
    type: 'boolean',
    description:
      'Must be true to EXECUTE. Omit/false to preview the exact consequence and cost first — nothing happens until you call again with confirm:true.',
  },
};
for (const f of WRITABLE_FIELDS) properties[f] = fieldSchema(f);

const tool: SvmmonTool = {
  name: 'update_profile',
  description:
    "Edit a Svmmon profile's safe descriptive / voice / CTA / hashtag / product fields (a strict whitelist — compliance and internal columns are never writable here). " +
    'WRITE action — TWO-STEP: the first call reads the current profile and shows a field-by-field diff (current → new) and does NOTHING; ' +
    'call again with confirm:true to actually save. Editing your persona voice changes every FUTURE post\'s tone, so ALWAYS show the user the diff and get their go-ahead before passing confirm:true. ' +
    'Pass profile_id plus any writable fields to change. Get a profile_id from list_profiles. Consumes no generation quota.',
  inputSchema: {
    type: 'object',
    properties,
    required: ['profile_id'],
    additionalProperties: false,
  },

  async handler(args: Record<string, unknown>, client: SvmmonClient): Promise<ToolResult> {
    const profileId = typeof args.profile_id === 'string' ? args.profile_id.trim() : '';
    if (!profileId || !UUID_RE.test(profileId)) {
      return errorResult('profile_id must be a UUID. Call list_profiles to get real ids.');
    }

    // Collect the fields the caller actually wants to change.
    const changes: Record<string, unknown> = {};
    for (const f of WRITABLE_FIELDS) {
      if (args[f] !== undefined) changes[f] = args[f];
    }
    if (Object.keys(changes).length === 0) {
      return errorResult(
        `No writable fields provided. Pass at least one of: ${WRITABLE_FIELDS.join(', ')}.`,
      );
    }

    if (args.confirm !== true) {
      // DIFF ECHO: read the current profile so the preview shows current → new.
      let current: ProfileDetail | null = null;
      try {
        current = await client.request<ProfileDetail>(`/api/v1/profiles/${encodeURIComponent(profileId)}`);
      } catch (err) {
        if (err instanceof SvmmonApiError) {
          if (err.status === 404) {
            return errorResult("Profile not found, or it isn't on this account. Call list_profiles for valid ids.");
          }
          return errorResult(err.message);
        }
        throw err;
      }

      const cur = current as unknown as Record<string, unknown>;
      const diffLines = Object.entries(changes).map(([field, next]) => {
        const has = current !== null && field in cur;
        const before = has ? fmt(cur[field]) : '<not shown by read>';
        return `  ${field}: ${before} → ${fmt(next)}`;
      });
      const consequence =
        `Update profile "${current?.name ?? profileId}" (${profileId}):\n${diffLines.join('\n')}\n\n` +
        'Editing your persona voice changes every FUTURE post\'s tone.';
      return previewResult('update_profile', consequence);
    }

    try {
      const updated = await client.request<ProfileDetail>(
        `/api/v1/profiles/${encodeURIComponent(profileId)}`,
        { method: 'PATCH', body: changes },
      );
      const lines: string[] = [];
      lines.push(`Updated profile "${updated.name ?? profileId}" (${updated.id}).`);
      lines.push(`Fields changed: ${Object.keys(changes).join(', ')}.`);
      const u = updated as unknown as Record<string, unknown>;
      for (const field of Object.keys(changes)) {
        if (field in u) lines.push(`  ${field}: ${fmt(u[field])}`);
      }
      return { content: [{ type: 'text', text: lines.join('\n') }] };
    } catch (err) {
      if (err instanceof SvmmonApiError) {
        if (err.status === 404) {
          return errorResult("Profile not found, or it isn't on this account. Call list_profiles for valid ids.");
        }
        return errorResult(err.message);
      }
      throw err;
    }
  },
};

function fmt(v: unknown): string {
  if (v === null || v === undefined) return 'none';
  if (Array.isArray(v)) return v.length > 0 ? `[${v.join(', ')}]` : '[]';
  const s = String(v);
  return s.length > 200 ? `${s.slice(0, 200)}…` : s;
}

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
