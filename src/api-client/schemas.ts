/**
 * Zod schemas for PromptEden write payloads and agent onboarding request
 * bodies. Monitor defaults (type='search', language='en', country='US') are
 * applied here before the request is sent.
 *
 * `*Input` types are `z.input` (defaults optional for callers); the schemas
 * apply the defaults when parsed before the request is sent.
 */

import { z } from 'zod';

/** A single monitor target. providerKey is required; model/displayName optional. */
export const monitorTargetSchema = z.object({
  providerKey: z.string().min(1),
  model: z.string().min(1).optional(),
  displayName: z.string().min(1).optional(),
});

/**
 * POST /api/v1/monitors payload. Defaults: type='search', language='en',
 * country='US'. Requires either projectSlug or projectId.
 */
export const createMonitorSchema = z
  .object({
    projectSlug: z.string().min(1).optional(),
    projectId: z.number().optional(),
    name: z.string().min(1),
    type: z.enum(['search', 'api', 'scrape']).default('search'),
    description: z.string().optional(),
    language: z.string().min(1).default('en'),
    country: z.string().min(1).default('US'),
    cadenceMinutes: z.number(),
    promptInstructions: z.string().min(1),
    targets: z.array(monitorTargetSchema).min(1),
    settings: z.record(z.unknown()).optional(),
  })
  // Pass unknown keys through: this is a thin convenience client and the server
  // is the authoritative validator — never silently drop a field the server
  // accepts (plan-specific or newly-added optional fields).
  .passthrough()
  .refine((value) => value.projectSlug !== undefined || value.projectId !== undefined, {
    message: 'create_monitor requires projectSlug or projectId.',
  });

/** POST /api/v1/projects payload. websiteUrl required; name/language/country optional. */
export const createProjectSchema = z
  .object({
    websiteUrl: z.string().min(1),
    name: z.string().min(1).optional(),
    language: z.string().min(1).optional(),
    country: z.string().min(1).optional(),
  })
  .passthrough();

/** POST /api/v1/content/topics payload. */
export const createTopicSchema = z
  .object({
    projectId: z.number(),
    primaryKeyword: z.string().min(1),
    title: z.string().min(1).optional(),
    notes: z.string().min(1).optional(),
  })
  .passthrough();

/** POST /api/v1/content/articles payload. */
export const generateArticleSchema = z
  .object({
    projectId: z.number(),
    topicId: z.number(),
  })
  .passthrough();

/** POST /api/v1/content/articles/:articleId/regenerate payload. */
export const regenerateArticleSchema = z.object({
  feedback: z.string().trim().max(4000).optional(),
});

/**
 * PATCH /api/v1/content/articles/:articleId payload — the article review-state
 * transition. Status values mirror the server's updateArticleStatusSchema
 * exactly (lib/content-engine/validators.ts): approved | draft | archived.
 * NOTE: publishing is a separate POST .../publish route, not a PATCH status.
 */
export const updateArticleSchema = z
  .object({
    status: z.enum(['approved', 'draft', 'archived']),
  })
  .passthrough();

/**
 * PATCH /api/v1/content/topics/:topicId payload — the topic review-state
 * transition. Status values mirror the server's updateTopicStatusSchema:
 * approved | rejected | archived | suggested. rejectedReason is optional.
 */
export const updateTopicSchema = z
  .object({
    status: z.enum(['approved', 'rejected', 'archived', 'suggested']),
    rejectedReason: z.string().min(1).optional(),
  })
  .passthrough();

/** POST /api/v1/content/newsroom/setups payload. */
export const createNewsroomSetupSchema = z
  .object({
    projectId: z.number().int().positive().optional(),
    projectSlug: z.string().trim().min(1).max(160).optional(),
    projectUuid: z.string().uuid().optional(),
    goal: z.string().trim().min(1).max(500),
  })
  .strict()
  .refine(
    (value) =>
      value.projectId !== undefined ||
      value.projectSlug !== undefined ||
      value.projectUuid !== undefined,
    { message: 'A projectId, projectSlug, or projectUuid is required.' },
  );

