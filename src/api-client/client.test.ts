/**
 * Unit tests for the API client. All HTTP is driven through an injected
 * fake fetch (the createClient `fetch` option). No network is touched.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  createClient,
  analyticsNativeOutputHealthSchema,
} from "./index.js";
import {
  isExcludedMonitorProviderKey,
  unavailableMonitorProviderKeys,
  visibleMonitorProviders,
} from "../monitor-providers.js";
import { ApiError } from './errors.js';

type Call = { url: string; init: RequestInit };

function recordingFetch(
  responder: (call: Call, index: number) => Response,
): { fetch: typeof fetch; calls: Call[] } {
  const calls: Call[] = [];
  const fetchImpl = ((input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    const call: Call = { url: String(input), init: init ?? {} };
    const index = calls.length;
    calls.push(call);
    return Promise.resolve(responder(call, index));
  }) as typeof fetch;
  return { fetch: fetchImpl, calls };
}

function headerValue(init: RequestInit, name: string): string | undefined {
  const headers = init.headers as Record<string, string> | undefined;
  if (!headers) return undefined;
  const match = Object.keys(headers).find((key) => key.toLowerCase() === name.toLowerCase());
  return match ? headers[match] : undefined;
}

test('a write auto-attaches an Idempotency-Key and Content-Type and applies unified defaults', async () => {
  const { fetch, calls } = recordingFetch(() => new Response(JSON.stringify({ id: 'm1' }), { status: 200 }));
  const client = createClient({ apiKey: 'k-test', fetch });

  const result = await client.monitors.create({
    projectSlug: 'acme',
    name: 'Brand watch',
    cadenceMinutes: 1440,
    promptInstructions: 'Track brand mentions',
    targets: [{ providerKey: 'openai' }],
  });

  assert.deepEqual(result, { id: 'm1' });
  assert.equal(calls.length, 1);

  const { init } = calls[0];
  assert.equal(init.method, 'POST');
  assert.equal(headerValue(init, 'Content-Type'), 'application/json');
  assert.ok(headerValue(init, 'Idempotency-Key'), 'expected an Idempotency-Key header');
  assert.equal(headerValue(init, 'Authorization'), 'Bearer k-test');
  assert.match(headerValue(init, 'User-Agent') ?? '', /@prompteden\/api-client\//);

  // Unified defaults applied by the schema before send.
  const body = JSON.parse(String(init.body));
  assert.equal(body.type, 'search');
  assert.equal(body.language, 'en');
  assert.equal(body.country, 'US');
});

test('a 429 with Retry-After is retried then succeeds', async () => {
  const { fetch, calls } = recordingFetch((_call, index) => {
    if (index === 0) {
      return new Response(JSON.stringify({ error: 'rate_limited' }), {
        status: 429,
        headers: { 'Retry-After': '0' },
      });
    }
    return new Response(JSON.stringify({ ok: true }), { status: 200 });
  });
  const client = createClient({ apiKey: 'k-test', fetch });

  const result = await client.account.get();
  assert.deepEqual(result, { ok: true });
  assert.equal(calls.length, 2);
});

test('a final non-ok throws ApiError carrying status, body, and path', async () => {
  const { fetch } = recordingFetch(
    () => new Response(JSON.stringify({ error: 'bad_request', message: 'nope' }), { status: 400 }),
  );
  const client = createClient({ apiKey: 'k-test', fetch });

  await assert.rejects(
    () => client.monitors.list(),
    (err: unknown) => {
      assert.ok(err instanceof ApiError);
      assert.equal(err.status, 400);
      assert.deepEqual(err.body, { error: 'bad_request', message: 'nope' });
      assert.equal(err.path, '/api/v1/monitors');
      return true;
    },
  );
});

test('account.get without a key throws a clear error', async () => {
  const { fetch } = recordingFetch(
    () => new Response(JSON.stringify({ ok: true }), { status: 200 }),
  );
  const client = createClient({ fetch });
  await assert.rejects(
    () => client.account.get(),
    /API key required[\s\S]*Settings > API Keys/,
  );
});

test('projects.get issues a GET to the id-scoped path', async () => {
  const { fetch, calls } = recordingFetch(
    () => new Response(JSON.stringify({ ok: true }), { status: 200 }),
  );
  const client = createClient({ apiKey: 'k-test', fetch });

  await client.projects.get(42);
  await client.projects.get('11111111-2222-4333-8444-555555555555');

  assert.equal(calls.length, 2);
  assert.equal(calls[0].init.method, 'GET');
  assert.match(calls[0].url, /\/api\/v1\/projects\/42$/);
  assert.match(calls[0].url, /^https:\/\/app\.prompteden\.com\//);
  assert.equal(calls[1].init.method, 'GET');
  assert.match(
    calls[1].url,
    /\/api\/v1\/projects\/11111111-2222-4333-8444-555555555555$/,
  );
});

test('baseUrl accepts only https://app.prompteden.com', () => {
  const fetchImpl = (async () => new Response('null')) as typeof fetch;
  assert.doesNotThrow(() =>
    createClient({ apiKey: 'k-test', fetch: fetchImpl, baseUrl: 'https://app.prompteden.com' }),
  );
  assert.doesNotThrow(() =>
    createClient({ apiKey: 'k-test', fetch: fetchImpl, baseUrl: 'https://app.prompteden.com/' }),
  );
  assert.throws(
    () => createClient({ apiKey: 'k-test', fetch: fetchImpl, baseUrl: 'http://127.0.0.1:9' }),
    /not allowed/,
  );
  assert.throws(
    () => createClient({ apiKey: 'k-test', fetch: fetchImpl, baseUrl: 'https://evil.example' }),
    /not allowed/,
  );
  assert.throws(
    () => createClient({ apiKey: 'k-test', fetch: fetchImpl, baseUrl: 'https://app.prompteden.com.evil.example' }),
    /not allowed/,
  );
  assert.throws(
    () => createClient({ apiKey: 'k-test', fetch: fetchImpl, baseUrl: 'https://user:pass@app.prompteden.com' }),
    /not allowed/,
  );
  assert.throws(
    () => createClient({ apiKey: 'k-test', fetch: fetchImpl, baseUrl: 'https://app.prompteden.com/other' }),
    /no path/,
  );
  assert.throws(
    () => createClient({ apiKey: 'k-test', fetch: fetchImpl, baseUrl: 'not a url' }),
    /valid URL/,
  );
  assert.throws(
    () => createClient({ apiKey: 'k-test', fetch: fetchImpl, baseUrl: 'https://app.prompteden.com.' }),
    /not allowed/,
  );
  assert.throws(
    () => createClient({ apiKey: 'k-test', fetch: fetchImpl, baseUrl: 'http://app.prompteden.com' }),
    /not allowed/,
  );
  assert.throws(
    () => createClient({ apiKey: 'k-test', fetch: fetchImpl, baseUrl: 'https://app.prompteden.com:8443' }),
    /not allowed/,
  );
  assert.throws(
    () => createClient({ apiKey: 'k-test', fetch: fetchImpl, baseUrl: 'https://app.prompteden.com/?x=1' }),
    /query or hash/,
  );
  assert.throws(
    () => createClient({ apiKey: 'k-test', fetch: fetchImpl, baseUrl: 'https://app.prompteden.com/#frag' }),
    /query or hash/,
  );
  assert.throws(
    () => createClient({ apiKey: 'k-test', fetch: fetchImpl, baseUrl: 'https://\u0430pp.prompteden.com' }),
    /not allowed/,
  );
});

test('providers.list GETs /api/v1/monitoring/providers and parses the { providers:[...] } shape', async () => {
  const payload = {
    providers: [
      { key: 'openai', name: 'OpenAI', category: 'search', costTier: 'standard', description: 'GPT search.' },
      { key: 'gemini', name: 'Gemini', category: 'search', costTier: 'standard', description: 'Gemini search.' },
    ],
  };
  const { fetch, calls } = recordingFetch(
    () => new Response(JSON.stringify(payload), { status: 200 }),
  );
  const client = createClient({ apiKey: 'k-test', fetch });

  const result = (await client.providers.list()) as { providers: { key: string }[] };

  assert.equal(calls.length, 1);
  const { init, url } = calls[0];
  assert.equal(init.method, 'GET');
  assert.match(url, /\/api\/v1\/monitoring\/providers$/);
  assert.equal(headerValue(init, 'Authorization'), 'Bearer k-test');
  // The { providers:[...] } shape is parsed through verbatim.
  assert.ok(Array.isArray(result.providers));
  assert.equal(result.providers.length, 2);
  assert.equal(result.providers[0].key, 'openai');
  assert.equal(result.providers[1].key, 'gemini');
});

test('analytics AI marker survives SDK schema parse and keeps numeric totals', async () => {
  const {
    analyticsAiTrafficMarkerSchema,
    analyticsTrafficResponseMarkerSchema,
    analyticsGaOverviewResponseMarkerSchema,
    analyticsGoalsResponseMarkerSchema,
  } = await import('./schemas.ts');

  const withheldTraffic = analyticsTrafficResponseMarkerSchema.parse({
    aiTrafficAvailable: false,
    totals: { visits: 12, pageviews: 14, aiVisits: 0 },
    extra: 'passthrough',
  });
  assert.equal(withheldTraffic.aiTrafficAvailable, false);
  assert.equal(withheldTraffic.totals?.aiVisits, 0);

  const withheldOverview = analyticsGaOverviewResponseMarkerSchema.parse({
    aiTrafficAvailable: false,
    totals: { visits: 12, aiVisits: 0, goalCompletions: null },
  });
  assert.equal(withheldOverview.aiTrafficAvailable, false);
  assert.equal(withheldOverview.totals?.aiVisits, 0);

  const measured = analyticsAiTrafficMarkerSchema.parse({
    aiTrafficAvailable: true,
  });
  assert.equal(measured.aiTrafficAvailable, true);

  assert.throws(() => analyticsAiTrafficMarkerSchema.parse({}));
  assert.throws(() =>
    analyticsTrafficResponseMarkerSchema.parse({
      aiTrafficAvailable: false,
      totals: { visits: 12, pageviews: 14, aiVisits: null },
    }),
  );

  const withheldGoals = analyticsGoalsResponseMarkerSchema.parse({
    aiTrafficAvailable: false,
    goals: [
      {
        completions: 8,
        sources: [{ id: "direct", completions: 2 }],
      },
    ],
  });
  assert.equal(withheldGoals.aiTrafficAvailable, false);
  assert.equal(withheldGoals.goals[0]?.completions, 8);
  assert.throws(() => analyticsGoalsResponseMarkerSchema.parse({ goals: [] }));
});

test('a timeout aborts the request', async () => {
  const abortingFetch = ((_input: RequestInfo | URL, init?: RequestInit): Promise<Response> =>
    new Promise<Response>((_resolve, reject) => {
      const signal = init?.signal;
      if (signal) {
        signal.addEventListener('abort', () => reject(new Error('aborted by timeout')));
      }
    })) as typeof fetch;

  const client = createClient({ apiKey: 'k-test', fetch: abortingFetch, timeoutMs: 10 });
  await assert.rejects(() => client.account.get(), /aborted/);
});

test("analytics addHost sends strict PATCH with the existing property id and rejects mixed targets", async () => {
  const { fetch, calls } = recordingFetch(() =>
    Response.json({
      property: {
        id: 7,
        canonicalHostname: "example.test",
        allowedHosts: ["example.test", "app.example.test"],
      },
    }),
  );
  const client = createClient({ apiKey: "k-test", fetch });
  await client.analytics.property.addHost({
    propertyId: 7,
    hostname: "APP.EXAMPLE.TEST",
  });
  assert.equal(calls[0].init.method, "PATCH");
  assert.equal(new URL(calls[0].url).pathname, "/api/v1/analytics/property");
  assert.deepEqual(JSON.parse(String(calls[0].init.body)), {
    propertyId: 7,
    hostname: "app.example.test",
  });
  const mixed = { propertyId: 7, hostname: "app.example.test", projectId: 9 };
  assert.throws(() => client.analytics.property.addHost(mixed));
  assert.equal(calls.length, 1);
});

test("SDK native output health distinguishes measured zero from unavailable and rejects leaks", () => {
  const base = {
    pipeline: "native_derivation",
    aiTrafficAvailable: false,
    status: "withheld_not_measured",
    lastAiClassifiedVisitCount: null,
    measuredAt: null,
    lastAttemptAt: null,
  };
  assert.equal(analyticsNativeOutputHealthSchema.safeParse(base).success, true);
  assert.equal(
    analyticsNativeOutputHealthSchema.safeParse({
      ...base,
      lastAiClassifiedVisitCount: 1,
    }).success,
    false,
  );
  assert.equal(
    analyticsNativeOutputHealthSchema.safeParse({ ...base, status: "measured" })
      .success,
    false,
  );
  const time = "2026-09-10T12:00:00.000Z";
  assert.equal(
    analyticsNativeOutputHealthSchema.safeParse({
      ...base,
      aiTrafficAvailable: true,
      status: "measured",
      lastAiClassifiedVisitCount: 0,
      measuredAt: time,
      lastAttemptAt: time,
    }).success,
    true,
  );
  assert.equal(
    analyticsNativeOutputHealthSchema.safeParse({
      ...base,
      aiTrafficAvailable: true,
      status: "measured",
    }).success,
    false,
  );
});

test("monitor provider filter drops coding-agent catalog entries and known keys", () => {
  const visible = visibleMonitorProviders([
    { key: "openai", name: "OpenAI", category: "search" },
    { key: "gemini", name: "Gemini", category: "search" },
    { key: "claude-code", name: "Claude Code", category: "agent" },
    { key: "codex", name: "Codex", category: "agent coding harnesses" },
    { key: "other-agent", name: "Other", category: "agent" },
    "not-a-provider",
  ]) as { key: string }[];
  assert.deepEqual(visible.map((provider) => provider.key), ["openai", "gemini"]);
  assert.equal(isExcludedMonitorProviderKey("claude-code"), true);
  assert.equal(isExcludedMonitorProviderKey("CODEX"), true);
  assert.equal(isExcludedMonitorProviderKey("openai"), false);
  assert.deepEqual(
    unavailableMonitorProviderKeys(
      ["openai", "other-agent", "mystery"],
      [
        { key: "openai", name: "OpenAI", category: "search" },
        { key: "other-agent", name: "Other Agent", category: "agent" },
      ],
    ),
    ["other-agent", "mystery"],
  );
});
