import { z } from 'zod';

import { ArtifactRefSchema, RunIdSchema, SafeSegmentSchema } from './audit.schema.js';
import { JsonValueSchema } from './json.schema.js';

export const TaskStatus = Object.freeze({
    PENDING: 'pending',
    CLAIMED: 'claimed',
    RUNNING: 'running',
    COMPLETED: 'completed',
    FAILED: 'failed',
    BLOCKED: 'blocked',
});

export const TaskStatusSchema = z.enum(Object.values(TaskStatus));

export const TaskType = Object.freeze({
    RESEARCH: 'research',
    EXECUTE: 'execute',
    AUDIT: 'audit',
});

export const TaskTypeSchema = z.enum(Object.values(TaskType));

export const FailureClass = Object.freeze({
    RETRYABLE: 'retryable',
    NON_RETRYABLE: 'non_retryable',
    POLICY_DENIED: 'policy_denied',
});

export const FailureClassSchema = z.enum(Object.values(FailureClass));

// UUID v4 形式的 lease token
const LeaseTokenSchema = z
    .string()
    .regex(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i);

export const LeaseSchema = z
    .object({
        lease_token: LeaseTokenSchema,
        owner_agent_id: z.string().min(1),
        lease_expire_at: z.string().datetime(),
        attempt: z.number().int().min(1),
    })
    .strict();

export const TaskSchema = z
    .object({
        task_id: SafeSegmentSchema,
        run_id: RunIdSchema,
        title: z.string().min(1),
        type: TaskTypeSchema,
        status: TaskStatusSchema,
        input: JsonValueSchema,
        assigned_role: z.string().min(1).optional(),
        depends_on: z.array(z.string().min(1)).optional(),
        lease: LeaseSchema.optional(),
        artifact_refs: z.array(ArtifactRefSchema).optional(),
        failure_class: FailureClassSchema.optional(),
        failure_message: z.string().min(1).optional(),
        blocking_tasks: z.array(z.string().min(1)).optional(),
        idempotency_key: z.string().min(1).optional(),
        created_at: z.string().datetime(),
        updated_at: z.string().datetime(),
    })
    .strict();
