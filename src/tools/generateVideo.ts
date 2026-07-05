/**
 * generate_video — POST /api/v1/studio/generate (capability: "video")
 *
 * BYOK: runs on the key owner's STORED provider key (Gemini Veo, fal.ai
 * Kling, or Replicate MiniMax — added in Svmmon → Settings → API Keys →
 * Studio), billed to THEIR provider account. Gated exactly like every other
 * tool: svm_ key, Growth+.
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
    '(Gemini Veo 3, fal.ai Kling 2.1, or Replicate MiniMax Video-01). ' +
    'Compute is billed to the user\'s provider account (BYOK), not to their Svmmon plan — video generation can cost $0.10–$1+ per clip. ' +
    'Omit provider/model to auto-pick the first provider the user has a key for. ' +
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
        enum: ['gemini', 'fal', 'replicate'],
        description: 'Optional. Which stored provider key to use (OpenAI has no video models). Omit to auto-pick.',
      },
      model: {
        type: 'string',
        description:
          'Optional provider model id (e.g. "veo-3.0-generate-001", ' +
          '"fal-ai/kling-video/v2.1/standard/text-to-video", "minimax/video-01"). Omit for the provider default.',
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
