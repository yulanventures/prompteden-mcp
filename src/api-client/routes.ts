/**
 * Route catalog for the REST paths this client calls.
 *
 * `:param` placeholders mark path parameters. `idempotent` is true for reads
 * and for repeatable state transitions; false for creates. `scopes` lists the
 * API-key scopes a route is known to require.
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

  // Read-only catalog of answer engines a monitor target can reference.
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

  // Analytics routes. The property
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

  {
    id: "agent.status",
    method: "GET",
    path: "/api/v1/agent/status",
    idempotent: true,
    scopes: ["account:read"],
  },
];
