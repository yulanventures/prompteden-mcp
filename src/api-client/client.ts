/**
 * The PromptEden API client used by the MCP server.
 *
 * Responsibilities:
 *  - URL building from a base URL + path + query (URLSearchParams).
 *  - Bearer auth. Every call requires an API key.
 *  - Idempotency-Key on writes (one key per logical request, reused on retry).
 *  - Per-attempt AbortController timeout.
 *  - Retry on 429 / 5xx with exponential backoff honouring Retry-After.
 *  - ApiError on a non-OK response after retries, with status/body/path.
 *  - Tolerant JSON parsing (empty / non-JSON bodies become null / { message }).
 */

import { randomUUID } from 'node:crypto';
import { ApiError } from './errors.js';
import {
  createAnalyticsGoalSchema,
  createAnalyticsPropertySchema,
  addAnalyticsPropertyHostSchema,
  type AddAnalyticsPropertyHostInput,
  rotateAnalyticsPropertyKeySchema,
  startAnalyticsVerificationSchema,
  createMonitorSchema,
  createProjectSchema,
  type CreateAnalyticsGoalInput,
  type CreateAnalyticsPropertyInput,
  type RotateAnalyticsPropertyKeyInput,
  type StartAnalyticsVerificationInput,
  type CreateMonitorInput,
  type CreateProjectInput,
} from "./schemas.js";

const DEFAULT_BASE_URL = 'https://app.prompteden.com';
const CLIENT_VERSION = '0.1.0';
const USER_AGENT = `@prompteden/api-client/${CLIENT_VERSION}`;
const DEFAULT_TIMEOUT_MS = 30_000;
const DEFAULT_RETRIES = 2;
const BASE_BACKOFF_MS = 250;

export type CreateClientOptions = {
  baseUrl?: string;
  apiKey?: string;
  fetch?: typeof fetch;
  timeoutMs?: number;
  retries?: number;
};

type QueryValue = string | number | boolean | undefined | null;

type RequestOptions = {
  body?: unknown;
  query?: Record<string, QueryValue>;
  requiresAuth?: boolean;
  /**
   * Per-call retry override. Key rotation sets 0: a rotate response carries a
   * one-time raw key, so the client must never silently re-fire it — the
   * caller decides whether to retry (a retry is a fresh rotation).
   */
  retries?: number;
};

export type ResultsQuery = {
  limit?: number;
  offset?: number;
  since?: string;
};

export type ProjectQuery = {
  projectId: number;
};

/** Project reference accepted by analytics routes. */
export type ProjectRefQuery = {
  projectId?: number;
  projectUuid?: string;
};

/**
 * Analytics target: explicit propertyId is primary; a project reference is the
 * exactly-one fallback (the server returns 409 property_scope_ambiguous rather
 * than picking silently).
 */
export type AnalyticsProjectQuery = ProjectRefQuery & {
  propertyId?: number;
};

/**
 * Traffic report query. Date range and filters mirror the UI route: `range`
 * is a day count (1–180, default 30), or `from`/`to` ISO dates; `tz` is an
 * IANA time zone; engine/source/evidence are optional filters.
 */
export type AnalyticsTrafficQuery = AnalyticsProjectQuery & {
  range?: number;
  from?: string;
  to?: string;
  tz?: string;
  engine?: string;
  source?: string;
  evidence?: 'observed' | 'provider_utm' | 'observed_referrer';
};

/** Overview/goals share the traffic date-range params, without its filters. */
export type AnalyticsRangeQuery = AnalyticsProjectQuery & {
  range?: number;
  from?: string;
  to?: string;
  tz?: string;
};

export type PromptEdenClient = {
  account: {
    get(): Promise<unknown>;
  };
  monitors: {
    list(): Promise<unknown>;
    create(input: CreateMonitorInput): Promise<unknown>;
    results(monitorId: string, query?: ResultsQuery): Promise<unknown>;
  };
  providers: {
    list(): Promise<unknown>;
  };
  projects: {
    list(): Promise<unknown>;
    create(input: CreateProjectInput): Promise<unknown>;
    get(projectId: number | string): Promise<unknown>;
  };
  analytics: {
    property: {
      get(query: AnalyticsProjectQuery): Promise<unknown>;
      create(input: CreateAnalyticsPropertyInput): Promise<unknown>;
      addHost(input: AddAnalyticsPropertyHostInput): Promise<unknown>;
      rotateKey(input: RotateAnalyticsPropertyKeyInput): Promise<unknown>;
    };
    verification: {
      get(query: AnalyticsProjectQuery): Promise<unknown>;
      start(input: StartAnalyticsVerificationInput): Promise<unknown>;
    };
    traffic: {
      get(query: AnalyticsTrafficQuery): Promise<unknown>;
    };
    overview: {
      get(query: AnalyticsRangeQuery): Promise<unknown>;
    };
    goals: {
      list(query: AnalyticsRangeQuery): Promise<unknown>;
      create(input: CreateAnalyticsGoalInput): Promise<unknown>;
      archive(
        goalId: number | string,
        query: AnalyticsProjectQuery,
      ): Promise<unknown>;
    };
  };
  agent: {
    status(): Promise<unknown>;
  };
};