/** POST /api/v1/content/newsroom/setups/:setupId/apply payload. */
export const applyNewsroomSetupSchema = z
  .object({
    writerIndexes: z.array(z.number().int().min(0)).max(20).optional(),
  })
  .strict();

/** POST /api/v1/agent/sign-up payload (no API key required). */
export const agentSignUpSchema = z.object({
  humanEmail: z.string().email(),
  agentName: z.string().trim().min(2).max(80),
  websiteUrl: z.string().trim().min(1).max(2048).optional(),
}).strict();

/** POST /api/v1/agent/sign-in payload (no API key required). */
export const agentSignInSchema = z.object({
  email: z.string().email(),
  password: z.string().min(8).max(100),
  keyName: z.string().trim().min(1).max(100).optional(),
});

/**
 * Analytics agent-surface payloads. Reads take projectId/projectUuid as query
 * params (no schema needed); these cover the write bodies.
 */
export const addAnalyticsPropertyHostSchema = z
  .object({
    propertyId: z.number().int().positive(),
    hostname: z
      .string()
      .trim()
      .toLowerCase()
      .regex(
        /^(?=.{1,253}$)(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/,
      ),
  })
  .strict();
export type AddAnalyticsPropertyHostInput = z.input<
  typeof addAnalyticsPropertyHostSchema
>;

export const analyticsNativeOutputHealthSchema = z
  .object({
    pipeline: z.literal("native_derivation"),
    aiTrafficAvailable: z.boolean(),
    status: z.enum(["measured", "unavailable", "withheld_not_measured"]),
    lastAiClassifiedVisitCount: z.number().int().nonnegative().nullable(),
    measuredAt: z.string().datetime().nullable(),
    lastAttemptAt: z.string().datetime().nullable(),
  })
  .superRefine((value, ctx) => {
    const measured = value.status === "measured";
    const invalid = value.aiTrafficAvailable
      ? value.status === "withheld_not_measured"
      : value.status !== "withheld_not_measured";
    if (
      invalid ||
      (measured
        ? value.lastAiClassifiedVisitCount === null ||
          value.measuredAt === null ||
          value.measuredAt !== value.lastAttemptAt
        : value.lastAiClassifiedVisitCount !== null ||
          value.measuredAt !== null)
    ) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "Native AI measurement and availability must agree.",
      });
    }
  });

export const createAnalyticsPropertySchema = z.object({
  projectId: z.number().int().positive().optional(),
  projectUuid: z.string().uuid().optional(),
  hostname: z.string().trim().toLowerCase().min(1).max(253),
});

export const rotateAnalyticsPropertyKeySchema = z
  .object({
    propertyId: z.number().int().positive().optional(),
    projectId: z.number().int().positive().optional(),
    projectUuid: z.string().uuid().optional(),
    expectedPropertyId: z.number().int().positive().optional(),
  })
  .refine(
    (body) =>
      body.propertyId !== undefined
        ? body.projectId === undefined &&
          body.projectUuid === undefined &&
          body.expectedPropertyId === undefined
        : (body.projectId !== undefined || body.projectUuid !== undefined) &&
          body.expectedPropertyId !== undefined,
    {
      message:
        'Pass either "propertyId" alone, or a project reference with "expectedPropertyId".',
    },
  );

export const createAnalyticsGoalSchema = z
  .object({
    propertyId: z.number().int().positive().optional(),
    projectId: z.number().int().positive().optional(),
    projectUuid: z.string().uuid().optional(),
    name: z.string().trim().min(1).max(80),
    destination: z.string().trim().min(1).max(2048),
  })
  .refine(
    (body) =>
      body.propertyId !== undefined
        ? body.projectId === undefined && body.projectUuid === undefined
        : body.projectId !== undefined || body.projectUuid !== undefined,
    {
      message:
        'Pass either "propertyId" alone, or a "projectId"/"projectUuid" — not both.',
    },
  );

