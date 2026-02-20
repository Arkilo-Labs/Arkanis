import { z } from 'zod';

import { ErrorCode } from '../../contracts/errors.js';

/**
 * mcp.call — 通过 McpClient 调用 MCP method 并返回结果。
 * MCP client 在 P17 实现；此处 ctx.mcpRegistry 为 null 时返回未配置错误。
 */

const InputSchema = z
    .object({
        server: z.string().min(1),
        method: z.string().min(1),
        params: z.record(z.unknown()).default({}),
    })
    .strict();

const OutputSchema = z
    .object({
        ok: z.boolean(),
        result: z.unknown().optional(),
        mcp_ref: z
            .object({
                server: z.string(),
                method: z.string(),
            })
            .strict()
            .optional(),
        error: z
            .object({ code: z.string(), message: z.string() })
            .strict()
            .optional(),
    })
    .strict();

export const mcpCallTool = {
    name: 'mcp.call',
    permissions: {
        needs_network: false,
        needs_workspace_write: false,
        needs_host_exec: false,
        needs_secrets: false,
    },
    inputSchema: InputSchema,
    outputSchema: OutputSchema,

    async run(ctx, args) {
        const { mcpRegistry } = ctx;

        if (!mcpRegistry) {
            return {
                ok: false,
                mcp_ref: { server: args.server, method: args.method },
                error: {
                    code: ErrorCode.ERR_MCP_START_FAILED,
                    message: 'MCP registry 未配置（P17 阶段实现）',
                },
            };
        }

        try {
            const result = await mcpRegistry.call(args.server, args.method, args.params);
            return {
                ok: true,
                result,
                mcp_ref: { server: args.server, method: args.method },
            };
        } catch (err) {
            return {
                ok: false,
                mcp_ref: { server: args.server, method: args.method },
                error: {
                    code: ErrorCode.ERR_MCP_PROTOCOL_ERROR,
                    message: err.message,
                },
            };
        }
    },
};
