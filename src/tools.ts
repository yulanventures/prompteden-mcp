/**
 * PromptEden MCP tool registry for the stdio server.
 */

import { AsyncLocalStorage } from "node:async_hooks";

import { z } from "zod";

import {
  createProjectSchema,
  addAnalyticsPropertyHostSchema,
  createClient,
  type PromptEdenClient,
  type CreateMonitorInput,
  type CreateProjectInput,
} from "./api-client/index.js";
import {
  unavailableMonitorProviderKeys,
  visibleMonitorProviders,
} from "./monitor-providers.js";

export const DEFAULT_BASE_URL = "https://app.prompteden.com";

// Kept in sync with package.json "version"; the smoke test asserts this matches
// the published package version so the two never drift.
export const SERVER_VERSION = "0.3.0";

export const SERVER_INSTRUCTIONS =
  "PromptEden MCP server. Exposes tools for accounts, projects, monitors, monitor results, " +
  "and site analytics. Create an account on the web, then set PROMPTEDEN_API_KEY to an API key " +
  "from Settings > API Keys. The server does not store the key. PROMPTEDEN_BASE_URL, when set, " +
  "must be https://app.prompteden.com. Every tool requires that API key. Tool-execution failures " +
  "(API errors, missing key, invalid input) come back as tool results with isError:true, not protocol errors.";

// An identifier path/query param that the REST API accepts as either a numeric
// id or its string form (UUIDs and numeric strings both flow through).
const idSchema = z.union([z.number(), z.string().min(1)]);

export const PROMPTEDEN_MCP_TOOL_SCOPES = {
  get_account: ["account:read"],
  list_monitors: ["monitors:read"],
  get_results: ["results:read"],
  list_providers: ["providers:read"],
  list_projects: ["projects:read"],
  get_project: ["projects:read"],
  agent_status: ["account:read"],
  analytics_get_property: ["analytics:read"],
  analytics_get_verification: ["analytics:read"],
  analytics_get_traffic: ["analytics:read"],
  analytics_get_overview: ["analytics:read"],
  analytics_list_goals: ["analytics:read"],
  create_monitor: ["monitors:write"],
  create_project: ["projects:write"],
  analytics_create_property: ["analytics:write"],
  analytics_add_property_host: ["analytics:write"],
  analytics_rotate_key: ["analytics:write"],
  analytics_verify_property: ["analytics:write"],
  analytics_create_goal: ["analytics:write"],
  analytics_archive_goal: ["analytics:write"],
} as const;

export type PromptEdenMcpToolName = keyof typeof PROMPTEDEN_MCP_TOOL_SCOPES;

