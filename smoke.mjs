import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { readFileSync } from "node:fs";
import { createInterface } from "node:readline";

const SERVER_ENTRY = "dist/index.mjs";
const SDK_LATEST_PROTOCOL = "2025-11-25";
const ALLOWED_ORIGIN = "https://app.prompteden.com";
const fakeApiKey = "prompteden-test-key-not-secret";
const packageVersion = JSON.parse(
  readFileSync(new URL("./package.json", import.meta.url), "utf8"),
).version;

const EXPECTED_TOOLS = [
  "get_account",
  "list_monitors",
  "get_results",
  "list_providers",
  "list_projects",
  "get_project",
  "agent_status",
  "analytics_get_property",
  "analytics_get_verification",
  "analytics_get_traffic",
  "analytics_get_overview",
  "analytics_list_goals",
  "analytics_create_goal",
  "analytics_archive_goal",
  "analytics_add_property_host",
  "analytics_create_property",
  "analytics_rotate_key",
  "analytics_verify_property",
  "create_monitor",
  "create_project",
];

const READ_TOOLS = new Set([
  "get_account",
  "list_monitors",
  "get_results",
  "list_providers",
  "list_projects",
  "get_project",
  "agent_status",
  "analytics_get_property",
  "analytics_get_verification",
  "analytics_get_traffic",
  "analytics_get_overview",
  "analytics_list_goals",
]);

function startMcp({ withKey = true, baseUrl = ALLOWED_ORIGIN } = {}) {
  const env = { ...process.env };
  if (baseUrl === undefined) delete env.PROMPTEDEN_BASE_URL;
  else env.PROMPTEDEN_BASE_URL = baseUrl;
  if (withKey) env.PROMPTEDEN_API_KEY = fakeApiKey;
  else delete env.PROMPTEDEN_API_KEY;

  const child = spawn(process.execPath, [SERVER_ENTRY], {
    env,
    stdio: ["pipe", "pipe", "pipe"],
  });
  const lines = [];
  const badLines = [];
  const rl = createInterface({ input: child.stdout });
  rl.on("line", (line) => {
    try {
      lines.push(JSON.parse(line));
    } catch {
      badLines.push(line);
    }
  });
  let stderr = "";
  child.stderr.on("data", (chunk) => {
    stderr += chunk;
  });
  return { child, lines, badLines, stderr: () => stderr };
}

function waitForLine(lines, id) {
  return new Promise((resolve, reject) => {
    const startedAt = Date.now();
    const timer = setInterval(() => {
      const line = lines.find((candidate) => candidate.id === id);
      if (line) {
        clearInterval(timer);
        resolve(line);
        return;
      }
      if (Date.now() - startedAt > 5000) {
        clearInterval(timer);
        reject(new Error(`Timed out waiting for JSON-RPC response id ${id}`));
      }
    }, 10);
  });
}

function initParams(protocolVersion = SDK_LATEST_PROTOCOL) {
  return {
    protocolVersion,
    capabilities: {},
    clientInfo: { name: "smoke", version: "0.0.0" },
  };
}

async function send(mcp, id, method, params) {
  mcp.child.stdin.write(
    `${JSON.stringify({ jsonrpc: "2.0", id, method, params })}\n`,
  );
  const line = await waitForLine(mcp.lines, id);
  assert.equal(line.error, undefined, line.error?.message);
  return line.result;
}

async function sendRaw(mcp, id, method, params) {
  mcp.child.stdin.write(
    `${JSON.stringify({ jsonrpc: "2.0", id, method, params })}\n`,
  );
  return waitForLine(mcp.lines, id);
}

async function handshake(mcp, id) {
  const result = await send(mcp, id, "initialize", initParams());
  mcp.child.stdin.write(
    `${JSON.stringify({ jsonrpc: "2.0", method: "notifications/initialized" })}\n`,
  );
  return result;
}

const mcp = startMcp();
let noKeyMcp;
let badOriginMcp;

