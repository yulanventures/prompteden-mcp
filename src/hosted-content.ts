import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { ListToolsResult } from "@modelcontextprotocol/sdk/types.js";
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
  const listed = await remote((client) => client.listTools());
  const agentsEnabled = listed.tools.some((tool) => tool.name === "list_content_agents");
  const call = async (name: string, args: Record<string, unknown>) =>
    await remote((client) =>
      client.callTool({ name, arguments: args }),
    ) as PromptEdenMcpToolResult;
  return {
    contentAgentsEnabled: agentsEnabled,
    contentAgentToolHandler: call,
  };
}

/** Discover hosted access only on a content call. Listing has no network side
 * effects; the content page appears after discovery. Keep SDK dispatch. */
export function registerLazyHostedContentTools(server: McpServer): void {
  const cursor = "hosted-content";
  let discovery: Promise<void> | undefined;
  const discover = () => discovery ??= hostedContentToolsOptions().then((options) => {
    const registerTool = server.registerTool.bind(server) as (name: string, config: unknown, callback: unknown) => unknown;
    registerPromptEdenTools({
      registerTool: (name: string, config: unknown, callback: unknown) => {
        if (CONTENT_AGENT_MCP_TOOL_NAMES.has(name)) return registerTool(name, config, callback);
      },
    }, options);
  }).catch(() => {
    discovery = undefined;
    process.stderr.write("Content tool discovery failed; retry the content request to refresh access.\n");
  });

  // Decorate only the SDK handlers installed by registration, then restore the
  // public setter. The SDK still owns schemas, tool errors, and task handling.
  const install = server.server.setRequestHandler.bind(server.server);
  server.server.setRequestHandler = (schema, handler) => install(schema, async (request, extra) => {
    const message = request as { method: string; params?: { cursor?: string; name?: string } };
    const contentPage = message.method === "tools/list" && message.params?.cursor === cursor;
    if (message.method === "tools/call" && CONTENT_AGENT_MCP_TOOL_NAMES.has(message.params?.name ?? "")) {
      await discover();
    }
    const result = await handler(request, extra);
    if (message.method !== "tools/list") return result;
    const tools = (result as ListToolsResult).tools.filter((tool) => CONTENT_AGENT_MCP_TOOL_NAMES.has(tool.name) === contentPage);
    return { ...result, tools, ...(!contentPage && discovery ? { nextCursor: cursor } : {}) };
  });
  try {
    registerPromptEdenTools(server);
  } finally {
    server.server.setRequestHandler = install;
  }
}
