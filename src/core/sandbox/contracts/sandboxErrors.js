import { z } from 'zod';

export const SandboxErrorCode = Object.freeze({
    ERR_SANDBOX_NOT_FOUND: 'ERR_SANDBOX_NOT_FOUND',
    ERR_SANDBOX_START_FAILED: 'ERR_SANDBOX_START_FAILED',
    ERR_SANDBOX_EXEC_TIMEOUT: 'ERR_SANDBOX_EXEC_TIMEOUT',
    ERR_SANDBOX_EXEC_FAILED: 'ERR_SANDBOX_EXEC_FAILED',
});

export const SandboxErrorCodeSchema = z.enum(Object.values(SandboxErrorCode));

export const SandboxErrorSchema = z
    .object({
        code: SandboxErrorCodeSchema,
        message: z.string().min(1),
        details: z.unknown().optional(),
    })
    .strict();
