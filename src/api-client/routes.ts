/**
 * Route catalog for the REST paths this client calls, including agent
 * onboarding.
 *
 * `:param` placeholders mark path parameters. `idempotent` is true for reads
 * and for the pure displacement-scan evaluation; false for state-creating
 * writes. `scopes` lists the API-key scopes a route is known to require (only
 * populated where the server route documents them).
 */

export type HttpMethod = 'GET' | 'POST' | 'PATCH' | 'DELETE';

export type RouteDefinition = {
  id: string;
  method: HttpMethod;
  path: string;
  idempotent: boolean;
  scopes?: string[];
};

export const RouteManifest: readonly RouteDefinition[] = [
  {
    id: "account.get",
    method: "GET",
    path: "/api/v1/account",
    idempotent: true,
  },

  {
    id: "monitors.list",
    method: "GET",
    path: "/api/v1/monitors",
    idempotent: true,
  },
  {
    id: "monitors.create",
    method: "POST",
    path: "/api/v1/monitors",
    idempotent: false,
  },
  {
    id: "monitors.results",
    method: "GET",
    path: "/api/v1/monitors/:monitorId/results",
    idempotent: true,
  },

  // Read-only provider catalog: the AI/agent providers (search engines + agent
  // coding harnesses) a monitor target can reference. Requires monitors:read.
  {
    id: "providers.list",
    method: "GET",
    path: "/api/v1/monitoring/providers",
    idempotent: true,
    scopes: ["monitors:read"],
  },

  {
    id: "projects.list",
    method: "GET",
    path: "/api/v1/projects",
    idempotent: true,
  },
  {
    id: "projects.create",
    method: "POST",
    path: "/api/v1/projects",
    idempotent: false,
  },
  {
    id: "projects.get",
    method: "GET",
    path: "/api/v1/projects/:projectId",
    idempotent: true,
    scopes: ["projects:read"],
  },

  {
    id: "content.topics.list",
    method: "GET",
    path: "/api/v1/content/topics",
    idempotent: true,
    scopes: ["content:read"],
  },
  {
    id: "content.topics.create",
    method: "POST",
    path: "/api/v1/content/topics",
    idempotent: false,
    scopes: ["content:write"],
  },
  {
    id: "content.topics.update",
    method: "PATCH",
    path: "/api/v1/content/topics/:topicId",
    idempotent: true,
    scopes: ["content:write"],
  },
  {
    id: "content.articles.list",
    method: "GET",
    path: "/api/v1/content/articles",
    idempotent: true,
    scopes: ["content:read"],
  },
  {
    id: "content.articles.generate",
    method: "POST",
    path: "/api/v1/content/articles",
    idempotent: false,
    scopes: ["content:write"],
  },
  {
    id: "content.articles.get",
    method: "GET",
    path: "/api/v1/content/articles/:articleId",
    idempotent: true,
    scopes: ["content:read"],
  },
  {
    id: "content.articles.update",
    method: "PATCH",
    path: "/api/v1/content/articles/:articleId",
    idempotent: true,
    scopes: ["content:write"],
  },
  {
    id: "content.articles.publish",
    method: "POST",
    path: "/api/v1/content/articles/:articleId/publish",
    idempotent: false,
    scopes: ["content:write"],
  },
  {
    id: "content.articles.fix",
    method: "POST",
    path: "/api/v1/content/articles/:articleId/fix",
    idempotent: false,
    scopes: ["content:write"],
  },
  {
    id: "content.articles.regenerate",
    method: "POST",
    path: "/api/v1/content/articles/:articleId/regenerate",
    idempotent: false,
    scopes: ["content:write"],
  },
  {
    id: "content.newsroom.setups.list",
    method: "GET",
    path: "/api/v1/content/newsroom/setups",
    idempotent: true,
    scopes: ["content:read"],
  },
  {
    id: "content.newsroom.setups.create",
    method: "POST",
    path: "/api/v1/content/newsroom/setups",
    idempotent: false,
    scopes: ["content:write"],
  },
  {
    id: "content.newsroom.setups.get",
    method: "GET",
    path: "/api/v1/content/newsroom/setups/:setupId",
    idempotent: true,
    scopes: ["content:read"],
  },
  {
    id: "content.newsroom.setups.apply",
    method: "POST",
    path: "/api/v1/content/newsroom/setups/:setupId/apply",
    idempotent: false,
    scopes: ["content:write"],
  },
  {
    id: "content.newsroom.setups.dismiss",
    method: "POST",
    path: "/api/v1/content/newsroom/setups/:setupId/dismiss",
    idempotent: false,
    scopes: ["content:write"],
  },

  // Analytics agent surface (control plane + Traffic read). The property
  // create and key-rotate responses are the ONLY places the raw siteKey
  // crosses the wire. Overview is deliberately absent until URL goals land.
  {
    id: "analytics.property.get",
    method: "GET",
    path: "/api/v1/analytics/property",
    idempotent: true,
    scopes: ["analytics:read"],
  },
  {
    id: "analytics.property.create",
    method: "POST",
    path: "/api/v1/analytics/property",
    idempotent: false,
    scopes: ["analytics:write"],
  },
  {
    id: "analytics.property.addHost",
    method: "PATCH",
    path: "/api/v1/analytics/property",
    idempotent: true,
    scopes: ["analytics:write"],
  },
  {
    id: "analytics.property.rotateKey",
    method: "POST",
    path: "/api/v1/analytics/property/key/rotate",
    idempotent: false,
    scopes: ["analytics:write"],
  },
  {
    id: "analytics.verification.get",
    method: "GET",
    path: "/api/v1/analytics/property/verification",
    idempotent: true,
    scopes: ["analytics:read"],
  },
  {
    id: "analytics.verification.start",
    method: "POST",
    path: "/api/v1/analytics/property/verification",
    idempotent: false,
    scopes: ["analytics:write"],
  },
  {
    id: "analytics.traffic.get",
    method: "GET",
    path: "/api/v1/analytics/traffic",
    idempotent: true,
    scopes: ["analytics:read"],
  },
  {
    id: "analytics.overview.get",
    method: "GET",
    path: "/api/v1/analytics/overview",
    idempotent: true,
    scopes: ["analytics:read"],
  },
  {
    id: "analytics.goals.list",
    method: "GET",
    path: "/api/v1/analytics/goals",
    idempotent: true,
    scopes: ["analytics:read"],
  },
  {
    id: "analytics.goals.create",
    method: "POST",
    path: "/api/v1/analytics/goals",
    idempotent: false,
    scopes: ["analytics:write"],
  },
  // Archive, not destroy: history is preserved, so a repeat is a no-op-ish
  // state transition — idempotent.
  {
    id: "analytics.goals.archive",
    method: "DELETE",
    path: "/api/v1/analytics/goals/:goalId",
    idempotent: true,
    scopes: ["analytics:write"],
  },

  // Displacement-scan preview has two shapes: a GET that returns the
  // deterministic fixture, and a POST that evaluates a supplied payload. Both
  // are side-effect-free evaluations, hence idempotent.
  {
    id: "displacementScan.preview",
    method: "GET",
    path: "/api/v1/displacement-scan/preview",
    idempotent: true,
  },
  {
    id: "displacementScan.previewEvaluate",
    method: "POST",
    path: "/api/v1/displacement-scan/preview",
    idempotent: true,
  },

  // Agent onboarding — sign-up issues an API key in-body and does NOT require
  // an existing key. sign-in remains compatibility-only. status requires a
  // delegated API key or OAuth token.
  {
    id: "agent.signUp",
    method: "POST",
    path: "/api/v1/agent/sign-up",
    idempotent: false,
  },
  {
    id: "agent.signIn",
    method: "POST",
    path: "/api/v1/agent/sign-in",
    idempotent: false,
  },
  {
    id: "agent.status",
    method: "GET",
    path: "/api/v1/agent/status",
    idempotent: true,
    scopes: ["account:read"],
  },
];
