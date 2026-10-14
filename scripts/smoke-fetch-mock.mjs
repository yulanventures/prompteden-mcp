/** Offline HTTP stand-in shared by catalog generation and content smoke tests. */
export const CONTENT_AGENT_TOOLS = [
  "list_content_agents",
  "get_content_agent",
  "review_content_agent_output",
  "configure_content_agent",
  "activate_content_agent",
  "pause_content_agent",
  "resume_content_agent",
  "approve_content_agent_output",
  "veto_content_agent_output",
];

export function installSmokeFetchMock({ catalog, contentGate, trace = false } = {}) {
  const original = globalThis.fetch;
  const calls = [];
  let discoveries = 0;
  globalThis.fetch = async (input, init) => {
    const url = new URL(String(input instanceof Request ? input.url : input));
    const method = String(init?.method ?? (input instanceof Request ? input.method : "GET")).toUpperCase();
    const headers = new Headers(init?.headers ?? (input instanceof Request ? input.headers : undefined));
    const body = init?.body ? JSON.parse(String(init.body)) : undefined;
    calls.push({ url: url.toString(), method, headers, body });
    if (url.origin !== "https://app.prompteden.com") throw new Error("Unexpected mock origin");
    if (method === "GET" && url.pathname === "/api/v1/monitoring/providers" && catalog) {
      return Response.json(catalog);
    }
    if (method === "POST" && url.pathname === "/api/v1/monitors") {
      process.stderr.write("smoke-fetch-mock: unexpected monitor create\n");
      return Response.json({ error: "should_not_create" }, { status: 400 });
    }
    if (url.pathname !== "/api/mcp" || !contentGate) throw new Error("Unexpected mock request");
    if (headers.get("Authorization") !== "Bearer prompteden-test-key-not-secret") {
      throw new Error("Missing mock API key");
    }
    if (method === "GET") return new Response(null, { status: 405 });
    if (method === "DELETE") return new Response(null, { status: 200 });
    if (method !== "POST") throw new Error("Unexpected mock method");
    if (trace) process.stderr.write(`smoke-fetch-mock: ${body.method}\n`);
    if (body.id === undefined) return new Response(null, { status: 202 });
    let result;
    switch (body.method) {
      case "initialize":
        result = {
          protocolVersion: body.params.protocolVersion,
          capabilities: { tools: {} },
          serverInfo: { name: "mock-hosted", version: "0.4.0" },
        };
        break;
      case "tools/list":
        discoveries += 1;
        if (contentGate === "retry" && discoveries === 1) {
          return Response.json({ error: "unavailable" }, { status: 503 });
        }
        result = {
          tools: contentGate === "off" ? [] : CONTENT_AGENT_TOOLS.map((name) => ({ name, inputSchema: { type: "object" } })),
        };
        break;
      case "tools/call": {
        const name = body.params.name;
        if (!CONTENT_AGENT_TOOLS.includes(name)) throw new Error("Unexpected hosted tool");
        const readOnly = CONTENT_AGENT_TOOLS.indexOf(name) < 3;
        result = {
          content: [{ type: "text", text: JSON.stringify(readOnly
            ? { agents: [], untrusted: true }
            : { status: "approval_required", approvalId: 1, approvalUrl: "https://app.prompteden.com/approvals/1" }) }],
        };
        break;
      }
      default:
        throw new Error("Unexpected hosted method");
    }
    return Response.json({ jsonrpc: "2.0", id: body.id, result });
  };
  return { calls, restore: () => { globalThis.fetch = original; } };
}

if (process.env.SMOKE_PROVIDER_CATALOG || process.env.SMOKE_CONTENT_GATE) {
  installSmokeFetchMock({
    catalog: process.env.SMOKE_PROVIDER_CATALOG ? JSON.parse(process.env.SMOKE_PROVIDER_CATALOG) : undefined,
    contentGate: process.env.SMOKE_CONTENT_GATE,
    trace: process.env.SMOKE_CONTENT_TRACE === "1",
  });
}
