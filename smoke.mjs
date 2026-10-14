import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { readFileSync } from "node:fs";
import { createInterface } from "node:readline";

import { CONTENT_AGENT_TOOLS } from "./scripts/smoke-fetch-mock.mjs";

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

function startMcp({ withKey = true, baseUrl = ALLOWED_ORIGIN, catalog, contentGate = "off" } = {}) {
  const env = { ...process.env };
  if (baseUrl === undefined) delete env.PROMPTEDEN_BASE_URL;
  else env.PROMPTEDEN_BASE_URL = baseUrl;
  if (withKey) env.PROMPTEDEN_API_KEY = fakeApiKey;
  else delete env.PROMPTEDEN_API_KEY;

  // Keep inherited mock settings from affecting a child scenario.
  delete env.SMOKE_CONTENT_GATE;
  delete env.SMOKE_CONTENT_TRACE;
  delete env.SMOKE_PROVIDER_CATALOG;
  const args = [SERVER_ENTRY];
  if (contentGate) {
    env.SMOKE_CONTENT_GATE = contentGate;
    env.SMOKE_CONTENT_TRACE = "1";
  }
  if (catalog) env.SMOKE_PROVIDER_CATALOG = JSON.stringify(catalog);
  if (catalog || contentGate) {
    args.unshift(
      "--import",
      new URL("./scripts/smoke-fetch-mock.mjs", import.meta.url).pathname,
    );
  }

  const child = spawn(process.execPath, args, {
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
      if (Date.now() - startedAt > 8000) {
        clearInterval(timer);
        reject(new Error(`Timed out waiting for JSON-RPC response id ${id}`));
      }
    }, 10);
  });
}

