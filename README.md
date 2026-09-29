# @prompteden/mcp-server

**Track your brand in AI answers from your own agent**

MCP server that lets Claude, Codex, Cursor and other MCP clients read your PromptEden data: projects, monitors, captured answers, and analytics.

PromptEden checks how AI answers talk about your business. Answer engines come from the live provider catalog (`list_providers`); a monitor target uses one of those provider keys. Coding-agent providers are omitted. This MCP server gives your own agent that data, so you can ask about it in Claude, Codex, Cursor, or any other MCP client you already use.

Your agent can list projects and monitors, pull captured answers (`get_results` returns the API JSON and accepts a `since` date), set up a new project or monitor, and check your plan and usage. This server does not add citation or competitor fields of its own. Creating a monitor starts recurring metered runs and uses credits. Other tools do not use credits. If you have the PromptEden analytics snippet on your site, the agent can also read visits that came from AI engines, set up goals, and check that the snippet is working. Read tools are marked read-only, and every write tool is marked non-destructive.

The server runs locally over stdio on Node 20 or later. Create an account on the web, then pass an API key from Settings > API Keys as `PROMPTEDEN_API_KEY`. The server does not store your key. `PROMPTEDEN_BASE_URL` is optional and, when set, must be `https://app.prompteden.com`.

```bash
npx -y @prompteden/mcp-server
```

The published package is a single file, `dist/index.mjs`.

## Example prompts

1. Using PromptEden, fetch each monitor's results from the last 7 days and summarize the captured answers, including any competitor or cited-source fields the result JSON actually contains.
2. Create a PromptEden project for mysite.com, then add a monitor that runs once a day. Call `list_providers` and target two engines from that catalog with a prompt asking which local bakeries they would recommend.
3. How many visits did my site get from AI engines last week, and which pages did they land on?

## Install and configure

Create an account on the web, then set `PROMPTEDEN_API_KEY` to an API key from Settings > API Keys. The server reads that key from the environment and does not write it to disk. `PROMPTEDEN_BASE_URL` is optional. When it is set, the only allowed origin is `https://app.prompteden.com`. Any other origin is rejected.

### Claude Desktop

Add this to the Claude Desktop MCP config (`claude_desktop_config.json`):

```json
{
  "mcpServers": {
    "prompteden": {
      "command": "npx",
      "args": ["-y", "@prompteden/mcp-server"],
      "env": {
        "PROMPTEDEN_API_KEY": "YOUR_PROMPTEDEN_API_KEY"
      }
    }
  }
}
```

### Cursor

Add the same `mcpServers` entry to Cursor's MCP config (`.cursor/mcp.json` or Cursor Settings > MCP):

```json
{
  "mcpServers": {
    "prompteden": {
      "command": "npx",
      "args": ["-y", "@prompteden/mcp-server"],
      "env": {
        "PROMPTEDEN_API_KEY": "YOUR_PROMPTEDEN_API_KEY"
      }
    }
  }
}
```

### Generic `mcpServers` JSON

```json
{
  "mcpServers": {
    "prompteden": {
      "command": "npx",
      "args": ["-y", "@prompteden/mcp-server"],
      "env": {
        "PROMPTEDEN_API_KEY": "YOUR_PROMPTEDEN_API_KEY",
        "PROMPTEDEN_BASE_URL": "https://app.prompteden.com"
      }
    }
  }
}
```

`PROMPTEDEN_BASE_URL` can be omitted.

## Environment variables

| Variable | Required | Description |
| --- | --- | --- |
| `PROMPTEDEN_API_KEY` | Yes | PromptEden API key from Settings > API Keys. The server reads it from the environment and does not write it to disk. |
| `PROMPTEDEN_BASE_URL` | No | API origin. Defaults to `https://app.prompteden.com`. Any other origin is rejected. |

## Tools

Names and descriptions below are generated from the server's `tools/list` response (`node scripts/tools-table.mjs`).

<!-- tools:start -->
This build registers 20 tools. Analytics tools are included (11): `analytics_get_property`, `analytics_get_verification`, `analytics_get_traffic`, `analytics_get_overview`, `analytics_list_goals`, `analytics_create_goal`, `analytics_archive_goal`, `analytics_add_property_host`, `analytics_create_property`, `analytics_rotate_key`, `analytics_verify_property`.

