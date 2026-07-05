/**
 * Shared helpers for the Studio tools (generate_image / generate_video).
 *
 * Both tools call POST /api/v1/studio/generate — the same svm_-key-gated
 * route as every other tool (Growth+). Generation runs on the key owner's
 * STORED provider key (added in Svmmon → Settings → API Keys → Studio);
 * compute is billed to the user's own provider account, never to Svmmon.
 *
 * Media handling: the API returns base64. We write it to a local file
 * (stdio MCP servers run on the user's machine) so the result is durable
 * and usable in follow-up steps, and return the absolute path.
 */
import { mkdirSync, writeFileSync, existsSync } from 'node:fs';
import { homedir, tmpdir } from 'node:os';
import { join } from 'node:path';

export const STUDIO_PROVIDERS = ['openai', 'gemini', 'fal', 'replicate', 'muapi'] as const;
export const STUDIO_ASPECTS = ['1:1', '9:16', '16:9'] as const;
export const MAX_PROMPT_CHARS = 2000; // route returns 400 above this

const EXT_FOR_MIME: Record<string, string> = {
  'image/png': 'png',
  'image/jpeg': 'jpg',
  'image/webp': 'webp',
  'video/mp4': 'mp4',
  'video/webm': 'webm',
};

/** Directory for saved media: ~/Downloads if present, else the OS temp dir. */
function outputDir(): string {
  const dl = join(homedir(), 'Downloads');
  if (existsSync(dl)) return dl;
  const fallback = join(tmpdir(), 'svmmon-studio');
  mkdirSync(fallback, { recursive: true });
  return fallback;
}

/** Write base64 media to disk, return the absolute path. */
export function saveMedia(dataB64: string, mime: string, kind: 'image' | 'video'): string {
  const ext = EXT_FOR_MIME[mime] ?? (kind === 'video' ? 'mp4' : 'png');
  const path = join(outputDir(), `svmmon-studio-${Date.now()}.${ext}`);
  writeFileSync(path, Buffer.from(dataB64, 'base64'));
  return path;
}

/** Validate the shared prompt/provider/aspect args. Returns an error string or null. */
export function validateCommonArgs(args: Record<string, unknown>): string | null {
  const prompt = typeof args.prompt === 'string' ? args.prompt.trim() : '';
  if (!prompt) return 'prompt is required.';
  if (prompt.length > MAX_PROMPT_CHARS) {
    return `prompt exceeds ${MAX_PROMPT_CHARS} chars (got ${prompt.length}). Shorten it.`;
  }
  if (args.provider !== undefined && args.provider !== null) {
    if (typeof args.provider !== 'string' || !(STUDIO_PROVIDERS as readonly string[]).includes(args.provider)) {
      return `provider must be one of: ${STUDIO_PROVIDERS.join(', ')}.`;
    }
  }
  if (args.aspect_ratio !== undefined && args.aspect_ratio !== null) {
    if (typeof args.aspect_ratio !== 'string' || !(STUDIO_ASPECTS as readonly string[]).includes(args.aspect_ratio)) {
      return `aspect_ratio must be one of: ${STUDIO_ASPECTS.join(', ')}.`;
    }
  }
  return null;
}

/** Build the request body shared by both tools. */
export function buildStudioBody(
  capability: 'image' | 'video',
  args: Record<string, unknown>,
): Record<string, unknown> {
  const body: Record<string, unknown> = {
    capability,
    prompt: (args.prompt as string).trim(),
  };
  if (typeof args.provider === 'string' && args.provider) body.provider = args.provider;
  if (typeof args.model === 'string' && args.model) body.model = args.model;
  if (typeof args.aspect_ratio === 'string' && args.aspect_ratio) body.aspect_ratio = args.aspect_ratio;
  return body;
}
