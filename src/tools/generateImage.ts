/**
 * generate_image — POST /api/v1/studio/generate (capability: "image")
 *
 * BYOK: generation runs on the key owner's STORED provider key (OpenAI /
 * Gemini / fal.ai / Replicate — added in Svmmon → Settings → API Keys →
 * Studio) and is billed to THEIR provider account, never to Svmmon. Gated
 * exactly like every other tool: svm_ key, Growth+.
 *
 * When provider/model are omitted the server auto-picks the first stored key
 * that can do images. A 412 "no_key" means the user has no usable Studio key.
 *
 * COST-BEARING on the USER'S provider account — never retried here.
 */
import type { SvmmonClient } from '../client.js';
import { SvmmonApiError } from '../client.js';
import type { StudioGenerateResponse, SvmmonTool, ToolResult } from '../types.js';
import { buildStudioBody, saveMedia, validateCommonArgs } from './studioShared.js';

// Keep inline image blocks under ~1.5M base64 chars (~1.1 MB) so a large PNG
// doesn't blow up the client context; the file on disk is the real artifact.
const MAX_INLINE_B64 = 1_500_000;

const tool: SvmmonTool = {
  name: 'generate_image',

  description:
    'Generate an AI image via Svmmon Studio using the user\'s OWN stored provider key ' +
    '(OpenAI, Gemini, Replicate, or an aggregator: fal.ai / Muapi.ai — one aggregator key unlocks many models). ' +
    'Compute is billed to the user\'s provider account (BYOK), not to their Svmmon plan. ' +
    'Omit provider/model to auto-pick the first model the user has a serving key for. ' +
    'The image is saved to a local file and the path is returned. ' +
    'If it fails with "no key on file", tell the user to add a Studio key at Settings → API Keys → Studio. ' +
    'COST: spends the user\'s own provider credits — do not retry on timeout.',

  inputSchema: {
    type: 'object',
    properties: {
      prompt: {
        type: 'string',
        description: 'What to generate. Max 2000 chars.',
        maxLength: 2000,
      },
      provider: {
        type: 'string',
        enum: ['openai', 'gemini', 'fal', 'replicate', 'muapi'],
        description: 'Optional. Which stored key runs it when a model is served by more than one. Omit to auto-pick.',
      },
      model: {
        type: 'string',
        description:
          'Optional canonical model id (e.g. "gpt-image-1", "imagen-4.0-generate-001", ' +
          '"flux-schnell", "flux-dev", "flux-1.1-pro", "sdxl", "ideogram-v2", "recraft-v3"). Omit for auto-pick.',
      },
      aspect_ratio: {
        type: 'string',
        enum: ['1:1', '9:16', '16:9'],
        description: 'Optional. Defaults to 9:16 (TikTok portrait).',
      },
    },
    required: ['prompt'],
    additionalProperties: false,
  },

  async handler(args: Record<string, unknown>, client: SvmmonClient): Promise<ToolResult> {
    const invalid = validateCommonArgs(args);
    if (invalid) return errorResult(invalid);

    let res: StudioGenerateResponse;
    try {
      res = await client.request<StudioGenerateResponse>('/api/v1/studio/generate', {
        method: 'POST',
        body: buildStudioBody('image', args),
      });
    } catch (err) {
      if (err instanceof SvmmonApiError) return errorResult(err.message);
      throw err;
    }

    const media = Array.isArray(res.media) ? res.media[0] : undefined;
    if (!media?.data_b64) {
      return errorResult('The provider returned no image. Try a different prompt or provider.');
    }

    let path: string;
    try {
      path = saveMedia(media.data_b64, media.mime, 'image');
    } catch {
      return errorResult('Generated the image but failed to write it to disk.');
    }

    const content: ToolResult['content'] = [
      {
        type: 'text',
        text:
          `Generated an image with ${res.provider} (${res.model}).\n` +
          `Saved to: ${path}\n` +
          'Billed to the user\'s own provider account (BYOK).',
      },
    ];
    if (media.data_b64.length <= MAX_INLINE_B64) {
      content.push({ type: 'image', data: media.data_b64, mimeType: media.mime });
    }
    return { content };
  },
};

function errorResult(text: string): ToolResult {
  return { content: [{ type: 'text', text }], isError: true };
}

export default tool;
