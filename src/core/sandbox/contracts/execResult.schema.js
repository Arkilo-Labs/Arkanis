// sandbox contracts 一律使用 snake_case 字段名
import { z } from 'zod';

import { AgentsTeamErrorSchema } from '../../agents-team/contracts/errors.js';

const TimestampSchema = z.string().datetime();

const ExecResultFieldsSchema = z
    .object({
        started_at: TimestampSchema,
        ended_at: TimestampSchema,
        duration_ms: z.number().int().nonnegative(),

        timeout_ms: z.number().int().nonnegative().optional(),
        timed_out: z.boolean(),

        exit_code: z.number().int().nullable(),
        signal: z.string().min(1).nullable(),

        stdout: z.string(),
        stderr: z.string(),

        stdout_bytes: z.number().int().nonnegative(),
        stderr_bytes: z.number().int().nonnegative(),

        stdout_truncated: z.boolean(),
        stderr_truncated: z.boolean(),

        stdout_max_bytes: z.number().int().nonnegative(),
        stderr_max_bytes: z.number().int().nonnegative(),
    })
    .strict();

export const ExecResultSchema = z.discriminatedUnion('ok', [
    ExecResultFieldsSchema.extend({ ok: z.literal(true) }).strict(),
    ExecResultFieldsSchema.extend({
        ok: z.literal(false),
        error: AgentsTeamErrorSchema,
    }).strict(),
]);

