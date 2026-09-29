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

test('agent.signUp works with NO apiKey; account.get without a key throws a clear error', async () => {
  const { fetch, calls } = recordingFetch(
    () => new Response(JSON.stringify({ status: 'created', apiKey: 'pe_test_fixture' }), { status: 201 }),
  );
  const client = createClient({ fetch });

  const result = await client.agent.signUp({ humanEmail: 'a@b.com', agentName: 'Example Agent' });
  assert.deepEqual(result, { status: 'created', apiKey: 'pe_test_fixture' });
  assert.equal(calls.length, 1);
  assert.equal(headerValue(calls[0].init, 'Authorization'), undefined);

  await assert.rejects(() => client.account.get(), /API key required/);
});

test('projects.get and articles.get issue GETs to the id-scoped path (number or uuid)', async () => {
  const { fetch, calls } = recordingFetch(
    () => new Response(JSON.stringify({ ok: true }), { status: 200 }),
  );
  const client = createClient({ apiKey: 'k-test', fetch });

  await client.projects.get(42);
  await client.content.articles.get('11111111-2222-4333-8444-555555555555');

  assert.equal(calls.length, 2);
  assert.equal(calls[0].init.method, 'GET');
  assert.match(calls[0].url, /\/api\/v1\/projects\/42$/);
  assert.equal(calls[1].init.method, 'GET');
  assert.match(
    calls[1].url,
    /\/api\/v1\/content\/articles\/11111111-2222-4333-8444-555555555555$/,
  );
});

test('content list queries forward projectUuid alongside projectId', async () => {
  const { fetch, calls } = recordingFetch(
    () => new Response(JSON.stringify({ topics: [] }), { status: 200 }),
  );
  const client = createClient({ apiKey: 'k-test', fetch });

  await client.content.topics.list({ projectUuid: 'aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee' });
  await client.content.articles.list({ projectId: 7 });

  assert.match(calls[0].url, /projectUuid=aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee/);
  // projectId was undefined on the first call, so it must NOT be serialized.
  assert.ok(!/projectId=/.test(calls[0].url));
  assert.match(calls[1].url, /projectId=7/);
  assert.ok(!/projectUuid=/.test(calls[1].url));
});

test('newsroom setup methods cover latest, create, get, apply, and dismiss wire shapes', async () => {
  const { fetch, calls } = recordingFetch(
    () => new Response(JSON.stringify({ setup: { id: 12 } }), { status: 200 }),
  );
  const client = createClient({ apiKey: 'k-test', fetch });

  await client.content.newsroom.setups.list({ projectSlug: 'acme' });
  await client.content.newsroom.setups.create({
    projectSlug: '  acme  ',
    goal: '  Own the category  ',
  });
  await client.content.newsroom.setups.get('11111111-2222-4333-8444-555555555555');
  await client.content.newsroom.setups.apply(12);
  await client.content.newsroom.setups.apply(12, { writerIndexes: [0, 2] });
  await client.content.newsroom.setups.dismiss(12);

  assert.match(calls[0].url, /\/api\/v1\/content\/newsroom\/setups\?projectSlug=acme$/);
  assert.equal(calls[0].init.method, 'GET');

  assert.match(calls[1].url, /\/api\/v1\/content\/newsroom\/setups$/);
  assert.equal(calls[1].init.method, 'POST');
  assert.deepEqual(JSON.parse(String(calls[1].init.body)), {
    projectSlug: 'acme',
    goal: 'Own the category',
  });

  assert.match(
    calls[2].url,
    /\/api\/v1\/content\/newsroom\/setups\/11111111-2222-4333-8444-555555555555$/,
  );
  assert.equal(calls[2].init.method, 'GET');

  assert.match(calls[3].url, /\/api\/v1\/content\/newsroom\/setups\/12\/apply$/);
  assert.deepEqual(JSON.parse(String(calls[3].init.body)), {});
  assert.deepEqual(JSON.parse(String(calls[4].init.body)), { writerIndexes: [0, 2] });

  assert.match(calls[5].url, /\/api\/v1\/content\/newsroom\/setups\/12\/dismiss$/);
  assert.equal(calls[5].init.method, 'POST');
  assert.equal(calls[5].init.body, undefined);
  assert.equal(headerValue(calls[5].init, 'Content-Type'), undefined);

  for (const index of [1, 3, 4, 5]) {
    assert.ok(
      headerValue(calls[index].init, 'Idempotency-Key'),
      `expected an Idempotency-Key header on call ${index}`,
    );
  }
});