async function waitForNotification(mcp, method) {
  const startedAt = Date.now();
  while (!mcp.lines.some((line) => line.method === method)) {
    if (Date.now() - startedAt > 8_000) throw new Error(`Timed out waiting for ${method}`);
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
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

const mcp = startMcp({
  catalog: {
    providers: [
      { key: "openai", name: "OpenAI", category: "search" },
      { key: "other-agent", name: "Other Agent", category: "agent" },
    ],
  },
});
let noKeyMcp;
let badOriginMcp;
const contentMcps = [];

try {
  const initialized = await handshake(mcp, 1);
  assert.equal(initialized.serverInfo.name, "prompteden-mcp");
  assert.equal(initialized.serverInfo.version, packageVersion);
  assert.equal(initialized.protocolVersion, SDK_LATEST_PROTOCOL);
  assert.equal(typeof initialized.instructions, "string");
  assert.match(initialized.instructions, /Settings > API Keys/);
  assert.match(initialized.instructions, /https:\/\/app\.prompteden\.com/);
  assert.doesNotMatch(initialized.instructions, /sign_up|sign-up|password/i);

  const listed = await send(mcp, 2, "tools/list", {});
  const names = listed.tools.map((tool) => tool.name);
  assert.deepEqual(names, EXPECTED_TOOLS);
  assert.equal(listed.nextCursor, undefined);

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
      targets: [{ providerKey: "other-agent" }],
    },
  });
  assert.equal(rejected.error, undefined);
  assert.equal(rejected.result.isError, true);
  assert.match(rejected.result.content[0].text, /other-agent/);
  assert.match(rejected.result.content[0].text, /not in the provider catalog/);
  assert.equal(rejected.result.content[0].text.includes(fakeApiKey), false);
  assert.equal(mcp.stderr().includes("unexpected monitor create"), false);

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

  noKeyMcp = startMcp({ withKey: false, contentGate: "enabled" });
  await handshake(noKeyMcp, 1);
  const noKeyList = await send(noKeyMcp, "no-key-list", "tools/list", {});
  assert.deepEqual(noKeyList.tools.map((tool) => tool.name), EXPECTED_TOOLS);
  assert.equal(noKeyList.nextCursor, undefined);
  assert.equal(noKeyMcp.stderr(), "", "no key must mean no hosted HTTP");
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

  for (const gate of ["enabled", "off", "retry"]) {
    const contentMcp = startMcp({ contentGate: gate });
    contentMcps.push(contentMcp);
    const initialized = await handshake(contentMcp, 1);
    assert.equal(initialized.capabilities.tools.listChanged, true);
    const first = await send(contentMcp, 2, "tools/list", {});
    const expected = gate === "enabled" ? [...EXPECTED_TOOLS, ...CONTENT_AGENT_TOOLS] : EXPECTED_TOOLS;
    assert.deepEqual(first.tools.map((tool) => tool.name), expected);
    assert.equal(first.nextCursor, undefined);
    if (gate === "retry") {
      assert.match(contentMcp.stderr(), /Content tool discovery failed; retry the content request to refresh access\./);
      const notificationsBefore = contentMcp.lines.filter((line) => line.method === "notifications/tools/list_changed").length;
      const failedList = await send(contentMcp, "backoff-list", "tools/list", {});
      assert.deepEqual(failedList.tools.map((tool) => tool.name), EXPECTED_TOOLS);
      assert.equal((contentMcp.stderr().match(/smoke-fetch-mock: tools\/list/g) ?? []).length, 1,
        "requests during backoff must not start another discovery");
      await new Promise((resolve) => setTimeout(resolve, 1_100));
      const recovered = await send(contentMcp, "recovered-list", "tools/list", {});
      assert.deepEqual(recovered.tools.map((tool) => tool.name), [...EXPECTED_TOOLS, ...CONTENT_AGENT_TOOLS]);
      assert.equal(recovered.nextCursor, undefined);
      assert.ok(contentMcp.lines.filter((line) => line.method === "notifications/tools/list_changed").length > notificationsBefore,
        "recovery after an answered list must notify the client");
    }
    const result = await send(contentMcp, 3, "tools/call", {
      name: "configure_content_agent",
      arguments: { projectSlug: "smoke", agentId: 1, patch: { reviewPolicy: "every_piece" } },
    });
    if (gate === "off") {
      assert.equal(result.isError, true);
      assert.equal(contentMcp.stderr().includes("smoke-fetch-mock: tools/call"), false);
    } else {
      assert.equal(result.isError, undefined);
      const proposal = JSON.parse(result.content[0].text);
      assert.equal(proposal.status, "approval_required");
      assert.equal(proposal.approvalUrl, "https://app.prompteden.com/approvals/1");
      const read = await send(contentMcp, 6, "tools/call", {
        name: "list_content_agents", arguments: { projectSlug: "smoke" },
      });
      assert.deepEqual(JSON.parse(read.content[0].text), { agents: [], untrusted: true });
      const invalid = await send(contentMcp, 7, "tools/call", {
        name: "approve_content_agent_output", arguments: { agentId: 1, articleId: 1 },
      });
      assert.equal(invalid.isError, true, "output decisions need review handles");
    }
    const refreshed = await send(contentMcp, 8, "tools/list", {});
    assert.deepEqual(refreshed.tools.map((tool) => tool.name), gate === "off" ? EXPECTED_TOOLS : [...EXPECTED_TOOLS, ...CONTENT_AGENT_TOOLS]);
    assert.equal(refreshed.nextCursor, undefined);
    assert.equal(contentMcp.stderr().includes(fakeApiKey), false);
    assert.deepEqual(contentMcp.badLines, []);
  }

  const slowMcp = startMcp({ contentGate: "slow" });
  contentMcps.push(slowMcp);
  const initStarted = Date.now();
  await send(slowMcp, 1, "initialize", initParams());
  assert.ok(Date.now() - initStarted < 2_000, "initialize must not wait for discovery");
  assert.equal(slowMcp.stderr(), "", "hosted discovery must wait for notifications/initialized");
  // Queue initialization and the first requests together, so runner delays
  // cannot consume the mock's discovery delay before tools/list starts.
  slowMcp.child.stdin.cork();
  slowMcp.child.stdin.write(
    `${JSON.stringify({ jsonrpc: "2.0", method: "notifications/initialized" })}\n`,
  );
  const earlyContentCall = send(slowMcp, "early-content-call", "tools/call", {
    name: "list_content_agents", arguments: {},
  });
  const listStarted = Date.now();
  const slowListResponse = send(slowMcp, 2, "tools/list", {});
  slowMcp.child.stdin.uncork();
  const slowList = await slowListResponse;
  const listElapsed = Date.now() - listStarted;
  assert.ok(listElapsed >= 4_500 && listElapsed < 6_000, "tools/list must wait at most five seconds for discovery");
  assert.deepEqual(slowList.tools.map((tool) => tool.name), EXPECTED_TOOLS);
  assert.equal(slowList.nextCursor, undefined);
  // A ping still works while the hosted request is outstanding.
  assert.deepEqual(await send(slowMcp, 3, "ping", {}), {});
  assert.equal((await earlyContentCall).isError, undefined, "content calls must wait for the shared discovery");
  await waitForNotification(slowMcp, "notifications/tools/list_changed");
  const afterSlowDiscovery = await send(slowMcp, 4, "tools/list", {});
  assert.deepEqual(afterSlowDiscovery.tools.map((tool) => tool.name), [...EXPECTED_TOOLS, ...CONTENT_AGENT_TOOLS]);
  assert.equal(afterSlowDiscovery.nextCursor, undefined);
  assert.equal((slowMcp.stderr().match(/smoke-fetch-mock: tools\/list/g) ?? []).length, 1,
    "a timed-out local list must share the outstanding discovery");

  const changedGateMcp = startMcp({ contentGate: "change" });
  contentMcps.push(changedGateMcp);
  await handshake(changedGateMcp, 1);
  const beforeChange = await send(changedGateMcp, 2, "tools/list", {});
  assert.deepEqual(beforeChange.tools.map((tool) => tool.name), [...EXPECTED_TOOLS, ...CONTENT_AGENT_TOOLS]);
  // The hosted fixture advances the child clock and disables the gate after this call.
  await send(changedGateMcp, 3, "tools/call", { name: "list_content_agents", arguments: {} });
  const noticesBeforeChange = changedGateMcp.lines.filter((line) => line.method === "notifications/tools/list_changed").length;
  const afterChange = await send(changedGateMcp, 4, "tools/list", {});
  assert.deepEqual(afterChange.tools.map((tool) => tool.name), EXPECTED_TOOLS);
  assert.equal(afterChange.nextCursor, undefined);
  assert.ok(changedGateMcp.lines.filter((line) => line.method === "notifications/tools/list_changed").length > noticesBeforeChange,
    "a later gate change must notify the client");
  const revoked = await send(changedGateMcp, 5, "tools/call", { name: "list_content_agents", arguments: {} });
  assert.equal(revoked.isError, true);

  const noKeyContent = await send(noKeyMcp, 3, "tools/call", {
    name: "list_content_agents", arguments: {},
  });
  assert.equal(noKeyContent.isError, true);
  assert.equal(noKeyMcp.stderr(), "", "no-key lists and calls must never fetch");
  for (const baseUrl of ["http://127.0.0.1:9", `${ALLOWED_ORIGIN}/path`, `${ALLOWED_ORIGIN}/?q=1`, `${ALLOWED_ORIGIN}/#hash`, "https://user:pass@app.prompteden.com"]) {
    const invalidMcp = startMcp({ baseUrl, contentGate: "enabled" });
    contentMcps.push(invalidMcp);
    await handshake(invalidMcp, 1);
    const denied = await send(invalidMcp, 2, "tools/call", { name: "list_content_agents", arguments: {} });
    assert.equal(denied.isError, true);
    assert.match(invalidMcp.stderr(), /Content tool discovery failed/);
    assert.doesNotMatch(invalidMcp.stderr(), /smoke-fetch-mock:/, "invalid base must fail before HTTP");
  }

  process.stdout.write("mcp smoke ok\n");
} finally {
  for (const child of [mcp, noKeyMcp, badOriginMcp, ...contentMcps]) {
    if (!child) continue;
    child.child.stdin.end();
    child.child.kill();
  }
}
