/**
 * PromptEden MCP stdio server.
 *
 * The tool surface lives in @prompteden/mcp-tools so the stdio fallback and
 * hosted Streamable HTTP endpoint advertise and execute the same registry.
 */

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
  DEFAULT_BASE_URL,
  SERVER_INSTRUCTIONS,
  SERVER_VERSION,
  registerPromptEdenTools,
} from "./tools.js";

if (process.argv.some((arg) => arg === "--help" || arg === "-h")) {
  process.stdout.write(`PromptEden MCP Server

Usage:
  prompteden-mcp

Onboarding:
  No API key yet? Call agent_sign_up to mint one, set PROMPTEDEN_API_KEY to the
  returned value, then use the other tools. agent_sign_up and agent_sign_in
  work without PROMPTEDEN_API_KEY; every other tool requires it.

Environment:
  PROMPTEDEN_API_KEY   Required for all tools except agent_sign_up / agent_sign_in.
                       The server does not persist API keys.
  PROMPTEDEN_BASE_URL  Optional. Defaults to ${DEFAULT_BASE_URL}.

Transport:
  Model Context Protocol over stdio (@modelcontextprotocol/sdk). The SDK owns
  initialize/negotiation, ping, and tools/list; handler failures are returned
  as tool results with isError:true.
`);
  process.exit(0);
}

const server = new McpServer(
  { name: "prompteden-mcp", version: SERVER_VERSION },
  { instructions: SERVER_INSTRUCTIONS },
);

registerPromptEdenTools(server);

async function main(): Promise<void> {
  const transport = new StdioServerTransport();
  await server.connect(transport);
}

main().catch((error: unknown) => {
  process.stderr.write(
    `prompteden-mcp failed to start: ${error instanceof Error ? error.message : String(error)}\n`,
  );
  process.exit(1);
});
