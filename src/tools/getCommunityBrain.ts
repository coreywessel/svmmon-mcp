/**
 * get_community_brain — GET /api/v1/master-brain
 *
 * Mirrors app/api/v1/master-brain/route.ts. Any paid plan. Returns ONLY the
 * anonymized synthesized community view (the master_brain singleton) plus
 * generic niche market research — never per-user or per-profile data.
 *
 * Warming-up state: ready:false / warming_up:true with empty summary/arrays
 * until the community crosses the contributor privacy floor.
 */

import type { SvmmonTool, ToolResult, MasterBrainResponse } from '../types.js';
import { SvmmonApiError, type SvmmonClient } from '../client.js';

const tool: SvmmonTool = {
  name: 'get_community_brain',
  description:
    'Read the Svmmon community Brain (master brain) — anonymized, aggregated intelligence ' +
    'synthesized across all contributing Svmmon users: what content patterns are working ' +
    'and not working community-wide, trending directions, top virality dimensions, plus ' +
    'generic niche market research. Use this for "what is working for other creators" or ' +
    'to sanity-check a content strategy against community-wide signal. If `ready` is false ' +
    'the community is still warming up (below the contributor privacy floor) and the summary ' +
    'is empty. Contains no per-user data. No arguments. Read-only — consumes no quota.',
  inputSchema: { type: 'object', properties: {}, additionalProperties: false },

  async handler(_args: Record<string, unknown>, client: SvmmonClient): Promise<ToolResult> {
    try {
      const data = await client.request<MasterBrainResponse>('/api/v1/master-brain');

      const lines: string[] = [];
      if (!data.ready) {
        lines.push(
          data.warming_up
            ? `Community brain is warming up: ${data.contributor_count} of ${data.min_contributors} minimum contributors. No synthesized intelligence yet.`
            : 'Community brain is not ready yet — the first rollup has not run.',
        );
      } else {
        lines.push(
          `Community brain (generated ${data.generated_at ?? 'unknown'}) — ` +
            `${data.contributor_count} contributors, ${data.analyzed_profile_count} profiles analyzed.`,
        );
        if (data.summary_md) lines.push(`\nSummary:\n${data.summary_md}`);
        if (data.whats_working.length > 0) {
          lines.push('\nWhat is working:');
          for (const w of data.whats_working) {
            lines.push(`  • ${w.pattern ?? '(pattern)'}${w.note ? ` — ${w.note}` : ''}`);
          }
        }
        if (data.whats_not.length > 0) {
          lines.push('\nWhat is NOT working:');
          for (const w of data.whats_not) {
            lines.push(`  • ${w.pattern ?? '(pattern)'}${w.note ? ` — ${w.note}` : ''}`);
          }
        }
        if (data.directions.length > 0) {
          lines.push('\nDirections:');
          for (const d of data.directions) lines.push(`  • ${d.label ?? '(unlabeled)'} — ${d.trend ?? 'unknown'}`);
        }
        if (data.top_dimensions.length > 0) {
          lines.push(`\nTop dimensions: ${data.top_dimensions.join(', ')}`);
        }
      }

      const ni = data.niche_intelligence;
      if (ni && ni.count > 0) {
        lines.push(`\nNiche market research (${ni.count} niches):\n${JSON.stringify(ni, null, 2)}`);
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
