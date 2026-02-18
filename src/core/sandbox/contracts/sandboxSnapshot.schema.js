// sandbox contracts 一律使用 snake_case 字段名
import { z } from 'zod';

import { SandboxIdSchema, SandboxProviderIdSchema } from './sandboxSpec.schema.js';
import { SandboxEngineResolvedSchema, SandboxRuntimeResolvedSchema } from './sandboxHandle.schema.js';

export const SandboxSnapshotSchema = z
    .object({
        provider_id: SandboxProviderIdSchema,
        sandbox_id: SandboxIdSchema,

        image: z.string().min(1),
        image_digest: z.string().min(1).optional(),

        engine: SandboxEngineResolvedSchema,
        runtime: SandboxRuntimeResolvedSchema,

        host_platform: z.string().min(1),
        host_arch: z.string().min(1),
        node_version: z.string().min(1),

        engine_version: z.string().min(1).optional(),
        captured_at: z.string().datetime().optional(),
    })
    .strict();