const ALLOWED_BASE_ORIGIN = "https://app.prompteden.com";

function normalizeBaseUrl(value: string): string {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new Error(
      `createClient: baseUrl must be a valid URL. The only allowed origin is ${ALLOWED_BASE_ORIGIN}.`,
    );
  }
  const origin = url.origin;
  if (url.username || url.password || origin !== ALLOWED_BASE_ORIGIN) {
    throw new Error(
      `createClient: baseUrl origin ${origin || value} is not allowed. Use ${ALLOWED_BASE_ORIGIN}.`,
    );
  }
  if (url.pathname !== "/" && url.pathname !== "") {
    throw new Error(
      `createClient: baseUrl must be ${ALLOWED_BASE_ORIGIN} with no path.`,
    );
  }
  if (url.search || url.hash) {
    throw new Error(
      `createClient: baseUrl must be ${ALLOWED_BASE_ORIGIN} with no query or hash.`,
    );
  }
  // A trailing slash is load-bearing for `new URL(path, base)`.
  url.pathname = "/";
  url.search = "";
  url.hash = "";
  return url.toString();
}

async function parseBody(response: Response): Promise<unknown> {
  const text = await response.text();
  if (!text) return null;
  try {
    return JSON.parse(text) as unknown;
  } catch {
    return { message: text };
  }
}

// Cap any retry wait so a hostile/buggy Retry-After (e.g. "3600") can't hang the
// caller for an hour. 30s is well above any reasonable rate-limit window.
const MAX_RETRY_DELAY_MS = 30_000;

