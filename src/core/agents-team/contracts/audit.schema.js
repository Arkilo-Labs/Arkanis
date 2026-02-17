import { z } from 'zod';

import { AgentsTeamErrorSchema } from './errors.js';
import { DenyReasonSchema } from './denyReasons.js';

export const RunIdSchema = z.string().regex(/^[0-9]{8}_[0-9]{6}$/);

export const SafeSegmentSchema = z.string().regex(/^[A-Za-z0-9][A-Za-z0-9_-]{0,80}$/);

export const CorrelationIdSchema = z.string().min(1);

export const WorkspaceAccessSchema = z.enum(['none', 'read_only', 'read_write']);

export const NetworkPolicySchema = z.enum(['off', 'restricted', 'full']);

export const HashSchema = z
    .object({
        alg: z.literal('sha256'),
        value: z.string().regex(/^[a-f0-9]{64}$/),
    })
    .strict();

export const PolicyDecisionSchema = z.discriminatedUnion('decision', [
    z
        .object({
            decision: z.literal('allow'),
            details: z.unknown().optional(),
        })
        .strict(),
    z
        .object({
            decision: z.literal('needs_approval'),
            details: z.unknown().optional(),
        })
        .strict(),
    z
        .object({
            decision: z.literal('deny'),
            reason: DenyReasonSchema,
            details: z.unknown().optional(),
        })
        .strict(),
]);

export const SandboxRefSchema = z
    .object({
        provider_id: SafeSegmentSchema,
        sandbox_id: SafeSegmentSchema,
    })
    .strict();

export const ArtifactRefSchema = z
    .object({
        artifact_id: SafeSegmentSchema,
        type: z.string().min(1).optional(),
    })
    .strict();

export const McpRefSchema = z
    .object({
        server: z.string().min(1),
        method: z.string().min(1),
        params_hash: HashSchema.optional(),
        params_size_bytes: z.number().int().nonnegative().optional(),
    })
    .strict();

const TimestampSchema = z.string().datetime();
const DurationMsSchema = z.number().int().nonnegative();
const OptionalSafeStringSchema = z.string().min(1).optional();

const ToolNameSchema = z.string().regex(/^[a-z][a-z0-9_]*(\.[a-z][a-z0-9_]*)+$/);
const SkillIdSchema = z.string().regex(/^[a-z][a-z0-9_]{0,80}$/);
const SkillVersionSchema = z.string().min(1);

const ExecLikeFieldsSchema = z
    .object({
        run_id: RunIdSchema,
        sandbox_id: SafeSegmentSchema,
        provider_id: SafeSegmentSchema,

        correlation_id: CorrelationIdSchema,
        parent_correlation_id: OptionalSafeStringSchema,

        cmd: z.string().min(1),
        args: z.array(z.string()),
        cwd: z.string().min(1).optional(),

        started_at: TimestampSchema,
        ended_at: TimestampSchema,
        duration_ms: DurationMsSchema,

        timeout_ms: z.number().int().nonnegative().optional(),
        timed_out: z.boolean(),

        exit_code: z.number().int().nullable().optional(),
        signal: z.string().min(1).nullable().optional(),

        workspace_access: WorkspaceAccessSchema,
        network_policy: NetworkPolicySchema,

        stdout_bytes: z.number().int().nonnegative(),
        stderr_bytes: z.number().int().nonnegative(),
        stdout_truncated: z.boolean(),
        stderr_truncated: z.boolean(),
        stdout_max_bytes: z.number().int().nonnegative(),
        stderr_max_bytes: z.number().int().nonnegative(),
    })
    .strict();

export const AuditCommandRecordSchema = z.discriminatedUnion('ok', [
    ExecLikeFieldsSchema.extend({ ok: z.literal(true) }).strict(),
    ExecLikeFieldsSchema.extend({
        ok: z.literal(false),
        error: AgentsTeamErrorSchema,
    }).strict(),
]);

const ToolCallFieldsSchema = z
    .object({
        run_id: RunIdSchema,

        correlation_id: CorrelationIdSchema,
        parent_correlation_id: OptionalSafeStringSchema,

        tool_name: ToolNameSchema,

        args_hash: HashSchema,
        args_size_bytes: z.number().int().nonnegative(),
        args_preview: z.unknown().optional(),

        policy_decision: PolicyDecisionSchema.optional(),

        sandbox_ref: SandboxRefSchema.optional(),
        artifact_refs: z.array(ArtifactRefSchema).optional(),
        mcp_ref: McpRefSchema.optional(),

        started_at: TimestampSchema,
        ended_at: TimestampSchema,
        duration_ms: DurationMsSchema,
    })
    .strict();

export const AuditToolCallRecordSchema = z.discriminatedUnion('ok', [
    ToolCallFieldsSchema.extend({ ok: z.literal(true) }).strict(),
    ToolCallFieldsSchema.extend({
        ok: z.literal(false),
        error: AgentsTeamErrorSchema,
    }).strict(),
]);

const SkillRunFieldsSchema = z
    .object({
        run_id: RunIdSchema,

        correlation_id: CorrelationIdSchema,
        parent_correlation_id: OptionalSafeStringSchema,

        skill_id: SkillIdSchema,
        skill_version: SkillVersionSchema,

        inputs_hash: HashSchema,
        inputs_size_bytes: z.number().int().nonnegative(),

        policy_decision: PolicyDecisionSchema.optional(),
        tool_correlation_ids: z.array(CorrelationIdSchema).optional(),

        sandbox_ref: SandboxRefSchema.optional(),
        artifact_refs: z.array(ArtifactRefSchema).optional(),
        mcp_ref: McpRefSchema.optional(),

        started_at: TimestampSchema,
        ended_at: TimestampSchema,
        duration_ms: DurationMsSchema,
    })
    .strict();

export const AuditSkillRunRecordSchema = z.discriminatedUnion('ok', [
    SkillRunFieldsSchema.extend({ ok: z.literal(true) }).strict(),
    SkillRunFieldsSchema.extend({
        ok: z.literal(false),
        error: AgentsTeamErrorSchema,
    }).strict(),
]);

