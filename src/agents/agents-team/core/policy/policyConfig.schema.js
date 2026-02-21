import { z } from 'zod';

import { NetworkPolicySchema, WorkspaceAccessSchema } from '../contracts/audit.schema.js';

export const PolicyConfigSchema = z
    .object({
        network: NetworkPolicySchema.default('off'),
        workspace_access: WorkspaceAccessSchema.default('none'),
        host_exec: z.enum(['deny', 'allow']).default('deny'),
        secrets: z.enum(['deny', 'allow']).default('deny'),
    })
    .strict();
