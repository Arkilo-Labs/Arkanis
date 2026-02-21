import { z } from 'zod';
import { readFile, writeFile } from 'node:fs/promises';

import { resolveUserPath } from '../../artifacts/artifactPaths.js';
import { ErrorCode } from '../../contracts/errors.js';

const InputSchema = z
    .object({
        path: z.string().min(1),
        old_str: z.string().min(1),
        new_str: z.string(),
    })
    .strict();

const OutputSchema = z
    .object({
        path: z.string(),
        patched: z.literal(true),
    })
    .strict();

export const filePatchTool = {
    name: 'file.patch',
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
        } catch {
            throw Object.assign(new Error(`路径越界: "${args.path}"`), {
                code: ErrorCode.ERR_INVALID_ARGUMENT,
            });
        }

        let content;
        try {
            content = await readFile(resolvedPath, 'utf-8');
        } catch {
            throw new Error(`文件不存在: "${args.path}"`);
        }

        // 计算 old_str 出现次数（精确字符串匹配）
        let count = 0;
        let pos = 0;
        while ((pos = content.indexOf(args.old_str, pos)) !== -1) {
            count += 1;
            pos += args.old_str.length;
        }

        if (count === 0) {
            throw Object.assign(
                new Error(`old_str not found in "${args.path}"`),
                { code: ErrorCode.ERR_INVALID_ARGUMENT },
            );
        }

        if (count > 1) {
            throw Object.assign(
                new Error(`old_str matches ${count} places in "${args.path}"`),
                { code: ErrorCode.ERR_INVALID_ARGUMENT },
            );
        }

        const patched = content.replace(args.old_str, args.new_str);
        await writeFile(resolvedPath, patched, 'utf-8');

        return { path: args.path, patched: true };
    },
};
