// sandbox contracts 一律使用 snake_case 字段名
import { z } from 'zod';

export const ExecSpecSchema = z
    .object({
        cmd: z.string().min(1),
        args: z.array(z.string()),
        cwd: z.string().min(1).optional(),
        timeout_ms: z.number().int().positive().optional(),
        env: z.record(z.string()).optional(),
    })
    .strict();

