// sandbox contracts 一律使用 snake_case 字段名
import { z } from 'zod';

import {
    NetworkPolicySchema,
    SandboxEngineSchema,
    SandboxIdSchema,
    SandboxModeSchema,
    SandboxMountSchema,
    SandboxProviderIdSchema,
    SandboxResourcesSchema,
    SandboxRuntimeSchema,
    WorkspaceAccessSchema,
} from './sandboxSpec.schema.js';

export const SandboxEngineResolved = Object.freeze({
    DOCKER: 'docker',
    PODMAN: 'podman',
});

export const SandboxRuntimeResolved = Object.freeze({
    NATIVE: 'native',
    GVISOR: 'gvisor',
});

export const SandboxEngineResolvedSchema = z.enum(Object.values(SandboxEngineResolved));
export const SandboxRuntimeResolvedSchema = z.enum(Object.values(SandboxRuntimeResolved));

export const SandboxHandleSchema = z
    .object({
        provider_id: SandboxProviderIdSchema,
        sandbox_id: SandboxIdSchema,
        created_at: z.string().datetime(),

        engine: SandboxEngineSchema,
        engine_resolved: SandboxEngineResolvedSchema,

        runtime: SandboxRuntimeSchema,
        runtime_resolved: SandboxRuntimeResolvedSchema,

        mode: SandboxModeSchema,
        image: z.string().min(1),

        workspace_access: WorkspaceAccessSchema,
        workspace_mount_path: z.string().min(1).nullable().optional(),
        network_policy: NetworkPolicySchema,

        mounts: z.array(SandboxMountSchema),
        resources: SandboxResourcesSchema,
    })
    .strict();

