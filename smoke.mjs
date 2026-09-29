import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import http from 'node:http';
import { readFileSync } from 'node:fs';
import { createInterface } from 'node:readline';

// The MCP TypeScript SDK owns the wire protocol now. This smoke drives the
// BUNDLED single-file server (dist/index.mjs) over stdio and asserts the
// SDK-negotiated behaviour: the protocol version it advertises, graceful
// fallback, the full tool catalog (with annotations + outputSchema on the
// stable reads), tool-execution failures surfacing as isError results (not
// JSON-RPC errors), ping, and stdout purity. Where the SDK's correct behaviour
// differs from the previous hand-rolled server, the assertion is adapted and
// the change is documented inline (see "ADAPTED:" comments).

const SERVER_ENTRY = 'dist/index.mjs';

// The protocol version the installed SDK advertises as LATEST. initialize
// echoes a client-requested supported version, otherwise falls back to this.
const SDK_LATEST_PROTOCOL = '2025-11-25';

const fakeApiKey = 'prompteden-test-key-not-secret';
// Read the published version so the serverInfo.version assertion catches drift
// between package.json and the SERVER_VERSION constant in src/index.ts.
const packageVersion = JSON.parse(readFileSync(new URL('./package.json', import.meta.url), 'utf8')).version;
const requests = [];

