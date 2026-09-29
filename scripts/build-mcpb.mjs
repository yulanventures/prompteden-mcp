import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { access, cp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { createInterface } from "node:readline";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const bundle = join(root, "dist", "index.mjs");
const stage = join(root, "build", "mcpb-stage");
const pkg = JSON.parse(await readFile(join(root, "package.json"), "utf8"));

await access(bundle).catch(() => {
  throw new Error("dist/index.mjs is missing. Run npm run build first.");
});

function startServer() {
  const child = spawn(process.execPath, [bundle], {
    stdio: ["pipe", "pipe", "pipe"],
    env: { ...process.env },
  });
  const lines = [];
  const rl = createInterface({ input: child.stdout });
  rl.on("line", (line) => {
    try {
      lines.push(JSON.parse(line));
    } catch {
      lines.push({ parseError: line });
    }
  });
  return { child, lines };
}

function waitFor(lines, id) {
  return new Promise((resolve, reject) => {
    const started = Date.now();
    const timer = setInterval(() => {
      const line = lines.find((candidate) => candidate.id === id);
      if (line) {
        clearInterval(timer);
        resolve(line);
        return;
      }
      if (Date.now() - started > 5000) {
        clearInterval(timer);
        reject(new Error(`Timed out waiting for response ${id}`));
      }
    }, 10);
  });
}

async function listTools() {
  const mcp = startServer();
  try {
    mcp.child.stdin.write(
      `${JSON.stringify({
        jsonrpc: "2.0",
        id: 1,
        method: "initialize",
        params: {
          protocolVersion: "2025-11-25",
          capabilities: {},
          clientInfo: { name: "mcpb-build", version: "0.0.0" },
        },
      })}\n`,
    );
    const initialized = await waitFor(mcp.lines, 1);
    assert.equal(initialized.error, undefined);
    mcp.child.stdin.write(
      `${JSON.stringify({ jsonrpc: "2.0", method: "notifications/initialized" })}\n`,
    );
    mcp.child.stdin.write(
      `${JSON.stringify({ jsonrpc: "2.0", id: 2, method: "tools/list", params: {} })}\n`,
    );
    const listed = await waitFor(mcp.lines, 2);
    assert.equal(listed.error, undefined);
    return listed.result.tools;
  } finally {
    mcp.child.stdin.end();
    mcp.child.kill();
  }
}

function run(command, args) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { cwd: root, stdio: "inherit" });
    child.on("error", reject);
    child.on("exit", (status) => {
      if (status === 0) resolve();
      else reject(new Error(`${command} ${args.join(" ")} exited ${status}`));
    });
  });
}

const tools = await listTools();
const manifest = {
  manifest_version: "0.3",
  name: "prompteden-mcp",
  display_name: "PromptEden",
  version: pkg.version,
  description:
    "MCP server that lets Claude, Codex, Cursor and other MCP clients read your PromptEden data: projects, monitors, captured answers, and analytics.",
  long_description:
    "Track your brand in AI answers from your own agent. " +
    "PromptEden checks how AI answers talk about your business. Answer engines come from the live provider catalog (list_providers); a monitor target uses one of those provider keys. This MCP server gives your own agent that data, so you can ask about it in Claude, Codex, Cursor, or any other MCP client you already use.\n\n" +
    "Your agent can list projects and monitors, pull captured answers (get_results returns the API JSON and accepts a since date), set up a new project or monitor, and check your plan and usage. This server does not add citation or competitor fields of its own. preview_displacement_scan accepts an optional competitor list and does not persist it. If you have the PromptEden analytics snippet on your site, the agent can also read visits that came from AI engines, set up goals, and check that the snippet is working. Content engine tools are included. They declare content:read, content:write, topics:read, or topics:write, and this package does not check a separate content-access flag before calling them. Read tools are marked read-only, and every write tool is marked non-destructive.\n\n" +
    "The server runs locally over stdio on Node 20 or later. It uses your own PromptEden API key, passed as PROMPTEDEN_API_KEY, and it does not store your key. For an existing account, create the key under Settings > API Keys. agent_sign_up can mint a key without that page. This package does not check that the account plan includes API access.",
  author: {
    name: "Yulan Ventures LLC",
    url: "https://prompteden.com",
  },
  repository: {
    type: "git",
    url: "https://github.com/yulanventures/prompteden-mcp.git",
  },
  homepage: "https://github.com/yulanventures/prompteden-mcp",
  documentation: "https://github.com/yulanventures/prompteden-mcp#readme",
  support: "https://github.com/yulanventures/prompteden-mcp/issues",
  server: {
    type: "node",
    entry_point: "server/index.mjs",
    mcp_config: {
      command: "node",
      args: ["${__dirname}/server/index.mjs"],
      env: {
        PROMPTEDEN_API_KEY: "${user_config.api_key}",
        PROMPTEDEN_BASE_URL: "${user_config.base_url}",
      },
    },
  },
  tools: tools.map((tool) => ({
    name: tool.name,
    description: String(tool.description).replace(/\s+/g, " ").trim(),
  })),
  tools_generated: true,
  keywords: [
    "mcp",
    "ai-visibility",
    "answer-engine-optimization",
    "brand-monitoring",
    "marketing-analytics",
    "web-analytics",
    "small-business",
    "claude",
    "stdio",
  ],
  license: "MIT",
  compatibility: {
    platforms: ["darwin", "win32", "linux"],
    runtimes: { node: ">=20" },
  },
  user_config: {
    api_key: {
      type: "string",
      title: "PromptEden API key",
      description:
        "PromptEden API key, passed as PROMPTEDEN_API_KEY. Optional for agent_sign_up and agent_sign_in. The server does not write it to disk.",
      sensitive: true,
      required: false,
    },
    base_url: {
      type: "string",
      title: "PromptEden base URL",
      description: "API origin passed as PROMPTEDEN_BASE_URL.",
      default: "https://app.prompteden.com",
      required: false,
    },
  },
};

await rm(stage, { recursive: true, force: true });
await mkdir(join(stage, "server"), { recursive: true });
await cp(bundle, join(stage, "server", "index.mjs"));
await writeFile(join(stage, "manifest.json"), `${JSON.stringify(manifest, null, 2)}\n`);

const mcpb = join(root, "node_modules", ".bin", "mcpb");
await run(mcpb, ["validate", stage]);
const outfile = join(root, "build", `prompteden-mcp-${pkg.version}.mcpb`);
await rm(outfile, { force: true });
await run(mcpb, ["pack", stage, outfile]);
process.stdout.write(`mcpb -> ${outfile} (${tools.length} tools)\n`);
