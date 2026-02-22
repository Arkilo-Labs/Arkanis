import { readdir, unlink, readFile } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import { z } from 'zod';

import { createRunPaths } from '../../outputs/runPaths.js';
import { ErrorCode } from '../../contracts/errors.js';
import { DenyReason } from '../../contracts/denyReasons.js';
import { atomicWriteJson } from '../atomicWrite.js';

export const LockMode = Object.freeze({
    READ: 'read',
    WRITE: 'write',
});

const LockModeSchema = z.enum(Object.values(LockMode));

const FileLockRecordSchema = z
    .object({
        lock_id: z.string().min(1),
        path: z.string().min(1),
        mode: LockModeSchema,
        lease_token: z.string().min(1),
        agent_id: z.string().min(1),
        lease_expire_at: z.string().datetime(),
        acquired_at: z.string().datetime(),
    })
    .strict();

function makeError(code, message, details) {
    const err = new Error(message);
    err.code = code;
    if (details !== undefined) err.details = details;
    return err;
}

function makePolicyError(denyReason, message, details) {
    const err = new Error(message);
    err.code = ErrorCode.ERR_POLICY_DENIED;
    err.deny_reason = denyReason;
    if (details !== undefined) err.details = details;
    return err;
}

/**
 * @param {{ outputDir?: string, cwd?: string, now?: () => Date }} [opts]
 */
export function createFileLock({ outputDir, cwd, now = () => new Date() } = {}) {
    function runPaths(runId) {
        return createRunPaths({ outputDir, runId, cwd });
    }

    async function readAllLocks(runId) {
        const rp = runPaths(runId);
        let entries;
        try {
            entries = await readdir(rp.locksDir);
        } catch (err) {
            if (err.code === 'ENOENT') return [];
            throw err;
        }

        const jsonFiles = entries.filter((f) => f.endsWith('.json') && !f.includes('.tmp'));
        const locks = [];
        for (const file of jsonFiles) {
            const lockId = file.slice(0, -5);
            const filePath = rp.lockPath(lockId);
            let raw;
            try {
                raw = await readFile(filePath, 'utf-8');
            } catch (err) {
                if (err.code === 'ENOENT') continue;
                throw err;
            }
            let parsed;
            try {
                parsed = JSON.parse(raw);
            } catch {
                continue;
            }
            const result = FileLockRecordSchema.safeParse(parsed);
            if (result.success) locks.push(result.data);
        }
        return locks;
    }

    // acquireLock 前清理指定路径上已过期的锁
    async function purgeExpiredForPath(runId, targetPath) {
        const allLocks = await readAllLocks(runId);
        const rp = runPaths(runId);
        const currentTime = now();
        for (const lock of allLocks) {
            if (lock.path !== targetPath) continue;
            if (new Date(lock.lease_expire_at) <= currentTime) {
                try {
                    await unlink(rp.lockPath(lock.lock_id));
                } catch (err) {
                    if (err.code !== 'ENOENT') throw err;
                }
            }
        }
    }

    /**
     * 获取路径级锁，绑定 lease_token。
     * - read 锁可共享（多个 reader 共存）
     * - write 锁独占（任何现有锁均冲突）
     * - 获取前先清理目标路径上的过期锁
     *
     * @param {string} runId
     * @param {{ targetPath: string, mode: 'read'|'write', leaseToken: string, agentId: string, leaseExpireAt: string }} params
     * @returns {{ lock_id: string }}
     */
    async function acquireLock(runId, { targetPath, mode, leaseToken, agentId, leaseExpireAt }) {
        await purgeExpiredForPath(runId, targetPath);

        const allLocks = await readAllLocks(runId);
        const activeLocks = allLocks.filter((l) => l.path === targetPath);

        if (mode === LockMode.WRITE) {
            if (activeLocks.length > 0) {
                const holder = activeLocks[0];
                throw makeError(
                    ErrorCode.ERR_LOCK_CONFLICT,
                    `路径 ${targetPath} 已被 ${holder.mode} 锁持有，无法获取写锁`,
                    {
                        path: targetPath,
                        holder: {
                            agent_id: holder.agent_id,
                            lease_expire_at: holder.lease_expire_at,
                        },
                    },
                );
            }
        } else {
            const writeLock = activeLocks.find((l) => l.mode === LockMode.WRITE);
            if (writeLock) {
                throw makeError(
                    ErrorCode.ERR_LOCK_CONFLICT,
                    `路径 ${targetPath} 已被写锁持有，无法获取读锁`,
                    {
                        path: targetPath,
                        holder: {
                            agent_id: writeLock.agent_id,
                            lease_expire_at: writeLock.lease_expire_at,
                        },
                    },
                );
            }
        }

        const lockId = randomUUID();
        const lockRecord = {
            lock_id: lockId,
            path: targetPath,
            mode,
            lease_token: leaseToken,
            agent_id: agentId,
            lease_expire_at: leaseExpireAt,
            acquired_at: now().toISOString(),
        };

        const rp = runPaths(runId);
        await atomicWriteJson(rp.lockPath(lockId), lockRecord);
        return { lock_id: lockId };
    }

    /**
     * 释放锁，lease_token 不匹配时拒绝。
     *
     * @param {string} runId
     * @param {string} targetPath
     * @param {string} leaseToken
     */
    async function releaseLock(runId, targetPath, leaseToken) {
        const allLocks = await readAllLocks(runId);
        const matching = allLocks.filter(
            (l) => l.path === targetPath && l.lease_token === leaseToken,
        );

        if (matching.length === 0) {
            throw makePolicyError(
                DenyReason.LOCK_HELD_BY_OTHER,
                `路径 ${targetPath} 未找到匹配 lease_token 的锁，无法释放`,
                { path: targetPath },
            );
        }

        const rp = runPaths(runId);
        for (const lock of matching) {
            try {
                await unlink(rp.lockPath(lock.lock_id));
            } catch (err) {
                if (err.code !== 'ENOENT') throw err;
            }
        }
    }

    return { acquireLock, releaseLock };
}