function retryDelayMs(response: Response, attempt: number): number {
  const header = response.headers.get('retry-after');
  if (header !== null) {
    const seconds = Number(header);
    if (Number.isFinite(seconds)) return Math.min(MAX_RETRY_DELAY_MS, Math.max(0, seconds * 1000));
    const dateMs = Date.parse(header);
    if (Number.isFinite(dateMs)) return Math.min(MAX_RETRY_DELAY_MS, Math.max(0, dateMs - Date.now()));
  }
  return Math.min(MAX_RETRY_DELAY_MS, BASE_BACKOFF_MS * 2 ** attempt);
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export function createClient(options: CreateClientOptions = {}): PromptEdenClient {
  const baseUrl = normalizeBaseUrl(options.baseUrl ?? DEFAULT_BASE_URL);
  const apiKey = options.apiKey;
  const fetchImpl = options.fetch ?? globalThis.fetch;
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const retries = options.retries ?? DEFAULT_RETRIES;

  if (typeof fetchImpl !== 'function') {
    throw new Error('createClient: no fetch implementation available. Pass options.fetch.');
  }

  async function request(
    method: 'GET' | 'POST' | 'PATCH' | 'DELETE',
    path: string,
    opts: RequestOptions = {},
  ): Promise<unknown> {
    const { body, query, requiresAuth = true, retries: retriesOverride } = opts;
    const maxRetries = retriesOverride ?? retries;

    if (requiresAuth && !apiKey) {
      throw new Error(
        `PromptEden API key required to call ${method} ${path}. ` +
          "Create an account on the web, then pass an API key from Settings > API Keys.",
      );
    }

    const url = new URL(path.replace(/^\//, ''), baseUrl);
    if (query) {
      for (const [key, value] of Object.entries(query)) {
        if (value !== undefined && value !== null) url.searchParams.set(key, String(value));
      }
    }

    const hasBody = body !== undefined;
    const isWrite = method === 'POST' || method === 'PATCH' || method === 'DELETE';

    const headers: Record<string, string> = {
      Accept: 'application/json',
      'User-Agent': USER_AGENT,
    };
    if (apiKey) headers.Authorization = `Bearer ${apiKey}`;
    if (hasBody) headers['Content-Type'] = 'application/json';
    // One idempotency key per logical request; reused across retries so the
    // server can dedupe a retried write.
    if (isWrite) headers['Idempotency-Key'] = randomUUID();

    const serialized = hasBody ? JSON.stringify(body) : undefined;

    let attempt = 0;
    for (;;) {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), timeoutMs);
      let response: Response;
      try {
        response = await fetchImpl(url, {
          method,
          headers,
          body: serialized,
          signal: controller.signal,
        });
      } finally {
        clearTimeout(timer);
      }

      if (response.ok) return parseBody(response);

      const retryable = response.status === 429 || response.status >= 500;
      if (retryable && attempt < maxRetries) {
        await sleep(retryDelayMs(response, attempt));
        attempt += 1;
        continue;
      }

      const errorBody = await parseBody(response);
      throw new ApiError(response.status, errorBody, path);
    }
  }

  return {
    account: {
      get: () => request("GET", "/api/v1/account"),
    },
    monitors: {
      list: () => request("GET", "/api/v1/monitors"),
      create: (input) =>
        request("POST", "/api/v1/monitors", {
          body: createMonitorSchema.parse(input),
        }),
      results: (monitorId, query) =>
        request(
          "GET",
          `/api/v1/monitors/${encodeURIComponent(monitorId)}/results`,
          {
            query: query as Record<string, QueryValue> | undefined,
          },
        ),
    },
    providers: {
      // Read-only catalog of monitor providers. requiresAuth defaults true, so
      // the shared bearer/scope handling (monitors:read) applies; no params.
      list: () => request("GET", "/api/v1/monitoring/providers"),
    },
    projects: {
      list: () => request("GET", "/api/v1/projects"),
      create: (input) =>
        request("POST", "/api/v1/projects", {
          body: createProjectSchema.parse(input),
        }),
      get: (projectId) =>
        request(
          "GET",
          `/api/v1/projects/${encodeURIComponent(String(projectId))}`,
        ),
    },
    analytics: {
      property: {
        get: (query) =>
          request("GET", "/api/v1/analytics/property", {
            query: {
              propertyId: query.propertyId,
              projectId: query.projectId,
              projectUuid: query.projectUuid,
            },
          }),
        addHost: (input) =>
          request("PATCH", "/api/v1/analytics/property", {
            body: addAnalyticsPropertyHostSchema.parse(input),
          }),
        // retries: 0 for the same reason as rotateKey: the create response
        // carries the one-time siteKey. A caller-driven retry recovers via
        // 409 property_exists (then rotate for a fresh key).
        create: (input) =>
          request("POST", "/api/v1/analytics/property", {
            body: createAnalyticsPropertySchema.parse(input),
            retries: 0,
          }),
        // retries: 0 — the response carries a one-time raw key; never
        // auto-refire a rotation. A caller-driven retry is a fresh rotation.
        rotateKey: (input) =>
          request("POST", "/api/v1/analytics/property/key/rotate", {
            body: rotateAnalyticsPropertyKeySchema.parse(input),
            retries: 0,
          }),
      },
      verification: {
        get: (query) =>
          request("GET", "/api/v1/analytics/property/verification", {
            query: {
              propertyId: query.propertyId,
              projectId: query.projectId,
              projectUuid: query.projectUuid,
            },
          }),
        start: (input) =>
          request("POST", "/api/v1/analytics/property/verification", {
            body: startAnalyticsVerificationSchema.parse(input),
          }),
      },
      traffic: {
        get: (query) =>
          request("GET", "/api/v1/analytics/traffic", {
            query: {
              propertyId: query.propertyId,
              projectId: query.projectId,
              projectUuid: query.projectUuid,
              range: query.range,
              from: query.from,
              to: query.to,
              tz: query.tz,
              engine: query.engine,
              source: query.source,
              evidence: query.evidence,
            },
          }),
      },
      overview: {
        get: (query) =>
          request("GET", "/api/v1/analytics/overview", {
            query: {
              propertyId: query.propertyId,
              projectId: query.projectId,
              projectUuid: query.projectUuid,
              range: query.range,
              from: query.from,
              to: query.to,
              tz: query.tz,
            },
          }),
      },
      goals: {
        list: (query) =>
          request("GET", "/api/v1/analytics/goals", {
            query: {
              propertyId: query.propertyId,
              projectId: query.projectId,
              projectUuid: query.projectUuid,
              range: query.range,
              from: query.from,
              to: query.to,
              tz: query.tz,
            },
          }),
        create: (input) =>
          request("POST", "/api/v1/analytics/goals", {
            body: createAnalyticsGoalSchema.parse(input),
          }),
        archive: (goalId, query) =>
          request(
            "DELETE",
            `/api/v1/analytics/goals/${encodeURIComponent(String(goalId))}`,
            {
              query: {
                propertyId: query.propertyId,
                projectId: query.projectId,
                projectUuid: query.projectUuid,
              },
            },
          ),
      },
    },
    agent: {
      status: () => request("GET", "/api/v1/agent/status"),
    },
  };
}
