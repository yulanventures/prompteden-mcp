import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { Client as McpClient } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import {
  CONTENT_AGENT_MCP_TOOL_NAMES,
  DEFAULT_BASE_URL,
  SERVER_VERSION,
  registerPromptEdenTools,
  type PromptEdenMcpToolResult,
  type RegisterPromptEdenToolsOptions,
} from "./tools.js";
import { normalizeBaseUrl } from "./api-client/client.js";

/** Discover the authenticated team's gate from the host; local env cannot grant access. */
export async function hostedContentToolsOptions(): Promise<RegisterPromptEdenToolsOptions> {
  const apiKey = process.env.PROMPTEDEN_API_KEY;
  if (!apiKey) return { contentAgentsEnabled: false };
  const url = new URL(
    "/api/mcp",
    normalizeBaseUrl(process.env.PROMPTEDEN_BASE_URL ?? DEFAULT_BASE_URL),
  );
  async function remote<T>(work: (client: McpClient) => Promise<T>): Promise<T> {
    const client = new McpClient({
      name: "prompteden-mcp-stdio",
      version: SERVER_VERSION,
    });
    const transport = new StreamableHTTPClientTransport(url, {
      requestInit: { headers: { Authorization: `Bearer ${apiKey}` } },
    });
    try {
      await client.connect(transport, { timeout: 15_000 });
      return await work(client);
    } finally {
      await client.close();
    }
  }
  const listed = await remote((client) => client.listTools(undefined, { timeout: 15_000 }));
  const agentsEnabled = listed.tools.some((tool) => tool.name === "list_content_agents");
  const call = async (name: string, args: Record<string, unknown>) =>
    await remote((client) =>
      client.callTool({ name, arguments: args }, undefined, { timeout: 15_000 }),
    ) as PromptEdenMcpToolResult;
  return {
    contentAgentsEnabled: agentsEnabled,
    contentAgentToolHandler: call,
  };
}

/** Discover in the background; lists wait briefly and SDK registration notifies
 * connected clients when the catalog changes. Refresh on demand, not a timer. */
export function registerLazyHostedContentTools(server: McpServer): void {
  const listWaitMs = 5_000;
  const refreshMs = 60_000;
  const contentTools = new Map<string, { remove(): void }>();
  let contentHandler: RegisterPromptEdenToolsOptions["contentAgentToolHandler"];
  let discovery: Promise<void> | undefined;
  let nextAttemptAt = 0;
  let failures = 0;

  const hideContentTools = () => {
    for (const tool of contentTools.values()) tool.remove();
    contentTools.clear();
    contentHandler = undefined;
  };
  const discover = (): Promise<void> => {
    if (!process.env.PROMPTEDEN_API_KEY) return Promise.resolve();
    if (discovery) return discovery;
    if (Date.now() < nextAttemptAt) return Promise.resolve();
    discovery = hostedContentToolsOptions().then((options) => {
      failures = 0;
      nextAttemptAt = Date.now() + refreshMs;
      if (!options.contentAgentsEnabled) {
        hideContentTools();
        return;
      }
      contentHandler = options.contentAgentToolHandler;
      if (contentTools.size) return;
      const registerTool = server.registerTool.bind(server) as (
        name: string, config: unknown, callback: unknown,
      ) => { remove(): void };
      registerPromptEdenTools({
        registerTool: (name: string, config: unknown, callback: unknown) => {
          if (CONTENT_AGENT_MCP_TOOL_NAMES.has(name)) {
            // The SDK emits notifications/tools/list_changed on registration/removal.
            contentTools.set(name, registerTool(name, config, callback));
          }
        },
      }, {
        contentAgentsEnabled: true,
        contentAgentToolHandler: (name, args) => contentHandler!(name, args),
      });
    }).catch(() => {
      hideContentTools();
      nextAttemptAt = Date.now() + Math.min(1_000 * 2 ** Math.min(failures++, 5), 30_000);
      process.stderr.write("Content tool discovery failed; retry the content request to refresh access.\n");
    }).finally(() => {
      discovery = undefined;
    });
    return discovery;
  };
  const waitForDiscovery = async () => {
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      await Promise.race([
        discover(),
        new Promise<void>((resolve) => { timer = setTimeout(resolve, listWaitMs); }),
      ]);
    } finally {
      clearTimeout(timer);
    }
  };

  // Decorate only the SDK handlers installed by registration, then restore the
  // public setter. The SDK still owns schemas, tool errors, and task handling.
  const install = server.server.setRequestHandler.bind(server.server);
  server.server.setRequestHandler = (schema, handler) => install(schema, async (request, extra) => {
    const message = request as { method: string; params?: { name?: string } };
    if (message.method === "tools/list") await waitForDiscovery();
    if (message.method === "tools/call" && CONTENT_AGENT_MCP_TOOL_NAMES.has(message.params?.name ?? "")) {
      await discover();
    }
    return handler(request, extra);
  });
  try {
    registerPromptEdenTools(server);
  } finally {
    server.server.setRequestHandler = install;
  }
  server.server.oninitialized = () => { void discover(); };
}
