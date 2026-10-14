import assert from "node:assert/strict";
import { test } from "node:test";
import {
  registerPromptEdenTools,
  getPromptEdenMcpToolRequiredScopes,
  type RegisterPromptEdenToolsOptions,
  type PromptEdenMcpToolResult,
} from "./tools.js";

const reads = ["list_content_agents", "get_content_agent", "review_content_agent_output"];
const writes = [
  "configure_content_agent", "activate_content_agent", "pause_content_agent",
  "resume_content_agent", "approve_content_agent_output", "veto_content_agent_output",
];

function registry(options: RegisterPromptEdenToolsOptions = {}) {
  const tools = new Map<string, {
    config: { annotations: { readOnlyHint: boolean } };
    handler: (args: Record<string, unknown>) => Promise<PromptEdenMcpToolResult>;
  }>();
  registerPromptEdenTools({
    registerTool(name: string, config: { annotations: { readOnlyHint: boolean } }, handler: (args: Record<string, unknown>) => Promise<PromptEdenMcpToolResult>) {
      tools.set(name, { config, handler });
    },
  }, options);
  return tools;
}

test("content gate and explicit consent scopes control the catalog", () => {
  const hidden = registry();
  assert.equal(hidden.size, 20);
  for (const name of [...reads, ...writes]) assert.equal(hidden.has(name), false);
  const enabled = registry({ contentAgentsEnabled: true });
  assert.equal(enabled.size, 29);
  for (const name of reads) {
    assert.equal(enabled.get(name)?.config.annotations.readOnlyHint, true);
    assert.deepEqual(getPromptEdenMcpToolRequiredScopes(name), ["content:read"]);
  }
  for (const name of writes) {
    assert.equal(enabled.get(name)?.config.annotations.readOnlyHint, false);
    assert.deepEqual(getPromptEdenMcpToolRequiredScopes(name), ["content:write"]);
  }
  const readConsent = registry({ contentAgentsEnabled: true, contentToolFilter: (name) => reads.includes(name) });
  assert.equal(readConsent.size, 23);
  for (const name of writes) assert.equal(readConsent.has(name), false);
  const cannotOverrideGate = registry({ contentAgentsEnabled: false, contentToolFilter: () => true });
  assert.equal(cannotOverrideGate.size, 20);
});

test("content writes forward the arguments and preserve the hosted approval proposal", async () => {
  const calls: { name: string; args: Record<string, unknown> }[] = [];
  const proposal = {
    content: [{ type: "text" as const, text: JSON.stringify({ status: "approval_required", approvalId: 1 }) }],
    _meta: { approvalRequired: true },
  };
  const tools = registry({
    contentAgentsEnabled: true,
    getClient: () => { throw new Error("Content writes must not execute REST directly"); },
    contentAgentToolHandler: async (name, args) => {
      calls.push({ name, args });
      return proposal;
    },
  });
  const args = { projectSlug: "example", agentId: 1, patch: { reviewPolicy: "every_piece" } };
  assert.deepEqual(await tools.get("configure_content_agent")!.handler(args), proposal);
  assert.deepEqual(calls, [{ name: "configure_content_agent", args }]);
  const noHost = registry({ contentAgentsEnabled: true });
  assert.equal((await noHost.get("configure_content_agent")!.handler(args)).isError, true);
});
