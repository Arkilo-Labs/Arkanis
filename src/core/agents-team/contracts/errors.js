import { z } from 'zod';

import { DenyReasonSchema } from './denyReasons.js';
import { JsonValueSchema } from './json.schema.js';

export const ErrorCode = Object.freeze({
    ERR_INVALID_ARGUMENT: 'ERR_INVALID_ARGUMENT',
    ERR_POLICY_DENIED: 'ERR_POLICY_DENIED',
    ERR_SANDBOX_NOT_FOUND: 'ERR_SANDBOX_NOT_FOUND',
    ERR_SANDBOX_START_FAILED: 'ERR_SANDBOX_START_FAILED',
    ERR_SANDBOX_EXEC_TIMEOUT: 'ERR_SANDBOX_EXEC_TIMEOUT',
    ERR_SANDBOX_EXEC_FAILED: 'ERR_SANDBOX_EXEC_FAILED',
    ERR_TOOL_NOT_FOUND: 'ERR_TOOL_NOT_FOUND',
    ERR_TOOL_EXEC_FAILED: 'ERR_TOOL_EXEC_FAILED',
    ERR_SKILL_NOT_FOUND: 'ERR_SKILL_NOT_FOUND',
    ERR_SKILL_VALIDATION_FAILED: 'ERR_SKILL_VALIDATION_FAILED',
    ERR_MCP_START_FAILED: 'ERR_MCP_START_FAILED',
    ERR_MCP_PROTOCOL_ERROR: 'ERR_MCP_PROTOCOL_ERROR',
});

export const ErrorCodeSchema = z.enum(Object.values(ErrorCode));

const NonPolicyErrorCodeSchema = z.enum(
    Object.values(ErrorCode).filter((code) => code !== ErrorCode.ERR_POLICY_DENIED),
);

const BaseErrorSchema = z
    .object({
        code: ErrorCodeSchema,
        message: z.string().min(1),
        details: JsonValueSchema.optional(),
    })
    .strict();

export const PolicyDeniedErrorSchema = BaseErrorSchema.extend({
    code: z.literal(ErrorCode.ERR_POLICY_DENIED),
    deny_reason: DenyReasonSchema,
}).strict();

export const NonPolicyErrorSchema = BaseErrorSchema.extend({
    code: NonPolicyErrorCodeSchema,
}).strict();

export const AgentsTeamErrorSchema = z.discriminatedUnion('code', [
    PolicyDeniedErrorSchema,
    NonPolicyErrorSchema,
]);