test('newsroom setup schemas reject missing project refs and invalid writer indexes', () => {
  const client = createClient({
    apiKey: 'k-test',
    fetch: recordingFetch(() => new Response('{}')).fetch,
  });

  assert.throws(() =>
    client.content.newsroom.setups.create({ goal: 'Own the category' } as never),
  );
  assert.throws(() =>
    client.content.newsroom.setups.create({ projectUuid: 'not-a-uuid', goal: 'Valid goal' }),
  );
  assert.throws(() =>
    client.content.newsroom.setups.apply(12, { writerIndexes: [-1] }),
  );
  assert.throws(() =>
    client.content.newsroom.setups.apply(12, {
      writerIndexes: Array.from({ length: 21 }, (_, index) => index),
    }),
  );
});

test('articles.update PATCHes with an Idempotency-Key and validates the status enum', async () => {
  const { fetch, calls } = recordingFetch(
    () => new Response(JSON.stringify({ article: { id: 9, status: 'approved' } }), { status: 200 }),
  );
  const client = createClient({ apiKey: 'k-test', fetch });

  const result = await client.content.articles.update(9, { status: 'approved' });
  assert.deepEqual(result, { article: { id: 9, status: 'approved' } });

  const { init, url } = calls[0];
  assert.equal(init.method, 'PATCH');
  assert.match(url, /\/api\/v1\/content\/articles\/9$/);
  assert.equal(headerValue(init, 'Content-Type'), 'application/json');
  assert.ok(headerValue(init, 'Idempotency-Key'), 'expected an Idempotency-Key header on PATCH');
  assert.deepEqual(JSON.parse(String(init.body)), { status: 'approved' });

  // 'published' is NOT a valid article review-state status (publish is a POST route).
  assert.throws(() => client.content.articles.update(9, { status: 'published' } as never));
});

test('articles.fix and articles.regenerate POST to their action routes', async () => {
  const { fetch, calls } = recordingFetch(
    () => new Response(JSON.stringify({ status: 'queued' }), { status: 201 }),
  );
  const client = createClient({ apiKey: 'k-test', fetch });

  await client.content.articles.fix('11111111-2222-4333-8444-555555555555');
  await client.content.articles.regenerate(9);
  await client.content.articles.regenerate(9, { feedback: '  Strengthen the evidence.  ' });

  assert.match(
    calls[0].url,
    /\/api\/v1\/content\/articles\/11111111-2222-4333-8444-555555555555\/fix$/,
  );
  assert.equal(calls[0].init.method, 'POST');
  assert.equal(calls[0].init.body, undefined);

  assert.match(calls[1].url, /\/api\/v1\/content\/articles\/9\/regenerate$/);
  assert.deepEqual(JSON.parse(String(calls[1].init.body)), {});
  assert.deepEqual(JSON.parse(String(calls[2].init.body)), {
    feedback: 'Strengthen the evidence.',
  });
  for (const call of calls) {
    assert.ok(headerValue(call.init, 'Idempotency-Key'));
  }

  assert.throws(() =>
    client.content.articles.regenerate(9, { feedback: 'x'.repeat(4001) }),
  );
});

test('topics.update PATCHes, validates the status enum, and passes rejectedReason through', async () => {
  const { fetch, calls } = recordingFetch(
    () => new Response(JSON.stringify({ topic: { id: 3, status: 'rejected' } }), { status: 200 }),
  );
  const client = createClient({ apiKey: 'k-test', fetch });

  await client.content.topics.update(3, { status: 'rejected', rejectedReason: 'off-brand' });

  const { init, url } = calls[0];
  assert.equal(init.method, 'PATCH');
  assert.match(url, /\/api\/v1\/content\/topics\/3$/);
  assert.ok(headerValue(init, 'Idempotency-Key'), 'expected an Idempotency-Key header on PATCH');
  assert.deepEqual(JSON.parse(String(init.body)), { status: 'rejected', rejectedReason: 'off-brand' });

  assert.throws(() => client.content.topics.update(3, { status: 'bogus' } as never));
});

test('providers.list GETs /api/v1/monitoring/providers and parses the { providers:[...] } shape', async () => {
  const payload = {
    providers: [
      { key: 'openai', name: 'OpenAI', category: 'search', costTier: 'standard', description: 'GPT search.' },
      { key: 'claude-code', name: 'Claude Code', category: 'agent', costTier: 'premium', description: 'Coding harness.' },
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
  assert.equal(result.providers[1].key, 'claude-code');
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
