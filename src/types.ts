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
  /** Effective tier of the key owner ("starter" | "growth" | "scale" | "unlimited" | "admin"). */
  tier: string;
  slideshows: { used: number; cap: number };
  /** ISO timestamp when the monthly counter resets; null for admin keys. */
  period_end: string | null;
  tiktok_accounts: TikTokAccountUsage[];
  /** AI credits this period (hook gen + quality check cost 1 each). */
  ai_credits: { used: number; cap: number };
  /** Free re-roll pool this period. */
  rerolls: { used: number; cap: number; remaining: number };
  /** blocked = feature not available on this tier. */
  shorts: { cap: number; blocked: boolean };
  face_swaps: { cap: number; blocked: boolean };
  /** plan_period: "monthly" | "annual" | null. */
  plan: { tier: string; plan_period: string | null };
  /** Membership-count gates (connect/create/upload-time limits). null = unlimited. */
  caps: {
    tiktok_accounts: number | null;
    automations: number | null;
    image_collections: number | null;
    image_storage_bytes: number | null;
  };
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

/** GET /api/v1/brain */
export interface BrainResponse {
  profiles: BrainProfile[];
}

export interface BrainProfile {
  profile_id: string;
  profile_name: string;
  /** Performance-weighting activation gate (~30 attributed posts). */
  learning_active: boolean;
  /** null until the first weekly analysis run. */
  brain: {
    summary_md: string;
    patterns: unknown[];
    dimensions: unknown[];
    formula: Record<string, unknown>;
    voice_dna: Record<string, unknown>;
    directions: Array<{ label?: string; trend?: string }>;
    next_hooks: string[];
    analyzed_post_count: number;
    last_analyzed_at: string | null;
  } | null;
  /** Learning-over-time timeline. */
  snapshots: Array<{ captured_at: string | null; analyzed_post_count: number; milestone: string | null }>;
  /** Only present with ?include=charts. */
  charts?: BrainCharts;
}

export interface BrainCharts {
  total_posts: number;
  slide_distribution: Array<{ slides: number; avg_views: number; posts: number }>;
  sweet_spot: { slides: number; avg_views: number; posts: number };
  top_hooks: Array<{ hook: string; views: number }>;
  growth_hooks: Array<{ hook: string; views: number }>;
  growth_hooks_worst: Array<{ hook: string; views: number }>;
  growth_daily: Array<{ date: string; cumulative: number }>;
}

/** GET /api/v1/master-brain */
export interface MasterBrainResponse {
  /** true once past the privacy floor AND generated. */
  ready: boolean;
  /** true while below the MIN_CONTRIBUTORS privacy floor. */
  warming_up: boolean;
  contributor_count: number;
  min_contributors: number;
  analyzed_profile_count: number;
  /** Empty while warming up. */
  summary_md: string;
  whats_working: Array<{ pattern?: string; note?: string }>;
  whats_not: Array<{ pattern?: string; note?: string }>;
  directions: Array<{ label?: string; trend?: string }>;
  top_dimensions: string[];
  generated_at: string | null;
  /** Generic market research, not community data. */
  niche_intelligence: { count: number; niches: unknown[]; goods: unknown[]; bads: unknown[] };
}

/** GET /api/v1/performance */
export interface PerformanceResponse {
  records: PerformanceRecord[];
  count: number;
}

export interface PerformanceRecord {
  id: string;
  slideshow_id: string | null;
  profile_id: string | null;
  platform: string;
  posted_at: string | null;
  url: string | null;
  day1_views: number | null;
  day1_logged_at: string | null;
  final_views: number | null;
  final_logged_at: string | null;
  likes: number | null;
  shares: number | null;
  comments: number | null;
  engagement_rate: number | null;
  virality_score_predicted: number | null;
  created_at: string;
}

