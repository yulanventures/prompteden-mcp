/**
 * PromptEden MCP stdio server.
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
  Create an account on the web, then set PROMPTEDEN_API_KEY to an API key from
  Settings > API Keys. Every tool requires that key. The server does not store it.

Environment:
  PROMPTEDEN_API_KEY   Required. The server does not persist API keys.
  PROMPTEDEN_BASE_URL  Optional. When set, must be ${DEFAULT_BASE_URL}.

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
