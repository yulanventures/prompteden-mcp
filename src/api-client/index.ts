/**
 * Typed PromptEden REST client used by the MCP server.
 *
 * Re-exports the client factory, the route manifest, the zod write and
 * onboarding schemas plus inferred types, and ApiError.
 */

export { createClient } from './client.js';
export type {
  CreateClientOptions,
  PromptEdenClient,
  ResultsQuery,
  ProjectQuery,
  ContentListQuery,
  NewsroomProjectQuery,
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
  createTopicSchema,
  generateArticleSchema,
  regenerateArticleSchema,
  updateArticleSchema,
  updateTopicSchema,
  createNewsroomSetupSchema,
  applyNewsroomSetupSchema,
  agentSignUpSchema,
  agentSignInSchema,
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
  CreateTopicInput,
  GenerateArticleInput,
  RegenerateArticleInput,
  UpdateArticleInput,
  UpdateTopicInput,
  CreateNewsroomSetupInput,
  ApplyNewsroomSetupInput,
  AgentSignUpInput,
  AgentSignInInput,
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
