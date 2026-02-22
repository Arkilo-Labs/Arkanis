import { readFile } from 'node:fs/promises';

import { createRunPaths } from '../../outputs/runPaths.js';
import { RunSessionSchema } from '../../contracts/session.schema.js';
import { ErrorCode } from '../../contracts/errors.js';
import { makeError } from '../errors.util.js';
import { atomicWriteJson } from '../atomicWrite.js';

/**
 * @param {{ outputDir?: string, cwd?: string }} [opts]
 * @returns {{ readSession, writeSession }}
 */
export function createSessionStore({ outputDir, cwd } = {}) {
    function runPaths(runId) {
        return createRunPaths({ outputDir, runId, cwd });
    }

    async function readSession(runId) {
        const rp = runPaths(runId);
        let raw;
        try {
            raw = await readFile(rp.indexJsonPath, 'utf-8');
        } catch (err) {
            if (err.code === 'ENOENT') {
                throw makeError(
                    ErrorCode.ERR_SESSION_INVALID_STATE,
                    `会话不存在: ${runId}`,
                    { runId },
                );
            }
            throw err;
        }

        let parsed;
        try {
            parsed = JSON.parse(raw);
        } catch {
            throw makeError(
                ErrorCode.ERR_INVALID_ARGUMENT,
                `index.json JSON 解析失败: ${runId}`,
                { runId },
            );
        }

        const result = RunSessionSchema.safeParse(parsed);
        if (!result.success) {
            throw makeError(
                ErrorCode.ERR_INVALID_ARGUMENT,
                `index.json schema 校验失败: ${runId}`,
                { runId, issues: result.error.issues },
            );
        }
        return result.data;
    }

    async function writeSession(runId, session) {
        const result = RunSessionSchema.safeParse(session);
        if (!result.success) {
            throw makeError(
                ErrorCode.ERR_INVALID_ARGUMENT,
                'session 数据 schema 校验失败',
                { issues: result.error.issues },
            );
        }
        const rp = runPaths(runId);
        await atomicWriteJson(rp.indexJsonPath, result.data);
        return result.data;
    }

    return { readSession, writeSession };
}
