import { z } from 'zod';

import { AgentsTeamErrorSchema } from './errors.js';
import { JsonValueSchema } from './json.schema.js';
import { RunIdSchema, CorrelationIdSchema } from './audit.schema.js';

export const SkillIdSchema = z.string().regex(/^[a-z][a-z0-9_]{0,80}$/);
export const SkillVersionSchema = z.string().min(1);

export const SkillRuntimeTypeSchema = z.enum(['builtin', 'sandbox_script']);

export const SkillPermissionSchema = z
    .object({
        network: z.enum(['off', 'restricted', 'full']).optional(),
        workspace_access: z.enum(['none', 'read_only', 'read_write']).optional(),
        host_exec: z.enum(['deny', 'allow']).optional(),
        secrets: z.enum(['deny', 'allow']).optional(),
    })
    .strict();

export const SkillManifestSchema = z
    .object({
        id: SkillIdSchema,
        version: SkillVersionSchema,
        description: z.string().min(1),
        implementation: z
            .object({
                type: SkillRuntimeTypeSchema,
                entry: z.string().min(1),
            })
            .strict(),
        permissions: SkillPermissionSchema,
        inputs: z.record(z.string()),
        outputs: z.record(z.string()),
    })
    .strict();

export const SkillRunRequestSchema = z
    .object({
        run_id: RunIdSchema,
        correlation_id: CorrelationIdSchema,
        parent_correlation_id: z.string().min(1).optional(),
        skill_id: SkillIdSchema,
        inputs: z.record(JsonValueSchema),
    })
    .strict();

export const SkillRunResultSchema = z.discriminatedUnion('ok', [
    z
        .object({
            ok: z.literal(true),
            outputs: z.record(JsonValueSchema),
            artifact_refs: z
                .array(
                    z
                        .object({
                            artifact_id: z.string().min(1),
                            type: z.string().min(1).optional(),
                        })
                        .strict(),
                )
                .optional(),
        })
        .strict(),
    z
        .object({
            ok: z.literal(false),
            error: AgentsTeamErrorSchema,
        })
        .strict(),
]);