const server = http.createServer(async (request, response) => {
  const chunks = [];
  for await (const chunk of request) chunks.push(chunk);
  const rawBody = Buffer.concat(chunks).toString('utf8');
  const url = new URL(request.url ?? '/', 'http://127.0.0.1');
  const body = rawBody ? JSON.parse(rawBody) : null;
  const { pathname } = url;

  requests.push({
    method: request.method,
    path: pathname,
    search: url.search,
    authorization: request.headers.authorization,
    contentType: request.headers['content-type'],
    idempotencyKey: request.headers['idempotency-key'],
    body,
  });

  response.setHeader('content-type', 'application/json');

  if (request.method === 'GET' && pathname === '/api/v1/account') {
    response.end(JSON.stringify({ team: { name: 'Smoke Team' }, plan: 'pro' }));
    return;
  }
  if (request.method === 'GET' && pathname === '/api/v1/projects') {
    response.end(JSON.stringify({ projects: [{ slug: 'smoke' }] }));
    return;
  }
  if (request.method === 'POST' && pathname === '/api/v1/projects') {
    response.statusCode = 201;
    response.end(
      JSON.stringify({
        project: { slug: 'smoke', websiteUrl: body.websiteUrl },
      }),
    );
    return;
  }
  // get_project (P2 parity): GET /api/v1/projects/:projectId
  if (request.method === 'GET' && /^\/api\/v1\/projects\/[^/]+$/.test(pathname)) {
    response.end(
      JSON.stringify({
        project: { id: pathname.split('/').pop(), slug: 'smoke' },
      }),
    );
    return;
  }
  if (request.method === 'GET' && pathname === '/api/v1/monitors') {
    response.end(JSON.stringify({ monitors: [{ uuid: 'monitor-smoke' }] }));
    return;
  }
  if (request.method === 'POST' && pathname === '/api/v1/monitors') {
    response.statusCode = 201;
    response.end(JSON.stringify({ uuid: 'created-monitor', name: body.name }));
    return;
  }
  if (request.method === 'GET' && pathname === '/api/v1/monitors/monitor-smoke/results') {
    response.end(
      JSON.stringify({
        results: [{ id: 'result-smoke', response: 'Full answer text.' }],
      }),
    );
    return;
  }
  // list_providers (P2c): GET /api/v1/monitoring/providers — read-only catalog.
  if (request.method === 'GET' && pathname === '/api/v1/monitoring/providers') {
    // Documented provider fields plus the extra fields the route returns
    // (defaultModel/supportsRegion/displayOrder/enabled), so the tool's
    // outputSchema tolerates the production payload.
    response.end(
      JSON.stringify({
        providers: [
          {
            key: 'openai',
            name: 'OpenAI',
            category: 'search',
            costTier: 'standard',
            description: 'GPT search.',
            defaultModel: 'gpt-4o-mini',
            supportsRegion: true,
            displayOrder: 1,
            enabled: true,
          },
          {
            key: 'claude-code',
            name: 'Claude Code',
            category: 'agent',
            costTier: 'premium',
            description: 'Coding harness.',
            defaultModel: 'claude-opus-4-8',
            supportsRegion: false,
            displayOrder: 10,
            enabled: true,
          },
        ],
      }),
    );
    return;
  }
  if (pathname === '/api/v1/displacement-scan/preview') {
    response.end(
      JSON.stringify({
        source: request.method === 'POST' ? 'posted' : 'fixture',
        result: {
          verdict: 'displaced',
          actionOpportunities: [{ targetCompetitor: 'CompetitorRank' }],
        },
      }),
    );
    return;
  }
  if (request.method === 'GET' && pathname === '/api/v1/content/topics') {
    response.end(JSON.stringify({ topics: [{ id: 42, primaryKeyword: 'agent seo' }] }));
    return;
  }
  if (request.method === 'POST' && pathname === '/api/v1/content/topics') {
    response.statusCode = 201;
    response.end(
      JSON.stringify({
        topic: {
          id: 43,
          projectId: body.projectId,
          primaryKeyword: body.primaryKeyword,
        },
      }),
    );
    return;
  }
  // content_update_topic (P2 parity): PATCH /api/v1/content/topics/:topicId
  if (request.method === 'PATCH' && /^\/api\/v1\/content\/topics\/[^/]+$/.test(pathname)) {
    response.end(
      JSON.stringify({
        topic: {
          id: pathname.split('/').pop(),
          status: body.status,
          rejectedReason: body.rejectedReason ?? null,
        },
      }),
    );
    return;
  }
  if (request.method === 'GET' && pathname === '/api/v1/content/articles') {
    response.end(JSON.stringify({ articles: [{ id: 99, title: 'Agent SEO Guide' }] }));
    return;
  }
  if (request.method === 'POST' && pathname === '/api/v1/content/articles') {
    response.statusCode = 201;
    response.end(
      JSON.stringify({
        article: {
          id: 100,
          projectId: body.projectId,
          topicId: body.topicId,
          status: 'generating',
        },
      }),
    );
    return;
  }
  if (request.method === 'POST' && pathname === '/api/v1/content/articles/99/publish') {
    response.end(JSON.stringify({ article: { id: 99, status: 'published' } }));
    return;
  }
  if (request.method === 'POST' && pathname === '/api/v1/content/articles/99/fix') {
    response.statusCode = 201;
    response.end(JSON.stringify({ job: { id: 501, status: 'queued' } }));
    return;
  }
  if (request.method === 'POST' && pathname === '/api/v1/content/articles/99/regenerate') {
    response.statusCode = 201;
    response.end(
      JSON.stringify({ article: { id: 99, status: 'generating', feedback: body.feedback } }),
    );
    return;
  }
  // content_update_article (P2 parity): PATCH /api/v1/content/articles/:articleId
  if (request.method === 'PATCH' && /^\/api\/v1\/content\/articles\/[^/]+$/.test(pathname)) {
    response.end(
      JSON.stringify({
        article: { id: pathname.split('/').pop(), status: body.status },
      }),
    );
    return;
  }
  // content_get_article (P2 parity): GET /api/v1/content/articles/:articleId
  if (request.method === 'GET' && /^\/api\/v1\/content\/articles\/[^/]+$/.test(pathname)) {
    response.end(
      JSON.stringify({
        article: {
          id: pathname.split('/').pop(),
          status: 'generating',
          generationJob: { state: 'running' },
        },
      }),
    );
    return;
  }
  if (request.method === 'GET' && pathname === '/api/v1/content/newsroom/setups') {
    response.end(
      JSON.stringify({
        setup: { id: 12, status: 'ready', goal: 'Own the category' },
      }),
    );
    return;
  }
  if (request.method === 'POST' && pathname === '/api/v1/content/newsroom/setups') {
    response.statusCode = 201;
    response.end(
      JSON.stringify({
        setup: { id: 12, status: 'queued', goal: body.goal },
      }),
    );
    return;
  }
  if (request.method === 'GET' && /^\/api\/v1\/content\/newsroom\/setups\/[^/]+$/.test(pathname)) {
    response.end(
      JSON.stringify({
        setup: { id: pathname.split('/').pop(), status: 'ready', goal: 'Own the category' },
      }),
    );
    return;
  }
  if (request.method === 'POST' && /^\/api\/v1\/content\/newsroom\/setups\/[^/]+\/apply$/.test(pathname)) {
    response.end(
      JSON.stringify({
        result: { activatedAgentIds: [501] },
        setup: { id: pathname.split('/').at(-2), status: 'applied' },
      }),
    );
    return;
  }
  if (request.method === 'POST' && /^\/api\/v1\/content\/newsroom\/setups\/[^/]+\/dismiss$/.test(pathname)) {
    response.end(
      JSON.stringify({
        setup: { id: pathname.split('/').at(-2), status: 'dismissed' },
      }),
    );
    return;
  }
  // Agent onboarding endpoints. sign-up / sign-in MINT a key and require no
  // Authorization header; status requires the key.
  if (request.method === 'POST' && pathname === '/api/v1/agent/sign-up') {
    response.statusCode = 201;
    response.end(
      JSON.stringify({
        apiKey: 'pe_minted_signup_key',
        agent: { name: body?.agentName },
      }),
    );
    return;
  }
  if (request.method === 'POST' && pathname === '/api/v1/agent/sign-in') {
    response.end(
      JSON.stringify({
        apiKey: 'pe_minted_signin_key',
        keyName: body?.keyName ?? null,
      }),
    );
    return;
  }
  if (request.method === 'GET' && pathname === '/api/v1/agent/status') {
    response.end(JSON.stringify({ status: 'active', agentName: 'Smoke Agent' }));
    return;
  }

  response.statusCode = 404;
  response.end(JSON.stringify({ error: 'not_found' }));
});

