/**
 * list_studio_providers — GET /api/v1/studio/providers
 *
 * Mirrors app/api/v1/studio/providers/route.ts. Any paid plan. Returns the
 * Studio provider list (with key_set booleans ONLY — never key material) and
 * the full model catalog with a precomputed `usable` flag per model (the key
 * owner has a stored provider key for one of its serving providers), plus
 * today's estimated Studio spend.
 */

import type { SvmmonTool, ToolResult, StudioProvidersResponse } from '../types.js';
import { SvmmonApiError, type SvmmonClient } from '../client.js';

const tool: SvmmonTool = {
  name: 'list_studio_providers',
  description:
    'List the Svmmon Studio providers and model catalog: which media providers (openai, ' +
    'gemini, fal, replicate, ...) the account has a stored key for, and every available ' +
    'image/video model with its capability, aspect ratios, cost estimate, and a `usable` ' +
    'flag (true = the account holds a key for a provider that can serve it). Call this ' +
    'BEFORE generate_image / generate_video to pick a usable provider+model — a model ' +
    'with usable: no will fail generation until the user adds that provider key at ' +
    'app.svmmonapp.com → Settings → API Keys → Studio. Also reports today\'s estimated ' +
    'Studio spend. Never returns key material. Read-only — consumes no quota.',
  inputSchema: { type: 'object', properties: {}, additionalProperties: false },

  async handler(_args: Record<string, unknown>, client: SvmmonClient): Promise<ToolResult> {
    try {
      const data = await client.request<StudioProvidersResponse>('/api/v1/studio/providers');

      const lines: string[] = [];
      lines.push(`Studio entitled: ${data.entitled ? 'yes' : 'no'} (tier: ${data.tier})`);
      lines.push(
        `Spent today (estimate): $${Number(data.spent_today?.est_usd ?? 0).toFixed(2)} over ${data.spent_today?.count ?? 0} generation(s)`,
      );

      lines.push('\nProviders:');
      for (const p of data.providers ?? []) {
        const agg = p.aggregator ? ' (aggregator)' : '';
        lines.push(
          `  • ${p.label} [${p.provider}]${agg} — key ${p.key_set ? 'SET' : 'not set'} · capabilities: ${p.capabilities.join(', ')}`,
        );
      }

      const models = data.models ?? [];
      const usable = models.filter((m) => m.usable);
      const unusable = models.filter((m) => !m.usable);

      const fmtModel = (m: (typeof models)[number]): string => {
        const bits: string[] = [m.capability];
        if (m.aspectRatios?.length) bits.push(`aspects: ${m.aspectRatios.join('/')}`);
        if (m.durationRange) bits.push(`duration: ${JSON.stringify(m.durationRange)}`);
        if (m.hasAudio) bits.push('audio');
        if (m.supportsImageInput) bits.push('image input');
        if (m.featured) bits.push('featured');
        const cost = m.est_cost_effective ?? m.est_cost;
        if (cost !== undefined && cost !== null && cost !== '') bits.push(`~cost: ${JSON.stringify(cost)}`);
        return `  • ${m.label} [${m.id}] — ${bits.join(' · ')} · via ${m.serving_providers.join('/')}`;
      };

      if (usable.length > 0) {
        lines.push(`\nUsable models (${usable.length} — a stored key covers them):`);
        for (const m of usable) lines.push(fmtModel(m));
      } else {
        lines.push('\nNo usable models yet — add a provider key at app.svmmonapp.com → Settings → API Keys → Studio.');
      }
      if (unusable.length > 0) {
        lines.push(`\nModels needing a provider key (${unusable.length}):`);
        for (const m of unusable) lines.push(fmtModel(m));
      }

      if ((data.cinema_lenses ?? []).length > 0) {
        lines.push(`\nCinema lenses: ${data.cinema_lenses.map((l) => `${l.label} [${l.id}]`).join(', ')}`);
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
