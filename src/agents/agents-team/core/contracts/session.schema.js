import { z } from 'zod';

import { RunIdSchema, SafeSegmentSchema } from './audit.schema.js';
import { MessageTypeSchema } from './message.schema.js';

export const SessionStatus = Object.freeze({
    CREATED: 'created',
    PLANNED: 'planned',
    RUNNING: 'running',
    FINALIZING: 'finalizing',
    COMPLETED: 'completed',
    FAILED: 'failed',
    ABORTED: 'aborted',
});

export const SessionStatusSchema = z.enum(Object.values(SessionStatus));

export const TasksSummarySchema = z
    .object({
        total: z.number().int().nonnegative(),
        pending: z.number().int().nonnegative(),
        claimed: z.number().int().nonnegative(),
        running: z.number().int().nonnegative(),
        completed: z.number().int().nonnegative(),
        failed: z.number().int().nonnegative(),
        blocked: z.number().int().nonnegative(),
    })
    .strict();

export const MessagesSummarySchema = z
    .object({
        total: z.number().int().nonnegative(),
        by_type: z.record(MessageTypeSchema, z.number().int().nonnegative()),
    })
    .strict();

export const ArtifactsSummarySchema = z
    .object({
        total: z.number().int().nonnegative(),
        artifact_ids: z.array(z.string().min(1)),
    })
    .strict();

export const SessionConfigSchema = z
    .object({
        max_turns: z.number().int().min(1),
        timeout_ms: z.number().int().positive(),
        budget_tokens: z.number().int().min(1).optional(),
    })
    .strict();

export const DecisionSchema = z
    .object({
        artifact_id: SafeSegmentSchema,
        direction: z.string().min(1),
        decided_at: z.string().datetime(),
    })
    .strict();

export const RunSessionSchema = z
    .object({
        run_id: RunIdSchema,
        status: SessionStatusSchema,
        goal: z.string().min(1),
        config: SessionConfigSchema,
        created_at: z.string().datetime(),
        updated_at: z.string().datetime(),
        tasks_summary: TasksSummarySchema,
        messages_summary: MessagesSummarySchema,
        artifacts_summary: ArtifactsSummarySchema,
        decision: DecisionSchema.optional(),
        failure_reason: z.string().min(1).optional(),
    })
    .strict();
