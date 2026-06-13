# svmmon-mcp

Generate TikTok slideshows from Claude (and any MCP client) using your [Svmmon](https://app.svmmonapp.com) account.

This is a thin, local **stdio MCP server** that wraps Svmmon's public `/api/v1` REST API. Install it, paste your key, and ask Claude to make slideshows in plain language. It adds no business logic — every tool maps 1:1 onto a real Svmmon endpoint.

> **Requires a Growth plan or higher.** The API is gated to Growth+ accounts. Install always works; the tools return a clean "needs Growth+" message until you paste a valid paid key.

---

## Quickstart

### 1. Get your key

app.svmmonapp.com → **Settings → API Keys → Svmmon API → Generate key** (Growth plan or higher). It looks like `svm_xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx`.

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
| `get_usage` | Tier, slideshows used/cap, reset date, per-account TikTok inbox slots. |
| `list_profiles` | Your profiles with `id`, `name`, `niche`, `ready`, `missing`, `tiktok_linked`. Only `ready` profiles can generate. |
| `list_presets` | Valid `preset_id` values for slideshow generation. |
| `generate_hooks` | Scored hook candidates for a profile. May return fewer than requested if your AI-credit cap is hit. |
| `generate_slideshow` | Generates ONE slideshow (consumes one from your monthly cap — **not idempotent**). Returns a 24h download link; optionally delivers to TikTok/Telegram. |
| `list_slideshows` | Your recent slideshows. |
| `get_slideshow` | Fetch a slideshow + a fresh 1h download link by id. |

---

## Configuration

| Env var | Required | Default | Notes |
|---|---|---|---|
| `SVMMON_API_KEY` | Yes | — | Your `svm_` key. Read from env only — never passed on the command line. |
| `SVMMON_BASE_URL` | No | `https://app.svmmonapp.com` | Override only for self-host/staging. |

---

## Troubleshooting

- **"key is missing, invalid, or revoked" (401)** — Set `SVMMON_API_KEY` to a current key from Settings → API Keys.
- **"needs a Growth plan or higher" (403)** — Upgrade at app.svmmonapp.com/subscribe.
- **"a usage cap was reached" (402)** — You hit your monthly slideshow or AI-credit cap. Run `get_usage`.
- **"Rate limited" (429)** — Wait the suggested time if one is shown; otherwise it's a daily AI limit that resets at midnight UTC. The message tells you which.

---

## Versioning

`1.x` targets the Svmmon `/api/v1` contract. A breaking API change (`/api/v2`) would ship as `2.x`.

## Security

This package handles a live, cost-bearing credential. It reads the key from the environment only, never logs it, never puts it in process arguments, and never echoes it in errors. It performs no auto-retries on cost-burning calls. Report security issues to support@svmmonapp.com.

## License

MIT