export const PROMPTEDEN_MCP_TOOL_DEFINITIONS: readonly PromptEdenMcpToolDefinition[] =
  [
    {
      name: "get_account",
      requiredScopes: PROMPTEDEN_MCP_TOOL_SCOPES.get_account,
      readOnly: true,
    },
    {
      name: "list_monitors",
      requiredScopes: PROMPTEDEN_MCP_TOOL_SCOPES.list_monitors,
      readOnly: true,
    },
    {
      name: "get_results",
      requiredScopes: PROMPTEDEN_MCP_TOOL_SCOPES.get_results,
      readOnly: true,
    },
    {
      name: "list_providers",
      requiredScopes: PROMPTEDEN_MCP_TOOL_SCOPES.list_providers,
      readOnly: true,
    },
    {
      name: "list_projects",
      requiredScopes: PROMPTEDEN_MCP_TOOL_SCOPES.list_projects,
      readOnly: true,
    },
    {
      name: "get_project",
      requiredScopes: PROMPTEDEN_MCP_TOOL_SCOPES.get_project,
      readOnly: true,
    },
    {
      name: "agent_status",
      requiredScopes: PROMPTEDEN_MCP_TOOL_SCOPES.agent_status,
      readOnly: true,
    },
    {
      name: "analytics_get_property",
      requiredScopes: PROMPTEDEN_MCP_TOOL_SCOPES.analytics_get_property,
      readOnly: true,
    },
    {
      name: "analytics_get_verification",
      requiredScopes: PROMPTEDEN_MCP_TOOL_SCOPES.analytics_get_verification,
      readOnly: true,
    },
    {
      name: "analytics_get_traffic",
      requiredScopes: PROMPTEDEN_MCP_TOOL_SCOPES.analytics_get_traffic,
      readOnly: true,
    },
    {
      name: "analytics_get_overview",
      requiredScopes: PROMPTEDEN_MCP_TOOL_SCOPES.analytics_get_overview,
      readOnly: true,
    },
    {
      name: "analytics_list_goals",
      requiredScopes: PROMPTEDEN_MCP_TOOL_SCOPES.analytics_list_goals,
      readOnly: true,
    },
    {
      name: "create_monitor",
      requiredScopes: PROMPTEDEN_MCP_TOOL_SCOPES.create_monitor,
      readOnly: false,
    },
    {
      name: "create_project",
      requiredScopes: PROMPTEDEN_MCP_TOOL_SCOPES.create_project,
      readOnly: false,
    },
    {
      name: "analytics_add_property_host",
      requiredScopes: PROMPTEDEN_MCP_TOOL_SCOPES.analytics_add_property_host,
      readOnly: false,
    },
    {
      name: "analytics_create_property",
      requiredScopes: PROMPTEDEN_MCP_TOOL_SCOPES.analytics_create_property,
      readOnly: false,
    },
    {
      name: "analytics_rotate_key",
      requiredScopes: PROMPTEDEN_MCP_TOOL_SCOPES.analytics_rotate_key,
      readOnly: false,
    },
    {
      name: "analytics_verify_property",
      requiredScopes: PROMPTEDEN_MCP_TOOL_SCOPES.analytics_verify_property,
      readOnly: false,
    },
    {
      name: "analytics_create_goal",
      requiredScopes: PROMPTEDEN_MCP_TOOL_SCOPES.analytics_create_goal,
      readOnly: false,
    },
    {
      name: "analytics_archive_goal",
      requiredScopes: PROMPTEDEN_MCP_TOOL_SCOPES.analytics_archive_goal,
      readOnly: false,
    },
  ];