/** GET /api/v1/tiktok/insights */
export interface TikTokInsightsResponse {
  connected: boolean;
  needs_reconnect?: boolean;
  /** Present on a 200 with an account read failure (account exists, read failed). */
  error?: string;
  account?: { id: string; display_name: string | null };
  accounts?: Array<{ id: string; display_name: string | null }>;
  profile?: {
    display_name: string;
    avatar_url: string | null;
    follower_count: number;
    likes_count: number;
    video_count: number;
  };
  /** Last 30 days, newest first. */
  videos?: Array<{
    id: string;
    title: string;
    cover_image_url: string | null;
    share_url: string | null;
    view_count: number;
    like_count: number;
    comment_count: number;
    share_count: number;
    create_time: number;
  }>;
}

/** GET /api/v1/collections */
export interface CollectionsResponse {
  collections: CollectionSummary[];
}

export interface CollectionHealth {
  never_used: number;
  fresh: number;
  active: number;
  heavy: number;
  danger: number;
  at_max: number;
}

export interface CollectionSummary {
  id: string;
  name: string;
  image_count: number;
  /** Storage path of the earliest image; null when empty. */
  cover_path: string | null;
  is_pinned: boolean;
  created_at: string;
  /** Per-collection image-usage tiers (image fatigue signal). */
  health: CollectionHealth;
}

/** GET /api/v1/collections/[id] */
export interface CollectionGetResponse {
  collection: { id: string; name: string; is_pinned: boolean; created_at: string; image_count: number };
  images: Array<{
    id: string;
    slide_count: number;
    export_count: number;
    valid: boolean;
    created_at: string;
    /** 10-minute signed URL; only present with include_image_urls, null when signing failed. */
    url?: string | null;
  }>;
  total: number;
  limit: number;
  offset: number;
}

/** GET /api/v1/studio/providers */
export interface StudioProvidersResponse {
  entitled: boolean;
  tier: string;
  provider_ids: string[];
  aggregators: string[];
  aggregator_markup: number;
  providers: Array<{
    provider: string;
    label: string;
    aggregator: boolean;
    capabilities: string[];
    /** Boolean only — never key material. */
    key_set: boolean;
  }>;
  models: StudioModelInfo[];
  /** Display estimate only. */
  spent_today: { est_usd: number; count: number };
  cinema_lenses: Array<{ id: string; label: string }>;
}

export interface StudioModelInfo {
  id: string;
  label: string;
  capability: string;
  description: string;
  family: string;
  recommended: string;
  featured: boolean;
  maxResolution: string;
  durationRange: unknown;
  hasAudio: boolean;
  supportsImageInput: boolean;
  requiresImageInput: boolean;
  maxReferences: number;
  supportsVideoInput: boolean;
  requiresVideoInput: boolean;
  requiresAudioInput: boolean;
  resolutions: string[];
  aspectRatios: string[];
  serving_providers: string[];
  /** true when the key owner has a stored key for any serving provider. */
  usable: boolean;
  est_cost: unknown;
  est_cost_effective: unknown;
  est_via_aggregator: boolean;
  resolved_unverified: boolean;
}

/** GET /api/v1/studio/history */
export interface StudioHistoryResponse {
  items: Array<{
    id: string;
    capability: 'image' | 'video' | 'lipsync' | 'cinema';
    kind: 'image' | 'video';
    provider: string;
    model: string;
    prompt: string;
    mime: string | null;
    /** Provider-hosted result URL — may be expired. */
    source_url: string | null;
    created_at: string;
  }>;
  note: string;
}

/** GET /api/v1/studio/saves */
export interface StudioSavesResponse {
  saves: Array<{
    id: string;
    capability: 'image' | 'video' | 'lipsync' | 'cinema';
    kind: 'image' | 'video';
    provider: string;
    model: string;
    prompt: string | null;
    /** Provider-hosted media URL — may be expired. */
    media_url: string;
    mime: string | null;
    created_at: string;
  }>;
  note: string;
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
