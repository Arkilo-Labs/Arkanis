import { z } from 'zod';

import { ErrorCode } from '../../contracts/errors.js';

const InputSchema = z
    .object({
        url: z.string().url(),
        method: z.enum(['GET', 'POST', 'PUT', 'DELETE', 'HEAD', 'PATCH']).default('GET'),
        headers: z.record(z.string()).optional(),
        body: z.string().optional(),
        timeout_ms: z.number().int().positive().default(10000),
    })
    .strict();

const OutputSchema = z
    .object({
        ok: z.boolean(),
        status_code: z.number().int().nullable(),
        body_preview: z.string(),
        body_truncated: z.boolean(),
        body_bytes: z.number().int().nonnegative(),
        response_url: z.string().optional(),
        error: z
            .object({ code: z.string(), message: z.string() })
            .strict()
            .optional(),
    })
    .strict();

const PREVIEW_MAX_BYTES = 4096;

export const httpFetchTool = {
    name: 'http.fetch',
    permissions: {
        needs_network: true,
        needs_workspace_write: false,
        needs_host_exec: false,
        needs_secrets: false,
    },
    inputSchema: InputSchema,
    outputSchema: OutputSchema,

    async run(_ctx, args) {
        const controller = new AbortController();
        const timer = setTimeout(() => controller.abort(), args.timeout_ms);

        try {
            const response = await fetch(args.url, {
                method: args.method,
                ...(args.headers ? { headers: args.headers } : {}),
                ...(args.body !== undefined ? { body: args.body } : {}),
                signal: controller.signal,
            });

            const buf = Buffer.from(await response.arrayBuffer());
            const truncated = buf.byteLength > PREVIEW_MAX_BYTES;

            return {
                ok: response.ok,
                status_code: response.status,
                body_preview: buf.slice(0, PREVIEW_MAX_BYTES).toString('utf-8'),
                body_truncated: truncated,
                body_bytes: buf.byteLength,
                response_url: response.url,
            };
        } catch (err) {
            const isTimeout = err.name === 'AbortError';
            return {
                ok: false,
                status_code: null,
                body_preview: '',
                body_truncated: false,
                body_bytes: 0,
                error: {
                    code: isTimeout ? ErrorCode.ERR_TOOL_EXEC_FAILED : ErrorCode.ERR_TOOL_EXEC_FAILED,
                    message: isTimeout ? `请求超时（${args.timeout_ms}ms）` : err.message,
                },
            };
        } finally {
            clearTimeout(timer);
        }
    },
};
