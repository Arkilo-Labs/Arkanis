import { z } from 'zod';

import { AgentsTeamErrorSchema } from './errors.js';
import { JsonValueSchema } from './json.schema.js';
import { RunIdSchema, CorrelationIdSchema } from './audit.schema.js';

// tool name 格式：namespace.action（例如 sandbox.exec）
export const ToolNameSchema = z.string().regex(/^[a-z][a-z0-9_]*(\.[a-z][a-z0-9_]*)+$/);

export const ToolPermissionSchema = z
    .object({
        // 工具声明自己需要的能力（true = 需要，false / 未设置 = 不需要）
        needs_network: z.boolean().optional(),
        needs_workspace_write: z.boolean().optional(),
        needs_host_exec: z.boolean().optional(),
        needs_secrets: z.boolean().optional(),
    })
    .strict();

export const ToolCallSchema = z
    .object({
        run_id: RunIdSchema,
        correlation_id: CorrelationIdSchema,
        parent_correlation_id: z.string().min(1).optional(),
        tool_name: ToolNameSchema,
        args: z.record(JsonValueSchema),
    })
    .strict();

export const ToolResultSchema = z.discriminatedUnion('ok', [
    z
        .object({
            ok: z.literal(true),
            data: JsonValueSchema,
        })
        .strict(),
    z
        .object({
            ok: z.literal(false),
            error: AgentsTeamErrorSchema,
        })
        .strict(),
]);