export function getPromptEdenMcpToolRequiredScopes(
  toolName: string,
): readonly string[] {
  return PROMPTEDEN_MCP_TOOL_SCOPES[toolName as PromptEdenMcpToolName] ?? [];
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

// A plain text content block carrying the pretty-printed JSON payload. Every
// tool returns at least this; stable read tools additionally attach
// structuredContent validated against an outputSchema.
function textResult(payload: unknown): {
  content: { type: "text"; text: string }[];
} {
  return {
    content: [{ type: "text", text: JSON.stringify(payload, null, 2) }],
  };
}

/**
 * Traffic, overview, and goal-list results carry `aiTrafficAvailable` in the
 * JSON body and in MCP `_meta`. `false` means withheld / not measured,
 * including goal-source attribution, not a measured zero.
 */
function analyticsSurfaceResult(payload: unknown): PromptEdenMcpToolResult {
  const aiTrafficAvailable =
    isRecord(payload) && payload.aiTrafficAvailable === true;
  return {
    ...textResult(payload),
    _meta: {
      aiTrafficAvailable,
      aiTraffic: aiTrafficAvailable ? "measured" : "withheld_not_measured",
    },
  };
}

// For tools that declare an outputSchema, the SDK requires structuredContent on
// a non-error result and validates it. API responses are objects; wrap any
// non-object body so the contract still holds.
function structuredResult(payload: unknown): {
  content: { type: "text"; text: string }[];
  structuredContent: Record<string, unknown>;
} {
  return {
    content: [{ type: "text", text: JSON.stringify(payload, null, 2) }],
    structuredContent: isRecord(payload) ? payload : { value: payload },
  };
}

// A non-generic facade over server.registerTool. The SDK's registerTool is
// heavily generic: it infers the handler's argument type from the inputSchema
// via ShapeOutput/SchemaOutput conditional types. Instantiating those over
// zod's recursive `infer` types — across every tool, with rich shapes (arrays
// of objects, records, unions) — makes tsc consume >8 GB and OOM. None of that
// inference buys us anything at runtime: the SDK still validates arguments
// against the real inputSchema (the live zod object passed in `config`) and
// coerces/defaults them before the handler runs, so `args` is already the
// validated shape. We erase the compile-time generics here and read fields off
// a loosely-typed record; runtime behaviour is identical.
type ToolConfig = {
  title: string;
  description: string;
  inputSchema?: unknown;
  outputSchema?: unknown;
  annotations?: {
    readOnlyHint?: boolean;
    destructiveHint?: boolean;
    idempotentHint?: boolean;
    openWorldHint?: boolean;
  };
};

export type PromptEdenMcpToolResult = {
  content: { type: "text"; text: string }[];
  structuredContent?: Record<string, unknown>;
  isError?: boolean;
  _meta?: Record<string, unknown>;
};

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type ToolArgs = Record<string, any>;

export type PromptEdenMcpToolExtra = {
  authInfo?: { token: string; extra?: Record<string, unknown> };
  requestInfo?: { url?: URL };
};

const toolExtraStorage = new AsyncLocalStorage<
  PromptEdenMcpToolExtra | undefined
>();

export type PromptEdenClientProvider = (
  extra: PromptEdenMcpToolExtra | undefined,
) => PromptEdenClient;

export type PromptEdenMcpToolDefinition = {
  name: PromptEdenMcpToolName;
  requiredScopes: readonly string[];
  readOnly: boolean;
};

export type RegisterPromptEdenToolsOptions = {
  getClient?: PromptEdenClientProvider;
};

export function createEnvPromptEdenClientProvider(): PromptEdenClientProvider {
  let cachedClient: PromptEdenClient | undefined;

  return () => {
    if (!cachedClient) {
      cachedClient = createClient({
        baseUrl: process.env.PROMPTEDEN_BASE_URL ?? DEFAULT_BASE_URL,
        apiKey: process.env.PROMPTEDEN_API_KEY,
      });
    }
    return cachedClient;
  };
}

type ToolRegistrar = {
  registerTool: unknown;
};

function creditNote(name: string): string {
  if (name === "create_monitor") {
    return " This starts recurring metered runs and uses credits.";
  }
  return " Does not use credits.";
}

function createRegisterTool(
  server: ToolRegistrar,
): (
  name: string,
  config: ToolConfig,
  handler: (args: ToolArgs) => Promise<PromptEdenMcpToolResult>,
) => void {
  return (name, config, handler) => {
    const advertised = {
      ...config,
      description: config.description.includes("uses credits")
        ? config.description
        : `${config.description}${creditNote(name)}`,
    };
    const wrapped = async (
      args: ToolArgs,
      extra: PromptEdenMcpToolExtra | undefined,
    ) => toolExtraStorage.run(extra, async () => handler(args));

    (
      server.registerTool as unknown as (
        n: string,
        c: unknown,
        h: unknown,
      ) => unknown
    )(name, advertised, wrapped);
  };
}

export function registerPromptEdenTools(
  server: ToolRegistrar,
  options: RegisterPromptEdenToolsOptions = {},
): void {
  const clientProvider =
    options.getClient ?? createEnvPromptEdenClientProvider();
  const getClient = () => clientProvider(toolExtraStorage.getStore());
  const registerTool = createRegisterTool(server);

  // ---------------------------------------------------------------------------
  // Read tools (GET). readOnlyHint:true, idempotentHint:true. The three most
  // stable shapes (account, monitors, agent status) additionally declare an
  // outputSchema + return structuredContent.
  // ---------------------------------------------------------------------------

  registerTool(
    "get_account",
    {
      title: "Get account",
      description:
        "Get PromptEden team, plan, and usage details via GET /api/v1/account.",
      inputSchema: {},
      outputSchema: {
        team: z.unknown().optional(),
        plan: z.unknown().optional(),
        usage: z.unknown().optional(),
      },
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: true,
      },
    },
    async () => structuredResult(await getClient().account.get()),
  );

  registerTool(
    "list_monitors",
    {
      title: "List monitors",
      description:
        "List PromptEden monitors for the authenticated team via GET /api/v1/monitors.",
      inputSchema: {},
      outputSchema: {
        monitors: z.array(z.unknown()).optional(),
      },
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: true,
      },
    },
    async () => structuredResult(await getClient().monitors.list()),
  );

  registerTool(
    "get_results",
    {
      title: "Get monitor results",
      description:
        "Get monitor results by monitor UUID via GET /api/v1/monitors/:monitorId/results.",
      inputSchema: {
        monitorId: z.string().min(1).describe("Monitor UUID."),
        limit: z.number().optional().describe("Max results. API caps at 200."),
        offset: z.number().optional(),
        since: z.string().optional().describe("ISO date string."),
      },
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: true,
      },
    },
    async ({ monitorId, limit, offset, since }) => {
      // Order matters for the request-trace contract: limit, offset, since.
      const query: { limit?: number; offset?: number; since?: string } = {};
      if (limit !== undefined) query.limit = limit;
      if (offset !== undefined) query.offset = offset;
      if (since !== undefined) query.since = since;
      return textResult(await getClient().monitors.results(monitorId, query));
    },
  );

  registerTool(
    "list_providers",
    {
      title: "List monitor providers",
      description:
        "List the answer engines available for monitors, with key, name, category, and costTier. " +
        "Coding-agent providers are omitted. Use a returned key when creating a monitor target.",
      inputSchema: {},
      outputSchema: {
        // key/name are always present; the rest are tolerant (a future provider
        // could omit category/costTier), and .passthrough() admits the route's
        // additional fields (defaultModel, supportsRegion, displayOrder, enabled)
        // without failing structuredContent validation.
        providers: z.array(
          z
            .object({
              key: z.string(),
              name: z.string(),
              category: z.string().optional(),
              costTier: z.string().optional(),
              description: z.string().optional(),
            })
            .passthrough(),
        ),
      },
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: true,
      },
    },
    async () => {
      const payload = await getClient().providers.list();
      if (!isRecord(payload) || !Array.isArray(payload.providers)) {
        return structuredResult(payload);
      }
      return structuredResult({
        ...payload,
        providers: visibleMonitorProviders(payload.providers),
      });
    },
  );

  registerTool(
    "list_projects",
    {
      title: "List projects",
      description: "List projects via GET /api/v1/projects.",
      inputSchema: {},
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: true,
      },
    },
    async () => textResult(await getClient().projects.list()),
  );

  registerTool(
    "get_project",
    {
      title: "Get project",
      description:
        "Get a single project by id, UUID, or slug via GET /api/v1/projects/:projectId.",
      inputSchema: {
        projectId: idSchema.describe("Project id, UUID, or slug."),
      },
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: true,
      },
    },
    async ({ projectId }) =>
      textResult(await getClient().projects.get(projectId)),
  );


  registerTool(
    "agent_status",
    {
      title: "Agent status",
      description:
        "Get the authenticated agent/key status via GET /api/v1/agent/status. Requires account:read scope.",
      inputSchema: {},
      outputSchema: {
        status: z.string().optional(),
        agentName: z.string().optional(),
      },
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: true,
      },
    },
    async () => structuredResult(await getClient().agent.status()),
  );


  // ---------------------------------------------------------------------------
  // Analytics agent surface. Honesty contract: the collector state enum has
  // exactly six values (not_set_up | awaiting_first_collection | healthy_zero |
  // healthy_data | stale | failed) and passes through verbatim; `totals: null`
  // in the traffic report means "no basis to report" — never render it as
  // zeros. The raw siteKey appears ONLY in the create/rotate results, exactly
  // once, in a single field. The server does not store that key.
  // ---------------------------------------------------------------------------

  // Two unambiguous targeting shapes — pass EITHER propertyId alone OR one
  // project reference. Mixed identifiers are rejected with 400 (never
  // resolved by silent priority).
  const analyticsProjectInputSchema = {
    propertyId: z
      .number()
      .int()
      .positive()
      .optional()
      .describe(
        "Explicit analytics property id (primary target). Pass ALONE — combining with a project reference is rejected. When omitted, pass a project reference instead; that resolves only when the project has exactly one property (409 property_scope_ambiguous otherwise).",
      ),
    projectId: z.number().int().positive().optional().describe("Numeric project id (convenience shape; do not combine with propertyId)."),
    projectUuid: z.string().optional().describe("Project UUID (alternative to projectId)."),
  };

  // Create addresses a PROJECT (the property does not exist yet) — no
  // propertyId field, unlike the other analytics tools.
  const analyticsCreateInputSchema = {
    projectId: z.number().int().positive().optional().describe("Numeric project id."),
    projectUuid: z.string().optional().describe("Project UUID (alternative to projectId)."),
  };

  registerTool(
    "analytics_get_property",
    {
      title: "Get analytics property",
      description:
        "Get the analytics property for a project via GET /api/v1/analytics/property: hostname, property state, " +
        "collector state (six-state enum: not_set_up, awaiting_first_collection, healthy_zero, healthy_data, stale, failed) " +
        "and the latest verification run. Never returns the site key. " +
        "409 property_scope_ambiguous if the project has more than one property.",
      inputSchema: analyticsProjectInputSchema,
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: true,
      },
    },
    async ({ propertyId, projectId, projectUuid }) =>
      analyticsSurfaceResult(
        await getClient().analytics.property.get({
          propertyId,
          projectId,
          projectUuid,
        }),
      ),
  );

  registerTool(
    "analytics_get_verification",
    {
      title: "Get analytics verification status",
      description:
        "Poll the latest snippet verification run for a project's analytics property via " +
        "GET /api/v1/analytics/property/verification. Read-only: never starts or retries a run. " +
        "Statuses: queued, running, succeeded, failed, expired; checks cover script load and collector endpoint.",
      inputSchema: analyticsProjectInputSchema,
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: true,
      },
    },
    async ({ propertyId, projectId, projectUuid }) =>
      textResult(
        await getClient().analytics.verification.get({
          propertyId,
          projectId,
          projectUuid,
        }),
      ),
  );

  registerTool(
    "analytics_get_traffic",
    {
      title: "Get analytics traffic report",
      description:
        "Get the AI-referral Traffic report via GET /api/v1/analytics/traffic: totals, per-engine series, " +
        "landing pages, channel split, evidence provenance and sampling flags. HONESTY: `totals: null` means " +
        "the collector has no basis to report (check collector.state) — it is NOT zero traffic; only " +
        "healthy_zero/healthy_data collector states carry real numbers. Modeled influence is excluded.",
      inputSchema: {
        ...analyticsProjectInputSchema,
        range: z.number().int().min(1).max(180).optional().describe("Day count (default 30)."),
        from: z.string().optional().describe("ISO start date (alternative to range)."),
        to: z.string().optional().describe("ISO end date."),
        tz: z.string().optional().describe("IANA time zone for day bucketing."),
        engine: z.string().optional().describe("Filter to one AI engine id."),
        source: z.string().optional().describe("Filter to one source id."),
        evidence: z
          .enum(["observed", "provider_utm", "observed_referrer"])
          .optional()
          .describe("Evidence-rung filter."),
      },
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: true,
      },
    },
    async (args) =>
      analyticsSurfaceResult(await getClient().analytics.traffic.get(args)),
  );

  const analyticsRangeInputSchema = {
    range: z.number().int().min(1).max(180).optional().describe("Day count (default 30)."),
    from: z.string().optional().describe("ISO start date (alternative to range)."),
    to: z.string().optional().describe("ISO end date."),
    tz: z.string().optional().describe("IANA time zone for day bucketing."),
  };

  registerTool(
    "analytics_get_overview",
    {
      title: "Get analytics overview",
      description:
        "Get the GA Overview via GET /api/v1/analytics/overview: visits · AI visits · goal completions chain, " +
        "top engines and landing pages, goals summary, instrumentation card, six-state collector + freshness. " +
        "HONESTY: `totals: null` means the collector has no basis to report (check collector.state) — NOT zero; " +
        "`totals.goalCompletions: null` and `goals.configured: false` mean goals are not set up, which is different " +
        "from a configured goal with zero completions.",
      inputSchema: {
        ...analyticsProjectInputSchema,
        ...analyticsRangeInputSchema,
      },
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: true,
      },
    },
    async (args) =>
      analyticsSurfaceResult(await getClient().analytics.overview.get(args)),
  );

  registerTool(
    "analytics_list_goals",
    {
      title: "List analytics goals",
      description:
        "List destination-URL goals via GET /api/v1/analytics/goals: per-goal completions and per-source split, " +
        "with the attribution disclosure (within-visit model, one completion per goal per visit, prospective " +
        "counting from goal creation). Goal names are customer-authored data; use the stable numeric id to act on a goal.",
      inputSchema: {
        ...analyticsProjectInputSchema,
        ...analyticsRangeInputSchema,
      },
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: true,
      },
    },
    async (args) =>
      analyticsSurfaceResult(await getClient().analytics.goals.list(args)),
  );

  registerTool(
    "analytics_create_goal",
    {
      title: "Create analytics goal",
      description:
        "Create a destination-URL goal via POST /api/v1/analytics/goals. The destination is a PATH starting with " +
        "'/' (e.g. /thanks) — absolute URLs are rejected with invalid_goal; the goal always belongs to the " +
        "property's own hostname. Counting is prospective from creation (within-visit attribution), no history " +
        "backfill. 409 goal_exists on a duplicate destination; 409 property_not_set_up when the project has no " +
        "analytics property yet. This changes live tracking on the user's site.",
      inputSchema: {
        ...analyticsProjectInputSchema,
        name: z.string().min(1).max(80).describe("Goal display name."),
        destination: z
          .string()
          .min(1)
          .max(2048)
          .describe(
            "Destination path starting with '/', e.g. /thanks. Absolute URLs are rejected (path-only contract).",
          ),
      },
      annotations: {
        readOnlyHint: false,
        destructiveHint: false,
        idempotentHint: false,
        openWorldHint: true,
      },
    },
    async ({ propertyId, projectId, projectUuid, name, destination }) =>
      textResult(
        await getClient().analytics.goals.create({
          propertyId,
          projectId,
          projectUuid,
          name,
          destination,
        }),
      ),
  );

  registerTool(
    "analytics_archive_goal",
    {
      title: "Archive analytics goal",
      description:
        "Archive a goal via DELETE /api/v1/analytics/goals/:goalId. Archival preserves history (state becomes " +
        "'archived'); it does not delete data. Idempotent by state. This changes live tracking on the user's site.",
      inputSchema: {
        ...analyticsProjectInputSchema,
        goalId: z.number().int().positive().describe("Stable numeric goal id from analytics_list_goals."),
      },
      annotations: {
        readOnlyHint: false,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: true,
      },
    },
    async ({ goalId, propertyId, projectId, projectUuid }) =>
      textResult(
        await getClient().analytics.goals.archive(goalId, {
          propertyId,
          projectId,
          projectUuid,
        }),
      ),
  );

  registerTool(
    "analytics_add_property_host",
    {
      title: "Add analytics property host",
      description:
        "Add a public collection hostname via PATCH /api/v1/analytics/property. Target by propertyId alone. Keeps the canonical host and site key. This changes live tracking on the user's site.",
      inputSchema: addAnalyticsPropertyHostSchema.shape,
      annotations: {
        readOnlyHint: false,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: false,
      },
    },
    async (input) =>
      analyticsSurfaceResult(
        await getClient().analytics.property.addHost(
          addAnalyticsPropertyHostSchema.parse(input),
        ),
      ),
  );

  registerTool(
    "analytics_create_property",
    {
      title: "Create analytics property",
      description:
        "Create the analytics property for a project via POST /api/v1/analytics/property and receive the site key " +
        "for the tracking snippet. The siteKey field in the result is shown EXACTLY ONCE — install it immediately; " +
        "it cannot be re-read (recovery: analytics_rotate_key mints a fresh one). " +
        "409 property_exists (with propertyId) if the project already has a property.",
      inputSchema: {
        ...analyticsCreateInputSchema,
        hostname: z
          .string()
          .describe("Public website hostname, e.g. example.com."),
      },
      annotations: {
        readOnlyHint: false,
        destructiveHint: false,
        idempotentHint: false,
        openWorldHint: true,
      },
    },
    async ({ projectId, projectUuid, hostname }) =>
      textResult(
        await getClient().analytics.property.create({
          projectId,
          projectUuid,
          hostname,
        }),
      ),
  );

  registerTool(
    "analytics_rotate_key",
    {
      title: "Rotate analytics site key",
      description:
        "Rotate a property's ingest site key via POST /api/v1/analytics/property/key/rotate. Target with " +
        "propertyId ALONE (primary), or a project reference plus expectedPropertyId (409 analytics_property_changed " +
        "on mismatch). The new siteKey is shown EXACTLY ONCE; the old key keeps working through overlapExpiresAt. " +
        "NOT idempotent and never auto-retried: a manual retry performs a fresh rotation (safe — install the latest " +
        "returned key).",
      inputSchema: {
        ...analyticsProjectInputSchema,
        expectedPropertyId: z
          .number()
          .int()
          .positive()
          .optional()
          .describe(
            "Required with a project reference: the property id you believe is current. Omit when targeting by propertyId.",
          ),
      },
      annotations: {
        readOnlyHint: false,
        destructiveHint: false,
        idempotentHint: false,
        openWorldHint: true,
      },
    },
    async ({ propertyId, projectId, projectUuid, expectedPropertyId }) =>
      textResult(
        await getClient().analytics.property.rotateKey({
          propertyId,
          projectId,
          projectUuid,
          expectedPropertyId,
        }),
      ),
  );

  registerTool(
    "analytics_verify_property",
    {
      title: "Start analytics snippet verification",
      description:
        "Start a live verification run for a project's analytics property via POST " +
        "/api/v1/analytics/property/verification (202). The run checks script load and collector endpoint " +
        "asynchronously; poll analytics_get_verification for the outcome. Never fabricate a pass/fail — report " +
        "the run's actual status. 429 with retryAt when retried too soon. This starts an async live-site check.",
      inputSchema: analyticsProjectInputSchema,
      annotations: {
        readOnlyHint: false,
        destructiveHint: false,
        idempotentHint: false,
        openWorldHint: true,
      },
    },
    async ({ propertyId, projectId, projectUuid }) =>
      textResult(
        await getClient().analytics.verification.start({
          propertyId,
          projectId,
          projectUuid,
        }),
      ),
  );

  // ---------------------------------------------------------------------------
  // Write tools. Additive creates and review-state transitions — none of them
  // remove or overwrite prior data destructively, so destructiveHint:false.
  // Creates are non-idempotent (a retry mints a new resource); PATCH review-state
  // updates are idempotent. The shared zod schemas are reused as the advertised
  // inputSchema so the wire contract and the request body stay in lockstep.
  // ---------------------------------------------------------------------------

  registerTool(
    "create_monitor",
    {
      title: "Create monitor",
      description:
        "Create a PromptEden monitor via POST /api/v1/monitors. Requires projectSlug or projectId. " +
        "Defaults: type='search', language='en', country='US' (applied by the shared client). " +
        "Only provider keys present in the filtered list_providers catalog are accepted.",
      // create_monitor's shared schema is a refined object (projectSlug OR
      // projectId), which has no JSON-Schema representation; advertise the field
      // shape here and let the shared createMonitorSchema enforce the refinement
      // when the client serializes the request.
      inputSchema: {
        projectSlug: z
          .string()
          .min(1)
          .optional()
          .describe("Project slug. Required unless projectId is supplied."),
        projectId: z
          .number()
          .optional()
          .describe("Project id. Required unless projectSlug is supplied."),
        name: z.string().min(1),
        type: z
          .enum(["search", "api", "scrape"])
          .optional()
          .describe("Defaults to 'search'."),
        description: z.string().optional(),
        language: z.string().min(1).optional().describe("Defaults to 'en'."),
        country: z.string().min(1).optional().describe("Defaults to 'US'."),
        cadenceMinutes: z.number(),
        promptInstructions: z.string().min(1),
        targets: z
          .array(
            z.object({
              providerKey: z.string().min(1),
              model: z.string().min(1).optional(),
              displayName: z.string().min(1).optional(),
            }),
          )
          .min(1),
        settings: z.record(z.unknown()).optional(),
      },
      annotations: {
        readOnlyHint: false,
        destructiveHint: false,
        idempotentHint: false,
        openWorldHint: true,
      },
    },
    async (args) => {
      const targets = Array.isArray(args.targets) ? args.targets : [];
      const requested = targets.map((target) => String(target?.providerKey ?? ""));
      const payload = await getClient().providers.list();
      if (!isRecord(payload) || !Array.isArray(payload.providers)) {
        return {
          content: [
            {
              type: "text",
              text:
                "The provider catalog did not return a provider list, so the monitor was not created. " +
                "Call list_providers and retry with a key from that list.",
            },
          ],
          isError: true,
        };
      }
      const rejected = unavailableMonitorProviderKeys(requested, payload.providers);
      if (rejected.length > 0) {
        return {
          content: [
            {
              type: "text",
              text:
                `providerKey ${rejected.join(", ")} is not in the provider catalog. ` +
                "Call list_providers and choose a key from that list.",
            },
          ],
          isError: true,
        };
      }
      return textResult(
        await getClient().monitors.create(args as CreateMonitorInput),
      );
    },
  );

  registerTool(
    "create_project",
    {
      title: "Create project",
      description: "Create a project via POST /api/v1/projects.",
      inputSchema: createProjectSchema,
      annotations: {
        readOnlyHint: false,
        destructiveHint: false,
        idempotentHint: false,
        openWorldHint: true,
      },
    },
    async (args) =>
      textResult(await getClient().projects.create(args as CreateProjectInput)),
  );


}
