# @prompteden/mcp-server

Stdio [Model Context Protocol](https://modelcontextprotocol.io) server for the PromptEden API. It exposes account, project, monitor, content, newsroom, and analytics tools. The published package is a single file, `dist/index.mjs`, and runs on Node.js 20 or newer.

```bash
npx -y @prompteden/mcp-server
```

## Install and configure

Set `PROMPTEDEN_API_KEY` to a PromptEden API key. `PROMPTEDEN_BASE_URL` is optional and defaults to `https://app.prompteden.com`.

No key yet? Start the server and call `agent_sign_up`. It works without `PROMPTEDEN_API_KEY`. The tool posts to `POST /api/v1/agent/sign-up` and returns the response, including `apiKey` when the API sends one. Set that value as `PROMPTEDEN_API_KEY`, then call the other tools.

A key from `agent_sign_up` is not checked against the account plan. This package does not read a plan, wait for API access, or block the new key until a plan that includes API access is active. The next tool call sends that key as a bearer token. If the API rejects it, the call comes back as a tool error.

For an existing account, create a scoped key in Settings > API Keys. `agent_sign_in` is compatibility-only for a case where a person explicitly supplied credentials.

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
| `PROMPTEDEN_API_KEY` | For every tool except `agent_sign_up` and `agent_sign_in` | PromptEden API key. The server reads it from the environment and does not write it to disk. |
| `PROMPTEDEN_BASE_URL` | No | API origin. Defaults to `https://app.prompteden.com`. |

## Tools

Names and descriptions below are generated from the server's `tools/list` response (`node scripts/tools-table.mjs`).

<!-- tools:start -->
This build registers 38 tools. Analytics tools are included (11): `analytics_get_property`, `analytics_get_verification`, `analytics_get_traffic`, `analytics_get_overview`, `analytics_list_goals`, `analytics_create_goal`, `analytics_archive_goal`, `analytics_add_property_host`, `analytics_create_property`, `analytics_rotate_key`, `analytics_verify_property`.

| Tool | Description |
| --- | --- |
| `get_account` | Get PromptEden team, plan, and usage details via GET /api/v1/account. |
| `list_monitors` | List PromptEden monitors for the authenticated team via GET /api/v1/monitors. |
| `get_results` | Get monitor results by monitor UUID via GET /api/v1/monitors/:monitorId/results. |
| `list_providers` | List the AI/agent providers available for monitors (search engines + agent coding harnesses), with key/name/category/costTier. Use the key when creating a monitor target. Requires monitors:read. |
| `list_projects` | List projects via GET /api/v1/projects. |
| `get_project` | Get a single project by id, UUID, or slug via GET /api/v1/projects/:projectId. |
| `content_list_topics` | List content topics for a project via GET /api/v1/content/topics. Supply projectId or projectUuid (at least one). Requires content:read scope. |
| `content_list_articles` | List generated content articles for a project via GET /api/v1/content/articles. Supply projectId or projectUuid (at least one). Requires content:read scope. |
| `content_get_article` | Get a single content article by id or UUID via GET /api/v1/content/articles/:articleId. Article generation is ASYNC: after content_generate_article returns, poll this tool and read the `status` field (and the `job` object: { step, status, attempt, error }) until generation completes before approving or publishing. Requires content:read scope. |
| `newsroom_setup_get` | Get a newsroom setup by numeric id or UUID, or omit setupId and supply a projectId, projectSlug, or projectUuid to get that project's latest durable setup run. The setup contains the researched, reviewable writers/beats/cadence/cost plan. Requires content:read scope. |
| `preview_displacement_scan` | Evaluate the deterministic displacement-scan preview fixture (no args) or a supplied strict payload. Read-only evaluation; nothing is persisted. |
| `agent_status` | Get the authenticated agent/key status via GET /api/v1/agent/status. Requires account:read scope. |
| `check_approval` | Check the status and execution result for a hosted approval returned by an approval_required write proposal. |
| `analytics_get_property` | Get the analytics property for a project via GET /api/v1/analytics/property: hostname, property state, collector state (six-state enum: not_set_up, awaiting_first_collection, healthy_zero, healthy_data, stale, failed) and the latest verification run. Never returns the site key. 409 property_scope_ambiguous if the project has more than one property. |
| `analytics_get_verification` | Poll the latest snippet verification run for a project's analytics property via GET /api/v1/analytics/property/verification. Read-only: never starts or retries a run. Statuses: queued, running, succeeded, failed, expired; checks cover script load and collector endpoint. |
| `analytics_get_traffic` | Get the AI-referral Traffic report via GET /api/v1/analytics/traffic: totals, per-engine series, landing pages, channel split, evidence provenance and sampling flags. HONESTY: `totals: null` means the collector has no basis to report (check collector.state) — it is NOT zero traffic; only healthy_zero/healthy_data collector states carry real numbers. Modeled influence is excluded. |
| `analytics_get_overview` | Get the GA Overview via GET /api/v1/analytics/overview: visits · AI visits · goal completions chain, top engines and landing pages, goals summary, instrumentation card, six-state collector + freshness. HONESTY: `totals: null` means the collector has no basis to report (check collector.state) — NOT zero; `totals.goalCompletions: null` and `goals.configured: false` mean goals are not set up, which is different from a configured goal with zero completions. |
| `analytics_list_goals` | List destination-URL goals via GET /api/v1/analytics/goals: per-goal completions and per-source split, with the attribution disclosure (within-visit model, one completion per goal per visit, prospective counting from goal creation). Goal names are customer-authored data; use the stable numeric id to act on a goal. |
| `analytics_create_goal` | Create a destination-URL goal via POST /api/v1/analytics/goals. The destination is a PATH starting with '/' (e.g. /thanks) — absolute URLs are rejected with invalid_goal; the goal always belongs to the property's own hostname. Counting is prospective from creation (within-visit attribution), no history backfill. 409 goal_exists on a duplicate destination; 409 property_not_set_up when the project has no analytics property yet. |
| `analytics_archive_goal` | Archive a goal via DELETE /api/v1/analytics/goals/:goalId. Archival preserves history (state becomes 'archived'); it does not delete data. Idempotent by state. |
| `analytics_add_property_host` | Add a public collection hostname via PATCH /api/v1/analytics/property. Target by propertyId alone. Keeps the canonical host and site key. Hosted MCP requires approval. |
| `analytics_create_property` | Create the analytics property for a project via POST /api/v1/analytics/property and receive the site key for the tracking snippet. The siteKey field in the result is shown EXACTLY ONCE — install it immediately; it cannot be re-read (recovery: analytics_rotate_key mints a fresh one). 409 property_exists (with propertyId) if the project already has a property. Disabled on the hosted endpoint. |
| `analytics_rotate_key` | Rotate a property's ingest site key via POST /api/v1/analytics/property/key/rotate. Target with propertyId ALONE (primary), or a project reference plus expectedPropertyId (409 analytics_property_changed on mismatch). The new siteKey is shown EXACTLY ONCE; the old key keeps working through overlapExpiresAt. NOT idempotent and never auto-retried: a manual retry performs a fresh rotation (safe — install the latest returned key). Disabled on the hosted endpoint. |
| `analytics_verify_property` | Start a live verification run for a project's analytics property via POST /api/v1/analytics/property/verification (202). The run checks script load and collector endpoint asynchronously; poll analytics_get_verification for the outcome. Never fabricate a pass/fail — report the run's actual status. 429 with retryAt when retried too soon. |
| `create_monitor` | Create a PromptEden monitor via POST /api/v1/monitors. Requires projectSlug or projectId. Defaults: type='search', language='en', country='US' (applied by the shared client). |
| `create_project` | Create a project via POST /api/v1/projects. |
| `content_create_topic` | Create a content topic via POST /api/v1/content/topics. Requires content:write scope. |
| `content_update_topic` | Update a content topic review state via PATCH /api/v1/content/topics/:topicId. status is one of approved \| rejected \| archived \| suggested; rejectedReason is optional. Idempotent. Requires content:write scope. |
| `content_generate_article` | Generate a content article from a topic via POST /api/v1/content/articles. Generation is ASYNC — this returns immediately; poll content_get_article and read its `status`/`job` fields until it completes. Requires content:write scope. |
| `content_update_article` | Update a content article review state via PATCH /api/v1/content/articles/:articleId. status is one of approved \| draft \| archived. NOTE: publishing is a separate tool (content_publish_article), not a status. Idempotent. Requires content:write scope. |
| `content_publish_article` | Publish an approved content article via POST /api/v1/content/articles/:articleId/publish. Requires content:write scope. |
| `article_fix` | Surgically repair an article from its stored validation findings via POST /api/v1/content/articles/:articleId/fix. The repair is asynchronous and does not publish the article. Requires content:write scope. |
| `article_regenerate` | Regenerate an article with optional editor feedback via POST /api/v1/content/articles/:articleId/regenerate. Generation is asynchronous. Requires content:write scope. |
| `newsroom_setup_propose` | Start a durable agentic run that researches a goal and drafts a reviewable newsroom plan covering writers, beats, cadence, and cost. Nothing is hired until newsroom_setup_apply. Requires one project reference and content:write scope; newsroom_setup_in_flight is a 409. |
| `newsroom_setup_apply` | Hire selected writers from a ready newsroom plan, or omit writerIndexes to hire the full plan. Nothing is created before this call. Requires content:write scope; in-flight, not-applicable, and seat-upgrade errors are returned as newsroom_setup_* API errors. |
| `newsroom_setup_dismiss` | Dismiss a ready or failed newsroom setup without hiring its writers. Requires content:write scope. |
| `agent_sign_up` | Mint a PromptEden API key for a new agent. Works without PROMPTEDEN_API_KEY. Returns the new apiKey — set it as PROMPTEDEN_API_KEY to use every other tool. |
| `agent_sign_in` | Compatibility-only: mint a PromptEden API key for an existing account when the human explicitly provided credentials. For an existing account, do not ask for a password; use Settings > API Keys or hosted OAuth instead. |
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