export const startAnalyticsVerificationSchema = z.object({
  propertyId: z.number().int().positive().optional(),
  projectId: z.number().int().positive().optional(),
  projectUuid: z.string().uuid().optional(),
});

export type MonitorTarget = z.infer<typeof monitorTargetSchema>;

export type CreateMonitorInput = z.input<typeof createMonitorSchema>;
export type CreateMonitorPayload = z.output<typeof createMonitorSchema>;

export type CreateProjectInput = z.input<typeof createProjectSchema>;
export type CreateTopicInput = z.input<typeof createTopicSchema>;
export type GenerateArticleInput = z.input<typeof generateArticleSchema>;
export type RegenerateArticleInput = z.input<typeof regenerateArticleSchema>;

export type UpdateArticleInput = z.input<typeof updateArticleSchema>;
export type UpdateTopicInput = z.input<typeof updateTopicSchema>;

/**
 * Analytics AI-traffic marker. `false` means withheld / not measured — numeric
 * AI fields keep their number shape and must not be read as a measured zero.
 * The same marker covers goal-source attribution. The server sets this; no
 * public request query parameter can override it.
 */
export const analyticsAiTrafficMarkerSchema = z
  .object({
    aiTrafficAvailable: z.boolean(),
  })
  .describe(
    "aiTrafficAvailable=false means AI classification metrics and goal-source attribution are withheld/not measured, not a measured zero.",
  );

/** Traffic totals keep numeric `aiVisits` (never null) even when withheld. */
export const analyticsTrafficTotalsShapeSchema = z
  .object({
    visits: z.number(),
    pageviews: z.number(),
    aiVisits: z.number(),
  })
  .nullable();

/** Overview totals keep numeric `aiVisits` (never null) even when withheld. */
export const analyticsGaOverviewTotalsShapeSchema = z
  .object({
    visits: z.number(),
    aiVisits: z.number(),
    goalCompletions: z.number().nullable(),
  })
  .nullable();

export const analyticsTrafficResponseMarkerSchema = z
  .object({
    aiTrafficAvailable: z.boolean(),
    totals: analyticsTrafficTotalsShapeSchema,
  })
  .passthrough();

export const analyticsGaOverviewResponseMarkerSchema = z
  .object({
    aiTrafficAvailable: z.boolean(),
    totals: analyticsGaOverviewTotalsShapeSchema,
  })
  .passthrough();

/** Goals list/detail payloads require the same withheld/not-measured marker. */
export const analyticsGoalsResponseMarkerSchema = z
  .object({
    aiTrafficAvailable: z.boolean(),
    goals: z.array(
      z
        .object({
          completions: z.number(),
          sources: z.array(
            z
              .object({
                id: z.string(),
                completions: z.number(),
              })
              .passthrough(),
          ),
        })
        .passthrough(),
    ),
  })
  .passthrough()
  .describe(
    "aiTrafficAvailable=false means goal-source attribution is withheld/not measured; completions stay honest numbers.",
  );

export type CreateAnalyticsPropertyInput = z.input<
  typeof createAnalyticsPropertySchema
>;
export type RotateAnalyticsPropertyKeyInput = z.input<
  typeof rotateAnalyticsPropertyKeySchema
>;
export type StartAnalyticsVerificationInput = z.input<
  typeof startAnalyticsVerificationSchema
>;
export type CreateAnalyticsGoalInput = z.input<
  typeof createAnalyticsGoalSchema
>;
export type CreateNewsroomSetupInput = z.input<typeof createNewsroomSetupSchema>;
export type ApplyNewsroomSetupInput = z.input<typeof applyNewsroomSetupSchema>;

export type AgentSignUpInput = z.input<typeof agentSignUpSchema>;
export type AgentSignInInput = z.input<typeof agentSignInSchema>;
