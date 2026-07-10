/**
 * get_brain — GET /api/v1/brain
 *
 * Mirrors app/api/v1/brain/route.ts. Growth+ only (the route adds its own tier
 * gate on top of the paid-key floor; below Growth → 403). Owner-scoped: only
 * the key owner's profiles.
 *
 * Query params:
 *   ?profile_id=<uuid>  scope to one profile (404 if not the owner's)
 *   ?include=charts     also compute the heavy pure-data charts per profile
 *
 * Response: { profiles: [{ profile_id, profile_name, learning_active,
 *   brain (null until first weekly analysis), snapshots[], charts? }] }
 */

import type { SvmmonTool, ToolResult, BrainResponse, BrainProfile } from '../types.js';
import { SvmmonApiError, type SvmmonClient } from '../client.js';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const tool: SvmmonTool = {
  name: 'get_brain',
  description:
    "Read the Svmmon account's personal Brain — the per-profile learned intelligence " +
    '(what works, patterns, formula, voice DNA, suggested next hooks) built from real ' +
    'TikTok post performance. Use this for "what has my brain learned", "what hooks ' +
    'should I try next", or to ground new hook/slideshow generation in learned patterns. ' +
    'brain is null for a profile until its first weekly analysis run; learning_active ' +
    'flips true once enough attributed posts exist. Optionally scope to one profile_id ' +
    'and/or set include_charts for computed performance charts (slide-count sweet spot, ' +
    'top/best/worst hooks, daily post growth). Requires the Growth plan or above. ' +
    'Read-only — consumes no quota.',
  inputSchema: {
    type: 'object',
    properties: {
      profile_id: {
        type: 'string',
        description:
          'Optional profile UUID to scope to one profile (get one from list_profiles). Omit for all profiles.',
      },
      include_charts: {
        type: 'boolean',
        description:
          'When true, also compute per-profile charts: slide distribution + sweet spot, top hooks, best/worst growth hooks, daily cumulative posts. Heavier call — default false.',
      },
    },
    additionalProperties: false,
  },

  async handler(args: Record<string, unknown>, client: SvmmonClient): Promise<ToolResult> {
    const profileId = typeof args.profile_id === 'string' ? args.profile_id.trim() : '';
    if (profileId && !UUID_RE.test(profileId)) {
      return {
        content: [{ type: 'text', text: 'profile_id must be a UUID. Call list_profiles to get real ids.' }],
        isError: true,
      };
    }
    const includeCharts = args.include_charts === true;

    try {
      const data = await client.request<BrainResponse>('/api/v1/brain', {
        query: {
          profile_id: profileId || undefined,
          include: includeCharts ? 'charts' : undefined,
        },
      });

      const profiles = data.profiles ?? [];
      if (profiles.length === 0) {
        return {
          content: [{ type: 'text', text: 'No profiles found on this account, so there is no brain data yet.' }],
        };
      }

      const sections = profiles.map((p) => formatProfile(p));
      return { content: [{ type: 'text', text: sections.join('\n\n---\n\n') }] };
    } catch (err) {
      if (err instanceof SvmmonApiError) {
        return { content: [{ type: 'text', text: err.message }], isError: true };
      }
      throw err;
    }
  },
};

function formatProfile(p: BrainProfile): string {
  const lines: string[] = [];
  lines.push(`Profile: ${p.profile_name} (${p.profile_id})`);
  lines.push(`Learning active: ${p.learning_active ? 'yes' : 'no (still accumulating attributed posts)'}`);

  if (!p.brain) {
    lines.push('Brain: not built yet — no weekly analysis has run for this profile.');
  } else {
    const b = p.brain;
    lines.push(`Analyzed posts: ${b.analyzed_post_count} · Last analyzed: ${b.last_analyzed_at ?? 'never'}`);
    if (b.summary_md) lines.push(`\nSummary:\n${b.summary_md}`);
    if (b.patterns.length > 0) lines.push(`\nPatterns:\n${JSON.stringify(b.patterns, null, 2)}`);
    if (b.dimensions.length > 0) lines.push(`\nDimensions:\n${JSON.stringify(b.dimensions, null, 2)}`);
    if (Object.keys(b.formula).length > 0) lines.push(`\nFormula:\n${JSON.stringify(b.formula, null, 2)}`);
    if (Object.keys(b.voice_dna).length > 0) lines.push(`\nVoice DNA:\n${JSON.stringify(b.voice_dna, null, 2)}`);
    if (b.directions.length > 0) {
      lines.push('\nDirections:');
      for (const d of b.directions) lines.push(`  • ${d.label ?? '(unlabeled)'} — ${d.trend ?? 'unknown'}`);
    }
    if (b.next_hooks.length > 0) {
      lines.push('\nSuggested next hooks:');
      for (const h of b.next_hooks) lines.push(`  • ${h}`);
    }
  }

  if (p.snapshots.length > 0) {
    lines.push('\nLearning timeline:');
    for (const s of p.snapshots) {
      const when = s.captured_at ?? 'unknown date';
      const milestone = s.milestone ? ` — ${s.milestone}` : '';
      lines.push(`  • ${when}: ${s.analyzed_post_count} posts analyzed${milestone}`);
    }
  }

  if (p.charts) {
    const c = p.charts;
    lines.push(`\nCharts (${c.total_posts} posts):`);
    if (c.sweet_spot.posts > 0) {
      lines.push(
        `  Sweet spot: ${c.sweet_spot.slides} slides (avg ${c.sweet_spot.avg_views} views over ${c.sweet_spot.posts} posts)`,
      );
    }
    if (c.slide_distribution.length > 0) {
      lines.push('  Slide distribution:');
      for (const d of c.slide_distribution) {
        lines.push(`    ${d.slides} slides → avg ${d.avg_views} views (${d.posts} posts)`);
      }
    }
    if (c.growth_hooks.length > 0) {
      lines.push('  Best hooks:');
      for (const h of c.growth_hooks) lines.push(`    • "${h.hook}" — ${h.views} views`);
    }
    if (c.growth_hooks_worst.length > 0) {
      lines.push('  Weakest hooks:');
      for (const h of c.growth_hooks_worst) lines.push(`    • "${h.hook}" — ${h.views} views`);
    }
    if (c.growth_daily.length > 0) {
      const last = c.growth_daily[c.growth_daily.length - 1];
      lines.push(`  Post growth: ${last.cumulative} cumulative posts as of ${last.date}`);
    }
  }

  return lines.join('\n');
}

export default tool;