try {
  const initialized = await handshake(mcp, 1);
  assert.equal(initialized.serverInfo.name, "prompteden-mcp");
  assert.equal(initialized.serverInfo.version, packageVersion);
  assert.equal(initialized.protocolVersion, SDK_LATEST_PROTOCOL);
  assert.equal(typeof initialized.instructions, "string");
  assert.match(initialized.instructions, /Settings > API Keys/);
  assert.match(initialized.instructions, /https:\/\/app\.prompteden\.com/);
  assert.doesNotMatch(initialized.instructions, /content engine|sign_up|sign-up|OAuth|hosted/i);

  const listed = await send(mcp, 2, "tools/list", {});
  const names = listed.tools.map((tool) => tool.name);
  assert.deepEqual(names, EXPECTED_TOOLS);

  for (const tool of listed.tools) {
    assert.equal(tool.annotations.destructiveHint, false, tool.name);
    assert.equal(tool.annotations.readOnlyHint, READ_TOOLS.has(tool.name), tool.name);
    assert.match(tool.description, /credits/, tool.name);
    if (tool.name === "create_monitor") {
      assert.match(tool.description, /recurring metered runs/);
      assert.match(tool.description, /uses credits/);
    } else {
      assert.match(tool.description, /Does not use credits/);
    }
  }

  const rejected = await sendRaw(mcp, 3, "tools/call", {
    name: "create_monitor",
    arguments: {
      projectSlug: "smoke",
      name: "Daily visibility",
      cadenceMinutes: 1440,
      promptInstructions: "Track the brand",
      targets: [{ providerKey: "claude-code" }, { providerKey: "codex" }],
    },
  });
  assert.equal(rejected.error, undefined);
  assert.equal(rejected.result.isError, true);
  assert.match(rejected.result.content[0].text, /not available/);
  assert.equal(rejected.result.content[0].text.includes(fakeApiKey), false);

  const negotiated = await send(mcp, 4, "initialize", initParams("2025-06-18"));
  assert.equal(negotiated.protocolVersion, "2025-06-18");
  const fallbackUnknown = await send(mcp, 5, "initialize", initParams("venus"));
  assert.equal(fallbackUnknown.protocolVersion, SDK_LATEST_PROTOCOL);
  for (const supported of ["2025-11-25", "2025-03-26", "2024-11-05"]) {
    const echoed = await send(
      mcp,
      `init-${supported}`,
      "initialize",
      initParams(supported),
    );
    assert.equal(echoed.protocolVersion, supported);
  }

  assert.deepEqual(await send(mcp, 6, "ping", {}), {});
  const unknownMethod = await sendRaw(mcp, 7, "definitely/not/a/method", {});
  assert.equal(unknownMethod.error.code, -32601);
  const unknownTool = await sendRaw(mcp, 8, "tools/call", {
    name: "no_such_tool",
    arguments: {},
  });
  assert.equal(unknownTool.error, undefined);
  assert.equal(unknownTool.result.isError, true);

  mcp.child.stdin.write(
    `${JSON.stringify({ jsonrpc: "2.0", method: "some/unknown/notification", params: {} })}\n`,
  );
  assert.deepEqual(await send(mcp, 9, "ping", {}), {});
  assert.equal(
    mcp.lines.some((line) => line.id === null || line.id === undefined),
    false,
  );
  assert.deepEqual(mcp.badLines, []);
  for (const line of mcp.lines) assert.equal(line.jsonrpc, "2.0");
  assert.equal(mcp.stderr().includes(fakeApiKey), false);

  noKeyMcp = startMcp({ withKey: false });
  await handshake(noKeyMcp, 1);
  const noKeyAccount = await sendRaw(noKeyMcp, 2, "tools/call", {
    name: "get_account",
    arguments: {},
  });
  assert.equal(noKeyAccount.error, undefined);
  assert.equal(noKeyAccount.result.isError, true);
  assert.match(noKeyAccount.result.content[0].text, /API key/i);
  assert.match(noKeyAccount.result.content[0].text, /Settings > API Keys/);

  badOriginMcp = startMcp({ baseUrl: "http://127.0.0.1:9" });
  await handshake(badOriginMcp, 1);
  const badOrigin = await sendRaw(badOriginMcp, 2, "tools/call", {
    name: "get_account",
    arguments: {},
  });
  assert.equal(badOrigin.error, undefined);
  assert.equal(badOrigin.result.isError, true);
  assert.match(badOrigin.result.content[0].text, /not allowed/);
  assert.match(badOrigin.result.content[0].text, /https:\/\/app\.prompteden\.com/);

  process.stdout.write("mcp smoke ok\n");
} finally {
  for (const child of [mcp, noKeyMcp, badOriginMcp]) {
    if (!child) continue;
    child.child.stdin.end();
    child.child.kill();
  }
}
