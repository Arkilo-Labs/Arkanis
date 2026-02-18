// sandbox contracts 一律使用 snake_case 字段名
import path from 'node:path';

import { z } from 'zod';

import { SAFE_SEGMENT_REGEX } from '../../agents-team/contracts/patterns.js';

export const SandboxSpecVersion = Object.freeze({
    V1: 1,
});

export const SandboxMode = Object.freeze({
    OFF: 'off',
    CONSTRAINED: 'constrained',
    SANDBOXED: 'sandboxed',
});

export const SandboxEngine = Object.freeze({
    AUTO: 'auto',
    DOCKER: 'docker',
    PODMAN: 'podman',
});

export const SandboxRuntime = Object.freeze({
    AUTO: 'auto',
    NATIVE: 'native',
    GVISOR: 'gvisor',
});

export const WorkspaceAccess = Object.freeze({
    NONE: 'none',
    READ_ONLY: 'read_only',
    READ_WRITE: 'read_write',
});

export const NetworkPolicy = Object.freeze({
    OFF: 'off',
    RESTRICTED: 'restricted',
    FULL: 'full',
});

export const SafeSegmentSchema = z.string().regex(SAFE_SEGMENT_REGEX);

export const SandboxModeSchema = z.enum(Object.values(SandboxMode));
export const SandboxEngineSchema = z.enum(Object.values(SandboxEngine));
export const SandboxRuntimeSchema = z.enum(Object.values(SandboxRuntime));
export const WorkspaceAccessSchema = z.enum(Object.values(WorkspaceAccess));
export const NetworkPolicySchema = z.enum(Object.values(NetworkPolicy));

export const SandboxProviderIdSchema = SafeSegmentSchema;
export const SandboxIdSchema = SafeSegmentSchema;

const AbsolutePathSchema = z
    .string()
    .min(1)
    .refine((value) => path.isAbsolute(value), { message: 'source_path 必须是绝对路径' });

const ContainerPathSchema = z
    .string()
    .min(1)
    .refine((value) => value.startsWith('/'), { message: 'target_path 必须以 / 开头' });

export const SandboxBindMountSchema = z
    .object({
        type: z.literal('bind'),
        source_path: AbsolutePathSchema,
        target_path: ContainerPathSchema,
        read_only: z.boolean(),
    })
    .strict();

export const SandboxTmpfsMountSchema = z
    .object({
        type: z.literal('tmpfs'),
        target_path: ContainerPathSchema,
        size_mb: z.number().int().positive().optional(),
        read_only: z.boolean().optional(),
    })
    .strict();

export const SandboxMountSchema = z.discriminatedUnion('type', [
    SandboxBindMountSchema,
    SandboxTmpfsMountSchema,
]);

export const SandboxResourcesSchema = z
    .object({
        max_wall_clock_ms: z.number().int().positive(),
        max_stdout_bytes: z.number().int().nonnegative(),
        max_stderr_bytes: z.number().int().nonnegative(),
        max_memory_mb: z.number().int().positive(),
        max_cpu: z.number().positive(),
        max_disk_mb: z.number().int().positive().optional(),
        max_processes: z.number().int().positive().optional(),
    })
    .strict();

export const SandboxSpecSchema = z
    .object({
        version: z.literal(SandboxSpecVersion.V1),
        provider_id: SandboxProviderIdSchema,
        engine: SandboxEngineSchema,
        runtime: SandboxRuntimeSchema,
        mode: SandboxModeSchema,
        image: z.string().min(1),
        workspace_access: WorkspaceAccessSchema,
        network_policy: NetworkPolicySchema,
        mounts: z.array(SandboxMountSchema),
        resources: SandboxResourcesSchema,
    })
    .strict();

