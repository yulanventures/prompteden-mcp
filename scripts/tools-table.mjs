import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";
import { createInterface } from "node:readline";

const README = new URL("../README.md", import.meta.url);
const START = "<!-- tools:start -->";
const END = "<!-- tools:end -->";

function startServer() {
  const child = spawn(process.execPath, ["dist/index.mjs"], {
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
          clientInfo: { name: "tools-table", version: "0.0.0" },
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

function cell(value) {
  return String(value).replace(/\s+/g, " ").replace(/\|/g, "\\|").trim();
}

function render(tools) {
  const analytics = tools
    .filter((tool) => tool.name.startsWith("analytics_"))
    .map((tool) => `\`${tool.name}\``);
  const rows = [
    `This build registers ${tools.length} tools. Analytics tools are included (${analytics.length}): ${analytics.join(", ")}.`,
    "",
    "| Tool | Description |",
    "| --- | --- |",
    ...tools.map((tool) => `| \`${cell(tool.name)}\` | ${cell(tool.description)} |`),
  ];
  return `${rows.join("\n")}\n`;
}

const tools = await listTools();
const table = render(tools);
const readme = readFileSync(README, "utf8");
const start = readme.indexOf(START);
const end = readme.indexOf(END);
if (start === -1 || end === -1 || end < start) {
  throw new Error(`README.md is missing ${START} / ${END} markers`);
}
const next =
  readme.slice(0, start + START.length) +
  "\n" +
  table +
  readme.slice(end);

if (process.argv.includes("--write")) {
  writeFileSync(README, next);
  process.stdout.write(`wrote ${tools.length} tools into README.md\n`);
} else if (process.argv.includes("--check")) {
  if (next !== readme) {
    process.stderr.write(
      "README tools table does not match tools/list. Run: node scripts/tools-table.mjs --write\n",
    );
    process.exit(1);
  }
  process.stdout.write(`tools table matches tools/list (${tools.length} tools)\n`);
} else {
  process.stdout.write(table);
}
