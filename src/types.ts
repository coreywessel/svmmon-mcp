/**
 * Shared types for svmmon-mcp.
 *
 * Two halves:
 *   1. Response types — mirror the EXACT JSON shapes returned by the real
 *      /api/v1 routes (grounded in app/api/v1/*.ts; do not invent fields).
 *   2. The Tool module contract — every file in src/tools/*.ts MUST export a
 *      default `SvmmonTool` conforming to this interface so server.ts can
 *      register them uniformly.
 */

import type { SvmmonClient } from './client.js';

/* ------------------------------------------------------------------ *
 * 1. API response types (mirror /api/v1 route response shapes)
 * ------------------------------------------------------------------ */

/** GET /api/v1/usage */
export interface UsageResponse {
  /** Effective tier of the key owner ("growth" | "scale" | "unlimited" | "admin"). */
  tier: string;
  slideshows: { used: number; cap: number };
  /** ISO timestamp when the monthly counter resets; null for admin keys. */
  period_end: string | null;
  tiktok_accounts: TikTokAccountUsage[];
}

export interface TikTokAccountUsage {
  account_id: string;
  display_name: string | null;
  /** Per-account inbox draft cap (max 5 unpublished drafts per rolling 24h). */
  tiktok_slots: { used: number; cap: number; available: number };
}

/** GET /api/v1/profiles */
export interface ProfilesResponse {
  profiles: ProfileSummary[];
}

export interface ProfileSummary {
  id: string;
  name: string | null;
  /** profile_kind, e.g. "persona". */
  kind: string | null;
  /** Comma-joined categories, or null when none set. */
  niche: string | null;
  /** Only ready:true profiles can generate a slideshow. */
  ready: boolean;
  /** Failed readiness checks: "hook_image_collection" | "body_image_collection". */
  missing: string[];
  /** Has a connected TikTok account — only matters for deliver:"tiktok". */
  tiktok_linked: boolean;
}

/** GET /api/v1/presets */
export interface PresetsResponse {
  presets: PresetSummary[];
}

export interface PresetSummary {
  /** Any id here is a legal preset_id for POST /api/v1/slideshows. */
  id: string;
  name: string;
  structure_summary: string;
}

/** POST /api/v1/hooks/generate */
export interface HooksGenerateResponse {
  /** May contain FEWER than the requested count if the ai_credit cap is hit mid-request. */
  hooks: HookCandidate[];
}

export interface HookCandidate {
  text: string;
  /** 0-100 regex virality score. */
  score: number;
}

/** GET /api/v1/slideshows (list) */
export interface SlideshowListResponse {
  slideshows: SlideshowListItem[];
}

export interface SlideshowListItem {
  id: string;
  hook: string | null;
  profile_id: string | null;
  created_at: string;
}

/** GET /api/v1/slideshows/[id] */
export interface SlideshowGetResponse {
  id: string;
  hook: string | null;
  profile_id: string | null;
  created_at: string;
  /** urls = 1h signed export URLs; empty when no export file exists. */
  export: { urls: string[] };
}

/** POST /api/v1/slideshows (create) */
export interface SlideshowCreateResponse {
  slideshow_id: string;
  status: 'completed';
  export: {
    /** Signed ZIP of the rendered PNGs + metadata.json. Valid 24h. */
    download_url: string;
    filename: string;
    expires_in_seconds: number;
    slide_count: number;
  };
  /** Slides whose body text exceeded the safe render cap (may be clipped). */
  body_oversized?: Array<{ slide_index: number; length: number }>;
  warnings: SlideshowWarning[];
  /** null unless deliver was "tiktok" or "telegram". */
  delivered: SlideshowDelivery | null;
}

export interface SlideshowWarning {
  code: string;
  slide_index: number;
  detail: string;
}

export interface SlideshowDelivery {
  channel: 'tiktok' | 'telegram';
  status: 'sent' | 'failed';
  /**
   * Set on failure (and on the "sent" pending_tiktok_confirmation case).
   * One of: telegram_not_linked, telegram_not_configured, telegram_send_failed,
   * tiktok_account_mismatch, tiktok_no_linked_account, tiktok_needs_reconnect,
   * tiktok_inbox_full, tiktok_daily_cap, tiktok_push_failed,
   * pending_tiktok_confirmation.
   */
  reason?: string;
}

/** POST /api/v1/studio/generate */
export interface StudioGenerateResponse {
  provider: string;
  model: string;
  media: StudioMediaItem[];
}

export interface StudioMediaItem {
  kind: 'image' | 'video';
  mime: string;
  /** Raw base64 of the generated media. */
  data_b64: string;
}

/* ------------------------------------------------------------------ *
 * 2. Tool module contract
 * ------------------------------------------------------------------ *
 *
 * Every src/tools/*.ts exports `export default tool;` where `tool` satisfies
 * SvmmonTool. server.ts collects them into an array, advertises them via
 * ListTools, and dispatches CallTool by name. The handler receives the parsed
 * tool arguments and the shared SvmmonClient (so a tool never constructs its
 * own client or touches the key directly).
 *
 * inputSchema is a raw JSON Schema object (the MCP wire format). For a no-arg
 * tool use: { type: 'object', properties: {}, additionalProperties: false }.
 */

/** A minimal JSON Schema object as accepted by the MCP ListTools inputSchema field. */
export interface JsonSchema {
  type: 'object';
  properties?: Record<string, unknown>;
  required?: string[];
  additionalProperties?: boolean;
  [key: string]: unknown;
}

/** The structured result a tool handler returns. content[] is the MCP tool-result payload. */
export interface ToolResult {
  content: Array<
    | { type: 'text'; text: string }
    /** Inline media (base64) — used by generate_image so clients can render the result. */
    | { type: 'image'; data: string; mimeType: string }
  >;
  /** true => the client renders this as a tool error (clean human message, never the key). */
  isError?: boolean;
}

/** The contract every tool file in src/tools/*.ts conforms to. */
export interface SvmmonTool {
  /** Tool name surfaced to the agent, e.g. "generate_slideshow". verb_noun. */
  name: string;
  /** Agent-facing description. MUST carry the load-bearing warnings (not idempotent, etc.). */
  description: string;
  /** Raw JSON Schema for the tool's arguments. */
  inputSchema: JsonSchema;
  /**
   * Executes the tool. `args` is the raw arguments object from CallTool
   * (validate/coerce inside the handler — mirror the API's documented bounds
   * only, do not re-implement its logic). `client` is the shared API client.
   * Throw nothing for upstream API errors — convert SvmmonApiError into a clean
   * ToolResult with isError:true (server.ts also has a catch-all safety net).
   */
  handler(args: Record<string, unknown>, client: SvmmonClient): Promise<ToolResult>;
}
