/**
 * generate_video — POST /api/v1/studio/generate (capability: "video")
 *
 * BYOK: runs on the key owner's STORED provider key (Gemini Veo, fal.ai
 * Kling, or Replicate MiniMax — added in Svmmon → Settings → API Keys →
 * Studio), billed to THEIR provider account. Gated exactly like every other
 * tool: svm_ key, any paid plan.
 *
 * Video jobs are long-running (the route polls the provider, up to ~4 min).
 * The result is written to a local file and the path returned — video is far
 * too large to inline into the conversation.
 *
 * COST-BEARING on the USER'S provider account — never retried here. A
 * timeout may still have succeeded provider-side; the user should check
 * their provider dashboard before re-running.
 */
import type { SvmmonClient } from '../client.js';
import { SvmmonApiError } from '../client.js';
import type { StudioGenerateResponse, SvmmonTool, ToolResult } from '../types.js';
import { buildStudioBody, saveMedia, validateCommonArgs } from './studioShared.js';

const tool: SvmmonTool = {
  name: 'generate_video',

  description:
    'Generate an AI video clip via Svmmon Studio using the user\'s OWN stored provider key ' +
    '(Gemini Veo, Replicate MiniMax, or an aggregator: fal.ai / Muapi.ai — one aggregator key unlocks Kling, Veo, MiniMax, Wan). ' +
    'Compute is billed to the user\'s provider account (BYOK), not to their Svmmon plan — video generation can cost $0.10–$1+ per clip. ' +
    'Omit provider/model to auto-pick the first model the user has a serving key for. ' +
    'Takes 1–4 minutes; the video is saved to a local file and the path is returned. ' +
    'If it fails with "no key on file", tell the user to add a Studio key at Settings → API Keys → Studio. ' +
    'COST: spends the user\'s own provider credits — NEVER retry on a timeout (the job may have completed provider-side).',

  inputSchema: {
    type: 'object',
    properties: {
      prompt: {
        type: 'string',
        description: 'What to generate — describe the shot, motion, and mood. Max 2000 chars.',
        maxLength: 2000,
      },
      provider: {
        type: 'string',
        enum: ['gemini', 'fal', 'replicate', 'muapi'],
        description: 'Optional. Which stored key runs it when a model is served by more than one (OpenAI has no video). Omit to auto-pick.',
      },
      model: {
        type: 'string',
        description:
          'Optional canonical model id (e.g. "veo-3.0-generate-001", "kling-2.1-t2v", ' +
          '"kling-2.1-i2v", "minimax-video-01", "wan-2.1-t2v"). Omit for auto-pick.',
      },
      aspect_ratio: {
        type: 'string',
        enum: ['9:16', '16:9'],
        description: 'Optional. Defaults to 9:16 (TikTok portrait).',
      },
    },
    required: ['prompt'],
    additionalProperties: false,
  },

  async handler(args: Record<string, unknown>, client: SvmmonClient): Promise<ToolResult> {
    const invalid = validateCommonArgs(args);
    if (invalid) return errorResult(invalid);
    // OpenAI has no video capability — catch it locally with a clearer message
    // than the server's generic invalid-provider error.
    if (args.provider === 'openai') {
      return errorResult('OpenAI has no video models. Use gemini (Veo), fal, or replicate — or omit provider to auto-pick.');
    }

    let res: StudioGenerateResponse;
    try {
      res = await client.request<StudioGenerateResponse>('/api/v1/studio/generate', {
        method: 'POST',
        body: buildStudioBody('video', args),
      });
    } catch (err) {
      if (err instanceof SvmmonApiError) return errorResult(err.message);
      throw err;
    }

    const media = Array.isArray(res.media) ? res.media[0] : undefined;
    if (!media?.data_b64) {
      return errorResult('The provider returned no video. Try a different prompt or provider.');
    }

    let path: string;
    try {
      path = saveMedia(media.data_b64, media.mime, 'video');
    } catch {
      return errorResult('Generated the video but failed to write it to disk.');
    }

    return {
      content: [
        {
          type: 'text',
          text:
            `Generated a video with ${res.provider} (${res.model}).\n` +
            `Saved to: ${path}\n` +
            'Billed to the user\'s own provider account (BYOK).',
        },
      ],
    };
  },
};

function errorResult(text: string): ToolResult {
  return { content: [{ type: 'text', text }], isError: true };
}

export default tool;
