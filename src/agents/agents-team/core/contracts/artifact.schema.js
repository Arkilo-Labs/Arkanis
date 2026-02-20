import { z } from 'zod';

import { HashSchema, SafeSegmentSchema } from './audit.schema.js';

export const ArtifactTypeSchema = z.enum(['text', 'binary', 'json', 'stdout', 'stderr', 'mcp_result']);

export const ArtifactRedactionLevelSchema = z.enum(['none', 'partial', 'full']);

export const ArtifactRecordSchema = z
    .object({
        artifact_id: SafeSegmentSchema,
        type: z.string().min(1),
        path: z.string().min(1),
        hash: HashSchema,
        provenance: z.string().min(1).optional(),
        created_at: z.string().datetime(),
        size_bytes: z.number().int().nonnegative(),
        redaction_level: ArtifactRedactionLevelSchema.optional(),
    })
    .strict();
