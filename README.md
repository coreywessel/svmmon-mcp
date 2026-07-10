# svmmon-mcp

Generate TikTok slideshows from Claude (and any MCP client) using your [Svmmon](https://app.svmmonapp.com) account.

This is a thin, local **stdio MCP server** that wraps Svmmon's public `/api/v1` REST API. Install it, paste your key, and ask Claude to make slideshows in plain language. It adds no business logic — every tool maps 1:1 onto a real Svmmon endpoint.

> **Requires an active subscription.** The API works on any active paid plan (per-tier volume caps still apply). Install always works; the tools return a clean "requires an active subscription" message until you paste a valid paid key.

---

## Quickstart

### 1. Get your key

app.svmmonapp.com → **Settings → API Keys → Svmmon API → Generate key** (any paid plan). It looks like `svm_xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx`.

> Treat this key like a password. If it's ever exposed, revoke it instantly in **Settings → API Keys** — the MCP can't revoke it for you.

### 2. Add the server

**Claude Desktop** — edit `claude_desktop_config.json`:

```json
{
  "mcpServers": {
    "svmmon": {
      "command": "npx",
      "args": ["-y", "svmmon-mcp"],
      "env": { "SVMMON_API_KEY": "svm_your_key_here" }
    }
  }
}
```

**Claude Code:**

```bash
claude mcp add svmmon -e SVMMON_API_KEY=svm_your_key_here -- npx -y svmmon-mcp
```

### 3. Ask

> *Generate 5 hooks for my Marcus profile and make a slideshow from the best one.*

---

## Tools

| Tool | What it does |
|---|---|
| `get_usage` | Full usage: tier + plan, slideshows used/cap, AI credits, rerolls, shorts/face-swap caps, account caps, per-account TikTok inbox slots. |
| `list_profiles` | Your profiles with `id`, `name`, `niche`, `ready`, `missing`, `tiktok_linked`. Only `ready` profiles can generate. |
| `list_presets` | Valid `preset_id` values for slideshow generation. |
| `generate_hooks` | Scored hook candidates for a profile. May return fewer than requested if your AI-credit cap is hit. |
| `generate_slideshow` | Generates ONE slideshow (consumes one from your monthly cap — **not idempotent**). Returns a 24h download link; optionally delivers to TikTok/Telegram. |
| `generate_image` | Studio image generation on your own provider key (BYOK — **not idempotent**). |
| `generate_video` | Studio video generation on your own provider key (BYOK — **not idempotent**). |
| `list_slideshows` | Your recent slideshows. |
| `get_slideshow` | Fetch a slideshow + a fresh 1h download link by id. |
| `list_collections` | Your image collections with per-collection image-fatigue health tiers. |
| `get_collection` | One collection's images, with optional 10-min signed URLs so a vision agent can inspect them. |
| `get_brain` | Your personal brain for a profile — patterns, voice DNA, next-hook directions (Growth+). |
| `get_community_brain` | The anonymized community brain — what's working across accounts. |
| `get_performance` | Post performance — views/likes/shares/comments, day-1 + final. |
| `get_tiktok_insights` | Live TikTok profile + recent-video stats (Growth+). |
| `list_studio_providers` | Studio model catalog + which of your provider keys unlock what. |
| `list_studio_history` | Recent studio generations (metadata; provider source URLs may be expired). |
| `list_studio_saves` | Your saved studio generations. |
| `list_connections` | Your connected TikTok accounts + live connection health (needs_reconnect, connection_error). |
| `list_automations` | Your automations — active state, schedule, delivery mode, hook source, hook count, last run status. |
| `get_automation` | One automation's full detail by id. |
| `get_schedule` | Your posting schedule — every slot's time, days, timezone, and which automation fires it. |
| `get_profile` | One profile's full detail — bio, audience, tone, CTA, hashtags, readiness, linked accounts/automations. |
| `get_profile_hooks` | A profile's hook library — text, status, source, used_count, virality_score. |
| `get_trending` | Globally trending TikTok posts (not account-specific) — optional hashtag/days filter. |

### Write tools

Every write tool is **two-step confirm-gated**: the first call returns a preview of the exact consequence and cost and does nothing; you must call again with `confirm: true` to execute. Surface the preview to the user before confirming.

| Tool | What it does |
|---|---|
| `upload_images` | Upload base64 images (max 20) into an owned collection. Counts against your image-storage cap. |
| `add_hooks` | Add manual hooks (max 50) to a profile's hook library. |
| `remove_hook` | Permanently delete one hook from a profile's library (**irreversible**). |
| `update_profile` | Edit a profile's safe voice/CTA/hashtag/product fields. Preview shows a current → new diff. |
| `deliver_slideshow` | Re-post an already-generated slideshow to TikTok/Telegram — **no** AI call and **no** monthly quota spent. Uses a TikTok inbox slot. |
| `run_automation` | Run an automation now — **spends 1 slideshow + AI credits** and posts LIVE. Cannot be undone. |

---

## Configuration

| Env var | Required | Default | Notes |
|---|---|---|---|
| `SVMMON_API_KEY` | Yes | — | Your `svm_` key. Read from env only — never passed on the command line. |
| `SVMMON_BASE_URL` | No | `https://app.svmmonapp.com` | Override only for self-host/staging. |

---

## Troubleshooting

- **"key is missing, invalid, or revoked" (401)** — Set `SVMMON_API_KEY` to a current key from Settings → API Keys.
- **"requires an active subscription" (403)** — Subscribe at app.svmmonapp.com/subscribe. Any active paid plan works.
- **"a usage cap was reached" (402)** — You hit your monthly slideshow or AI-credit cap. Run `get_usage`.
- **"Rate limited" (429)** — Wait the suggested time if one is shown; otherwise it's a daily AI limit that resets at midnight UTC. The message tells you which.

---

## Versioning

`1.x` targets the Svmmon `/api/v1` contract. A breaking API change (`/api/v2`) would ship as `2.x`.

## Security

This package handles a live, cost-bearing credential. It reads the key from the environment only, never logs it, never puts it in process arguments, and never echoes it in errors. It performs no auto-retries on cost-burning calls. Report security issues to support@svmmonapp.com.

## License

MIT