function listen(server) {
  return new Promise((resolve) => {
    server.listen(0, '127.0.0.1', () => resolve(server.address()));
  });
}

function close(server) {
  return new Promise((resolve, reject) => {
    server.close((error) => (error ? reject(error) : resolve()));
  });
}

function startMcp(baseUrl, { withKey = true } = {}) {
  const env = {
    ...process.env,
    PROMPTEDEN_BASE_URL: baseUrl,
  };
  // Some cases (agent_sign_up before a key exists) must run with NO key in the
  // environment — delete any inherited value rather than leave it set.
  if (withKey) env.PROMPTEDEN_API_KEY = fakeApiKey;
  else delete env.PROMPTEDEN_API_KEY;

  const child = spawn(process.execPath, [SERVER_ENTRY], {
    env,
    stdio: ['pipe', 'pipe', 'pipe'],
  });

  const lines = [];
  const rawLines = [];
  const badLines = [];
  const rl = createInterface({ input: child.stdout });
  rl.on('line', (line) => {
    rawLines.push(line);
    try {
      lines.push(JSON.parse(line));
    } catch {
      badLines.push(line);
    }
  });

  let stderr = '';
  child.stderr.on('data', (chunk) => {
    stderr += chunk;
  });

  return { child, lines, rawLines, badLines, stderr: () => stderr };
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

// A valid MCP initialize params block. The SDK enforces InitializeRequestSchema
// (protocolVersion is required), so — unlike the previous hand-rolled server —
// initialize can no longer be called with empty params.
function initParams(protocolVersion = SDK_LATEST_PROTOCOL) {
  return {
    protocolVersion,
    capabilities: {},
    clientInfo: { name: 'smoke', version: '0.0.0' },
  };
}

async function send(mcp, id, method, params) {
  mcp.child.stdin.write(`${JSON.stringify({ jsonrpc: '2.0', id, method, params })}\n`);
  const line = await waitForLine(mcp.lines, id);
  assert.equal(line.error, undefined, line.error?.message);
  return line.result;
}

// Like send(), but does NOT assert on the JSON-RPC error field — for negative
// cases that legitimately return an error envelope. Returns the full line.
async function sendRaw(mcp, id, method, params) {
  mcp.child.stdin.write(`${JSON.stringify({ jsonrpc: '2.0', id, method, params })}\n`);
  return waitForLine(mcp.lines, id);
}

// Perform the MCP initialize/initialized handshake, then resolve.
async function handshake(mcp, id) {
  const result = await send(mcp, id, 'initialize', initParams());
  mcp.child.stdin.write(`${JSON.stringify({ jsonrpc: '2.0', method: 'notifications/initialized' })}\n`);
  return result;
}

async function callTool(mcp, id, name, args = {}) {
  const result = await send(mcp, id, 'tools/call', { name, arguments: args });
  assert.equal(result.content[0].type, 'text');
  assert.equal(result.content[0].text.includes(fakeApiKey), false);
  return JSON.parse(result.content[0].text);
}

const EXPECTED_TOOLS = [
  'get_account',
  'list_monitors',
  'create_monitor',
  'get_results',
  'list_providers',
  'list_projects',
  'create_project',
  'content_list_topics',
  'content_create_topic',
  'content_list_articles',
  'content_generate_article',
  'content_publish_article',
  'article_fix',
  'article_regenerate',
  'preview_displacement_scan',
  'agent_sign_up',
  'agent_sign_in',
  'agent_status',
  'check_approval',
  // P2 parity tools.
  'get_project',
  'content_get_article',
  'content_update_article',
  'content_update_topic',
  // Newsroom setup parity tools.
  'newsroom_setup_propose',
  'newsroom_setup_get',
  'newsroom_setup_apply',
  'newsroom_setup_dismiss',
  // Analytics agent-surface parity tools.
  'analytics_get_property',
  'analytics_get_verification',
  'analytics_get_traffic',
  'analytics_get_overview',
  'analytics_list_goals',
  'analytics_add_property_host',
  'analytics_create_property',
  'analytics_rotate_key',
  'analytics_verify_property',
  'analytics_create_goal',
  'analytics_archive_goal',
];

// Read tools that declare an outputSchema + return structuredContent.
const OUTPUT_SCHEMA_TOOLS = ['get_account', 'list_monitors', 'agent_status', 'list_providers'];

const address = await listen(server);
const baseUrl = `http://127.0.0.1:${address.port}`;
const mcp = startMcp(baseUrl);

// Extra fixtures for the agent-onboarding and real-error cases. Declared here
// so the finally block can always tear them down.
let noKeyMcp;
let notFoundServer;
let notFoundMcp;

try {
  // --- initialize / negotiation -------------------------------------------
  // ADAPTED: the SDK negotiates the protocol version (it OWNS this now). We
  // adopt whatever it advertises rather than hand-forcing a constant. The
  // installed SDK's LATEST is SDK_LATEST_PROTOCOL.
  const initialized = await handshake(mcp, 1);
  assert.equal(initialized.serverInfo.name, 'prompteden-mcp');
  assert.equal(initialized.protocolVersion, SDK_LATEST_PROTOCOL);

  const listed = await send(mcp, 2, 'tools/list', {});
  const names = listed.tools.map((tool) => tool.name);
  // Every expected tool (original + approval polling + P2 parity) is present.
  for (const expected of EXPECTED_TOOLS) {
    assert.ok(names.includes(expected), `tools/list missing ${expected}`);
  }
  assert.equal(listed.tools.length, EXPECTED_TOOLS.length, `unexpected tool count: ${names.join(',')}`);

  // Annotations are present on every tool, and outputSchema on the stable reads.
  for (const tool of listed.tools) {
    assert.equal(typeof tool.annotations, 'object', `${tool.name} missing annotations`);
    assert.equal(typeof tool.annotations.openWorldHint, 'boolean', `${tool.name} missing openWorldHint`);
    assert.ok(tool.inputSchema && tool.inputSchema.type === 'object', `${tool.name} bad inputSchema`);
    const isRead = /^(get_|list_)/.test(tool.name) || tool.name.endsWith('_status') || tool.name.startsWith('preview') || tool.name === 'content_get_article' || tool.name === 'content_list_topics' || tool.name === 'content_list_articles' || tool.name === 'newsroom_setup_get';
    if (isRead) {
      assert.equal(tool.annotations.readOnlyHint, true, `${tool.name} should be readOnly`);
    }
  }
  for (const name of OUTPUT_SCHEMA_TOOLS) {
    const tool = listed.tools.find((t) => t.name === name);
    assert.ok(tool.outputSchema && tool.outputSchema.type === 'object', `${name} should advertise an outputSchema`);
  }
  // content_get_article's description must flag async generation.
  const getArticle = listed.tools.find((t) => t.name === 'content_get_article');
  assert.ok(/async/i.test(getArticle.description), 'content_get_article must document ASYNC generation');

  // --- happy-path tool calls (fixed request trace) ------------------------
  const account = await callTool(mcp, 3, 'get_account');
  assert.equal(account.team.name, 'Smoke Team');
  await callTool(mcp, 4, 'list_projects');
  await callTool(mcp, 5, 'create_project', {
    websiteUrl: 'https://example.com',
    name: 'Example',
  });
  await callTool(mcp, 6, 'list_monitors');
  await callTool(mcp, 7, 'create_monitor', {
    projectSlug: 'smoke',
    name: 'Daily visibility',
    type: 'search',
    language: 'en',
    country: 'US',
    cadenceMinutes: 1440,
    promptInstructions: 'Track PromptEden',
    targets: [{ providerKey: 'openai', model: 'gpt-4o-mini' }],
  });
  await callTool(mcp, 8, 'get_results', {
    monitorId: 'monitor-smoke',
    limit: 25,
    offset: 5,
  });
  await callTool(mcp, 9, 'preview_displacement_scan');
  await callTool(mcp, 10, 'content_list_topics', { projectId: 107 });
  await callTool(mcp, 11, 'content_create_topic', {
    projectId: 107,
    primaryKeyword: 'agent seo',
    title: 'Agent SEO',
    notes: 'Prioritize examples',
  });
  await callTool(mcp, 12, 'content_list_articles', { projectId: 107 });
  await callTool(mcp, 13, 'content_generate_article', {
    projectId: 107,
    topicId: 43,
  });
  await callTool(mcp, 14, 'content_publish_article', { articleId: 99 });

  const observed = requests.map((request) => `${request.method} ${request.path}${request.search}`);
  assert.deepEqual(observed, ['GET /api/v1/account', 'GET /api/v1/projects', 'POST /api/v1/projects', 'GET /api/v1/monitors', 'POST /api/v1/monitors', 'GET /api/v1/monitors/monitor-smoke/results?limit=25&offset=5', 'GET /api/v1/displacement-scan/preview', 'GET /api/v1/content/topics?projectId=107', 'POST /api/v1/content/topics', 'GET /api/v1/content/articles?projectId=107', 'POST /api/v1/content/articles', 'POST /api/v1/content/articles/99/publish']);

  for (const request of requests) {
    assert.equal(request.authorization, `Bearer ${fakeApiKey}`);
  }

  assert.equal(requests[2].contentType, 'application/json');
  assert.equal(requests[2].body.websiteUrl, 'https://example.com');
  assert.equal(requests[4].contentType, 'application/json');
  assert.equal(requests[4].body.projectSlug, 'smoke');
  assert.equal(requests[4].body.targets[0].providerKey, 'openai');
  // Writes carry an Idempotency-Key (set by the shared client).
  assert.equal(typeof requests[4].idempotencyKey, 'string');
  assert.ok(requests[4].idempotencyKey.length > 0);
  assert.equal(requests[8].contentType, 'application/json');
  assert.equal(requests[8].body.projectId, 107);
  assert.equal(requests[8].body.primaryKeyword, 'agent seo');
  assert.equal(requests[8].body.title, 'Agent SEO');
  assert.equal(requests[10].contentType, 'application/json');
  assert.equal(requests[10].body.projectId, 107);
  assert.equal(requests[10].body.topicId, 43);
  assert.equal(mcp.stderr().includes(fakeApiKey), false);

  // --- structuredContent on the stable read tools -------------------------
  // get_account / list_monitors / agent_status declare an outputSchema, so the
  // result carries structuredContent validated by the SDK against that schema.
  const accountResult = await send(mcp, 15, 'tools/call', {
    name: 'get_account',
    arguments: {},
  });
  assert.equal(typeof accountResult.structuredContent, 'object');
  assert.equal(accountResult.structuredContent.team.name, 'Smoke Team');
  const monitorsResult = await send(mcp, 16, 'tools/call', {
    name: 'list_monitors',
    arguments: {},
  });
  assert.ok(Array.isArray(monitorsResult.structuredContent.monitors));

  // --- P2 parity tools (after the fixed trace, so they don't perturb it) --
  const projectGet = await callTool(mcp, 50, 'get_project', { projectId: 55 });
  assert.equal(projectGet.project.id, '55');
  const articleGet = await callTool(mcp, 51, 'content_get_article', {
    articleId: 99,
  });
  assert.equal(articleGet.article.status, 'generating');
  const articleUpdate = await callTool(mcp, 52, 'content_update_article', {
    articleId: 99,
    status: 'approved',
  });
  assert.equal(articleUpdate.article.status, 'approved');
  const articleFix = await callTool(mcp, 65, 'article_fix', { articleId: 99 });
  assert.equal(articleFix.job.status, 'queued');
  const articleRegenerate = await callTool(mcp, 66, 'article_regenerate', {
    articleId: 99,
    feedback: 'Strengthen the evidence.',
  });
  assert.equal(articleRegenerate.article.status, 'generating');
  const topicUpdate = await callTool(mcp, 53, 'content_update_topic', {
    topicId: 42,
    status: 'rejected',
    rejectedReason: 'duplicate keyword',
  });
  assert.equal(topicUpdate.topic.status, 'rejected');
  assert.equal(topicUpdate.topic.rejectedReason, 'duplicate keyword');

  // The P2 routes/verbs landed as expected.
  const p2Trace = requests.map((request) => `${request.method} ${request.path}`).filter((entry) => /\/projects\/55$|\/content\/articles\/99(?:\/fix|\/regenerate)?$|\/content\/topics\/42$/.test(entry));
  assert.deepEqual(p2Trace, ['GET /api/v1/projects/55', 'GET /api/v1/content/articles/99', 'PATCH /api/v1/content/articles/99', 'POST /api/v1/content/articles/99/fix', 'POST /api/v1/content/articles/99/regenerate', 'PATCH /api/v1/content/topics/42']);
  // The PATCH writes are idempotent — still carry an Idempotency-Key.
  const patchArticle = requests.find((r) => r.method === 'PATCH' && r.path === '/api/v1/content/articles/99');
  assert.equal(typeof patchArticle.idempotencyKey, 'string');

  // --- Newsroom setup parity tools -----------------------------------------
  const newsroomStart = requests.length;
  const proposedSetup = await callTool(mcp, 60, 'newsroom_setup_propose', {
    projectSlug: 'smoke',
    goal: 'Own the category',
  });
  assert.equal(proposedSetup.setup.status, 'queued');
  const latestSetup = await callTool(mcp, 61, 'newsroom_setup_get', {
    projectSlug: 'smoke',
  });
  assert.equal(latestSetup.setup.status, 'ready');
  const specificSetup = await callTool(mcp, 62, 'newsroom_setup_get', {
    setupId: 12,
  });
  assert.equal(specificSetup.setup.id, '12');
  const appliedSetup = await callTool(mcp, 63, 'newsroom_setup_apply', {
    setupId: 12,
    writerIndexes: [0],
  });
  assert.equal(appliedSetup.setup.status, 'applied');
  const dismissedSetup = await callTool(mcp, 64, 'newsroom_setup_dismiss', {
    setupId: 12,
  });
  assert.equal(dismissedSetup.setup.status, 'dismissed');

  const newsroomRequests = requests.slice(newsroomStart);
  assert.deepEqual(
    newsroomRequests.map((request) => `${request.method} ${request.path}${request.search}`),
    [
      'POST /api/v1/content/newsroom/setups',
      'GET /api/v1/content/newsroom/setups?projectSlug=smoke',
      'GET /api/v1/content/newsroom/setups/12',
      'POST /api/v1/content/newsroom/setups/12/apply',
      'POST /api/v1/content/newsroom/setups/12/dismiss',
    ],
  );
  assert.deepEqual(newsroomRequests[0].body, {
    projectSlug: 'smoke',
    goal: 'Own the category',
  });
  assert.deepEqual(newsroomRequests[3].body, { writerIndexes: [0] });
  assert.equal(newsroomRequests[4].body, null);
  for (const request of [newsroomRequests[0], newsroomRequests[3], newsroomRequests[4]]) {
    assert.equal(typeof request.idempotencyKey, 'string');
  }

  // --- (P2c) list_providers: read-only catalog with structuredContent ------
  const providersResult = await send(mcp, 54, 'tools/call', {
    name: 'list_providers',
    arguments: {},
  });
  assert.equal(providersResult.content[0].type, 'text');
  assert.ok(Array.isArray(providersResult.structuredContent.providers), 'list_providers must return structuredContent.providers');
  assert.equal(providersResult.structuredContent.providers[0].key, 'openai');
  // Premium agent harness tier is included in the catalog.
  assert.ok(providersResult.structuredContent.providers.some((p) => p.key === 'claude-code' && p.costTier === 'premium'));
  const providersReq = requests.find((r) => r.method === 'GET' && r.path === '/api/v1/monitoring/providers');
  assert.ok(providersReq, 'list_providers must hit GET /api/v1/monitoring/providers');
  assert.equal(providersReq.authorization, `Bearer ${fakeApiKey}`);

  // --- (a) tool-EXECUTION failure -> isError result (NOT a JSON-RPC error) -
  // This call hits the fake server (404 for an unknown monitor), so it runs
  // AFTER the request-trace assertion to keep that trace stable. An api-client
  // ApiError thrown in the handler is converted by the SDK to an isError result.
  const failure = await sendRaw(mcp, 20, 'tools/call', {
    name: 'get_results',
    arguments: { monitorId: 'does-not-exist' },
  });
  assert.equal(failure.error, undefined, 'tool execution failure must not be a JSON-RPC error');
  assert.equal(failure.result.isError, true);
  assert.equal(failure.result.content[0].type, 'text');
  assert.ok(failure.result.content[0].text.includes('404'));
  assert.equal(failure.result.content[0].text.includes('endpoint_unavailable'), false);

  // --- (b) protocol-version negotiation -----------------------------------
  // A supported version is echoed verbatim; an unknown one falls back to LATEST.
  const negotiated = await send(mcp, 21, 'initialize', initParams('2025-06-18'));
  assert.equal(negotiated.protocolVersion, '2025-06-18');
  const fallbackUnknown = await send(mcp, 22, 'initialize', initParams('venus'));
  assert.equal(fallbackUnknown.protocolVersion, SDK_LATEST_PROTOCOL);
  assert.equal(typeof negotiated.instructions, 'string');
  assert.ok(negotiated.instructions.length > 0);
  // ADAPTED: the SDK advertises tools capability as { listChanged: true } (it
  // supports list-changed notifications). The old hand-rolled server returned
  // an empty {}; assert the SDK's richer, correct shape instead.
  assert.equal(typeof negotiated.capabilities.tools, 'object');
  assert.equal(negotiated.capabilities.tools.listChanged, true);
  // serverInfo.version tracks the published package version (guards drift
  // between package.json and the SERVER_VERSION constant in src/tools.ts).
  assert.equal(negotiated.serverInfo.name, 'prompteden-mcp');
  assert.equal(negotiated.serverInfo.version, packageVersion);
  // Every other supported protocol version is echoed verbatim, never downgraded.
  for (const supported of ['2025-11-25', '2025-03-26', '2024-11-05']) {
    const echoed = await send(mcp, `init-${supported}`, 'initialize', initParams(supported));
    assert.equal(echoed.protocolVersion, supported);
  }

  // --- (c) ping returns an empty result object ----------------------------
  const pong = await send(mcp, 24, 'ping', {});
  assert.deepEqual(pong, {});

  // --- (d) unknown METHOD -> JSON-RPC Method not found (-32601) ------------
  const unknownMethod = await sendRaw(mcp, 25, 'definitely/not/a/method', {});
  assert.equal(unknownMethod.result, undefined);
  assert.equal(unknownMethod.error.code, -32601);

  // --- (d2) unknown tool NAME -----------------------------------------------
  // ADAPTED: the previous hand-rolled server treated an unknown tool name as a
  // JSON-RPC protocol fault (-32602). The official SDK instead returns a normal
  // tools/call result with isError:true (it wraps the "tool not found" inside
  // the call result, not the transport envelope). We adopt the SDK behaviour.
  const unknownTool = await sendRaw(mcp, 26, 'tools/call', {
    name: 'no_such_tool',
    arguments: {},
  });
  assert.equal(unknownTool.error, undefined, 'unknown tool is now an isError result, not a JSON-RPC error');
  assert.equal(unknownTool.result.isError, true);

  // --- (d3) invalid tool INPUT ----------------------------------------------
  // ADAPTED (new): the SDK validates arguments against the tool inputSchema and
  // returns an isError result for a bad value (e.g. a status outside the shared
  // enum) — not a JSON-RPC error. The previous server did no input validation.
  const badInput = await sendRaw(mcp, 28, 'tools/call', {
    name: 'content_update_topic',
    arguments: { topicId: 42, status: 'bogus' },
  });
  assert.equal(badInput.error, undefined, 'invalid input is an isError result, not a JSON-RPC error');
  assert.equal(badInput.result.isError, true);
  const badArticleInput = await sendRaw(mcp, 29, 'tools/call', {
    name: 'content_update_article',
    arguments: { articleId: 99, status: 'published' },
  });
  assert.equal(badArticleInput.result.isError, true, "status 'published' is rejected by the update enum");

  // --- (f) a notification (no id) must NEVER receive a response -----------
  mcp.child.stdin.write(`${JSON.stringify({ jsonrpc: '2.0', method: 'some/unknown/notification', params: {} })}\n`);
  const pingAfter = await send(mcp, 27, 'ping', {});
  assert.deepEqual(pingAfter, {});
  assert.equal(
    mcp.lines.some((line) => line.id === null || line.id === undefined),
    false,
    'a notification must not produce a response line',
  );

  // --- (g) agent onboarding on the KEYED server ---------------------------
  const signInResult = await callTool(mcp, 30, 'agent_sign_in', {
    email: 'owner@example.com',
    password: 'password123',
    keyName: 'smoke-key',
  });
  assert.equal(signInResult.apiKey, 'pe_minted_signin_key');
  const statusResult = await callTool(mcp, 31, 'agent_status');
  assert.equal(statusResult.status, 'active');

  // --- (h) agent_sign_up works with NO PROMPTEDEN_API_KEY -----------------
  noKeyMcp = startMcp(baseUrl, { withKey: false });
  await handshake(noKeyMcp, 1);
  const noKeyTools = await send(noKeyMcp, 2, 'tools/list', {});
  assert.equal(noKeyTools.tools.length, EXPECTED_TOOLS.length);
  const signUpResult = await callTool(noKeyMcp, 3, 'agent_sign_up', {
    humanEmail: 'founder@example.com',
    agentName: 'Smoke Agent',
    websiteUrl: 'https://example.com',
  });
  assert.equal(signUpResult.apiKey, 'pe_minted_signup_key');

  // --- (h2) a key-requiring tool with NO key -> isError result ------------
  const noKeyAccount = await sendRaw(noKeyMcp, 4, 'tools/call', {
    name: 'get_account',
    arguments: {},
  });
  assert.equal(noKeyAccount.error, undefined, 'missing-key failure must not be a JSON-RPC error');
  assert.equal(noKeyAccount.result.isError, true);
  assert.ok(noKeyAccount.result.content[0].text.toLowerCase().includes('api key'));

  // --- (i) a real API 404 surfaces as an isError result -------------------
  // A dedicated server that 404s everything proves the projects route (which
  // historically had an allowUnavailable fake-success shim) now errors for real.
  notFoundServer = http.createServer((req, res) => {
    res.statusCode = 404;
    res.setHeader('content-type', 'application/json');
    res.end(JSON.stringify({ error: 'not_found' }));
  });
  const nfAddress = await listen(notFoundServer);
  notFoundMcp = startMcp(`http://127.0.0.1:${nfAddress.port}`);
  await handshake(notFoundMcp, 1);
  const projects404 = await sendRaw(notFoundMcp, 40, 'tools/call', {
    name: 'list_projects',
    arguments: {},
  });
  assert.equal(projects404.error, undefined, 'a real 404 must not be a JSON-RPC error');
  assert.equal(projects404.result.isError, true);
  assert.equal(projects404.result.content[0].text.includes('endpoint_unavailable'), false, 'the fake-success endpoint_unavailable branch must be deleted');
  assert.ok(projects404.result.content[0].text.includes('404'));

  // --- (e) stdout purity: every captured stdout line is valid JSON-RPC 2.0 -
  assert.deepEqual(mcp.badLines, [], `non-JSON stdout line(s): ${mcp.badLines.join(' | ')}`);
  for (const line of mcp.lines) {
    assert.equal(typeof line, 'object');
    assert.notEqual(line, null);
    assert.equal(line.jsonrpc, '2.0');
  }

  process.stdout.write('mcp http smoke ok\n');
} finally {
  for (const child of [mcp, noKeyMcp, notFoundMcp]) {
    if (!child) continue;
    child.child.stdin.end();
    child.child.kill();
  }
  await close(server);
  if (notFoundServer) await close(notFoundServer);
}