| Tool | Description |
| --- | --- |
| `get_account` | Get PromptEden team, plan, and usage details via GET /api/v1/account. Does not use credits. |
| `list_monitors` | List PromptEden monitors for the authenticated team via GET /api/v1/monitors. Does not use credits. |
| `get_results` | Get monitor results by monitor UUID via GET /api/v1/monitors/:monitorId/results. Does not use credits. |
| `list_providers` | List the answer engines available for monitors, with key, name, category, and costTier. Coding-agent providers are omitted. Use a returned key when creating a monitor target. Does not use credits. |
| `list_projects` | List projects via GET /api/v1/projects. Does not use credits. |
| `get_project` | Get a single project by id, UUID, or slug via GET /api/v1/projects/:projectId. Does not use credits. |
| `agent_status` | Get the authenticated agent/key status via GET /api/v1/agent/status. Requires account:read scope. Does not use credits. |
| `analytics_get_property` | Get the analytics property for a project via GET /api/v1/analytics/property: hostname, property state, collector state (six-state enum: not_set_up, awaiting_first_collection, healthy_zero, healthy_data, stale, failed) and the latest verification run. Never returns the site key. 409 property_scope_ambiguous if the project has more than one property. Does not use credits. |
| `analytics_get_verification` | Poll the latest snippet verification run for a project's analytics property via GET /api/v1/analytics/property/verification. Read-only: never starts or retries a run. Statuses: queued, running, succeeded, failed, expired; checks cover script load and collector endpoint. Does not use credits. |
| `analytics_get_traffic` | Get the AI-referral Traffic report via GET /api/v1/analytics/traffic: totals, per-engine series, landing pages, channel split, evidence provenance and sampling flags. HONESTY: `totals: null` means the collector has no basis to report (check collector.state) — it is NOT zero traffic; only healthy_zero/healthy_data collector states carry real numbers. Modeled influence is excluded. Does not use credits. |
| `analytics_get_overview` | Get the GA Overview via GET /api/v1/analytics/overview: visits · AI visits · goal completions chain, top engines and landing pages, goals summary, instrumentation card, six-state collector + freshness. HONESTY: `totals: null` means the collector has no basis to report (check collector.state) — NOT zero; `totals.goalCompletions: null` and `goals.configured: false` mean goals are not set up, which is different from a configured goal with zero completions. Does not use credits. |
| `analytics_list_goals` | List destination-URL goals via GET /api/v1/analytics/goals: per-goal completions and per-source split, with the attribution disclosure (within-visit model, one completion per goal per visit, prospective counting from goal creation). Goal names are customer-authored data; use the stable numeric id to act on a goal. Does not use credits. |
| `analytics_create_goal` | Create a destination-URL goal via POST /api/v1/analytics/goals. The destination is a PATH starting with '/' (e.g. /thanks) — absolute URLs are rejected with invalid_goal; the goal always belongs to the property's own hostname. Counting is prospective from creation (within-visit attribution), no history backfill. 409 goal_exists on a duplicate destination; 409 property_not_set_up when the project has no analytics property yet. Does not use credits. |
| `analytics_archive_goal` | Archive a goal via DELETE /api/v1/analytics/goals/:goalId. Archival preserves history (state becomes 'archived'); it does not delete data. Idempotent by state. Does not use credits. |
| `analytics_add_property_host` | Add a public collection hostname via PATCH /api/v1/analytics/property. Target by propertyId alone. Keeps the canonical host and site key. Does not use credits. |
| `analytics_create_property` | Create the analytics property for a project via POST /api/v1/analytics/property and receive the site key for the tracking snippet. The siteKey field in the result is shown EXACTLY ONCE — install it immediately; it cannot be re-read (recovery: analytics_rotate_key mints a fresh one). 409 property_exists (with propertyId) if the project already has a property. Does not use credits. |
| `analytics_rotate_key` | Rotate a property's ingest site key via POST /api/v1/analytics/property/key/rotate. Target with propertyId ALONE (primary), or a project reference plus expectedPropertyId (409 analytics_property_changed on mismatch). The new siteKey is shown EXACTLY ONCE; the old key keeps working through overlapExpiresAt. NOT idempotent and never auto-retried: a manual retry performs a fresh rotation (safe — install the latest returned key). Does not use credits. |
| `analytics_verify_property` | Start a live verification run for a project's analytics property via POST /api/v1/analytics/property/verification (202). The run checks script load and collector endpoint asynchronously; poll analytics_get_verification for the outcome. Never fabricate a pass/fail — report the run's actual status. 429 with retryAt when retried too soon. Does not use credits. |
| `create_monitor` | Create a PromptEden monitor via POST /api/v1/monitors. Requires projectSlug or projectId. Defaults: type='search', language='en', country='US' (applied by the shared client). Coding-agent provider keys are rejected. This starts recurring metered runs and uses credits. |
| `create_project` | Create a project via POST /api/v1/projects. Does not use credits. |
<!-- tools:end -->

## Security

- The API key stays in the environment. This process does not persist it, and tool results are checked so the configured key is not echoed back.
- Do not commit an API key, put one in a shell history you share, or paste one into a client config that is checked in.
- Prefer a scoped key from Settings > API Keys over sharing an account password with an agent.
- `analytics_get_traffic` and `analytics_get_overview` use `totals: null` to mean "no basis to report". That is not zero traffic.
- The site key from create or rotate is shown once. Treat it like a secret and do not store it in chat logs you keep.

## Development

```bash
npm ci
npm run typecheck
npm run build
npm run mcpb
npm test
node dist/index.mjs --help
node smoke.mjs
npm pack --dry-run
```

`npm run build` typechecks, then bundles the MCP SDK, API client, and tool registry into `dist/index.mjs`. `npm run mcpb` packs that file into `build/prompteden-mcp-<version>.mcpb` (manifest version 0.3). The npm tarball does not include the `.mcpb` file. CI uploads it as a workflow artifact.

## License

MIT. Copyright (c) 2026 Yulan Ventures LLC.
