/**
 * Test-only fetch stand-in for smoke.mjs. Loaded with node --import.
 * Answers the provider catalog from SMOKE_PROVIDER_CATALOG and records any
 * monitor create so the smoke test can prove it did not run.
 */
const catalog = process.env.SMOKE_PROVIDER_CATALOG;
if (catalog) {
  const original = globalThis.fetch.bind(globalThis);
  globalThis.fetch = async (input, init) => {
    const url = String(input instanceof Request ? input.url : input);
    const method = String(init?.method ?? (input instanceof Request ? input.method : "GET")).toUpperCase();
    if (method === "GET" && url.includes("/api/v1/monitoring/providers")) {
      return new Response(catalog, {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    }
    if (method === "POST" && url.includes("/api/v1/monitors")) {
      process.stderr.write("smoke-fetch-mock: unexpected monitor create\n");
      return new Response(JSON.stringify({ error: "should_not_create" }), {
        status: 400,
        headers: { "content-type": "application/json" },
      });
    }
    return original(input, init);
  };
}
