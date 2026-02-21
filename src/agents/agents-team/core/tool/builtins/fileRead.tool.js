import { z } from 'zod';
import { readFile, stat } from 'node:fs/promises';

import { resolveUserPath } from '../../artifacts/artifactPaths.js';
import { ErrorCode } from '../../contracts/errors.js';

const MAX_READ_BYTES = 1024 * 1024; // 1 MB

const InputSchema = z
    .object({
        path: z.string().min(1),
    })
    .strict();

const OutputSchema = z
    .object({
        path: z.string(),
        content: z.string(),
        size_bytes: z.number().int().nonnegative(),
        truncated: z.boolean(),
    })
    .strict();

export const fileReadTool = {
    name: 'file.read',
    permissions: {
        needs_network: false,
        needs_workspace_write: false,
        needs_host_exec: false,
        needs_secrets: false,
    },
    inputSchema: InputSchema,
    outputSchema: OutputSchema,

    async run(ctx, args) {
        const { runPaths } = ctx;

        let resolvedPath;
        try {
            resolvedPath = resolveUserPath(runPaths.artifactsDir, args.path);
        } catch (err) {
            throw Object.assign(new Error(`路径越界: "${args.path}"`), {
                code: ErrorCode.ERR_INVALID_ARGUMENT,
            });
        }

        let fileStat;
        try {
            fileStat = await stat(resolvedPath);
        } catch {
            throw new Error(`文件不存在: "${args.path}"`);
        }

        const sizeBytes = fileStat.size;
        const truncated = sizeBytes > MAX_READ_BYTES;

        const buf = await readFile(resolvedPath);
        const content = truncated
            ? buf.slice(0, MAX_READ_BYTES).toString('utf-8')
            : buf.toString('utf-8');

        return {
            path: args.path,
            content,
            size_bytes: sizeBytes,
            truncated,
        };
    },
};
