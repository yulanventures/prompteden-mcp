/**
 * Typed PromptEden REST client used by the MCP server.
 *
 * Re-exports the client factory, the route manifest, the zod write schemas,
 * inferred types, and ApiError.
 */

export { createClient } from './client.js';
export type {
  CreateClientOptions,
  PromptEdenClient,
  ResultsQuery,
  ProjectQuery,
  ProjectRefQuery,
  AnalyticsProjectQuery,
  AnalyticsTrafficQuery,
  AnalyticsRangeQuery,
} from './client.js';

export { ApiError, renderApiError } from './errors.js';

export { RouteManifest } from './routes.js';
export type { RouteDefinition, HttpMethod } from './routes.js';

export {
  monitorTargetSchema,
  createMonitorSchema,
  createProjectSchema,
  createAnalyticsPropertySchema,
  rotateAnalyticsPropertyKeySchema,
  startAnalyticsVerificationSchema,
  createAnalyticsGoalSchema,
} from './schemas.js';
export type {
  MonitorTarget,
  CreateMonitorInput,
  CreateMonitorPayload,
  CreateProjectInput,
  CreateAnalyticsPropertyInput,
  RotateAnalyticsPropertyKeyInput,
  StartAnalyticsVerificationInput,
  CreateAnalyticsGoalInput,
} from './schemas.js';

export {
  addAnalyticsPropertyHostSchema,
  analyticsNativeOutputHealthSchema,
} from "./schemas.js";
export type { AddAnalyticsPropertyHostInput } from "./schemas.js";
