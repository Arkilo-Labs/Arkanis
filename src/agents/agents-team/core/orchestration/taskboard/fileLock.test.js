import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readdir } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { randomUUID } from 'node:crypto';

import { createFileLock, LockMode } from './fileLock.js';
import { ErrorCode } from '../../contracts/errors.js';
import { DenyReason } from '../../contracts/denyReasons.js';

const RUN_ID = '20260101_120000';
const LEASE_MS = 60_000;
const TARGET_PATH = '/workspace/artifacts/result.json';
const OTHER_PATH = '/workspace/artifacts/other.json';

async function makeEnv() {
    const dir = await mkdtemp(join(tmpdir(), 'arkanis-p6-fl-'));
    const outputDir = join(dir, 'outputs/agents_team');
    return { outputDir };
}

function futureIso(offsetMs, base = new Date()) {
    return new Date(base.getTime() + offsetMs).toISOString();
}

function makeLease(agentId = 'agent-a', offsetMs = LEASE_MS, base = new Date()) {
    return {
        leaseToken: randomUUID(),
        agentId,
        leaseExpireAt: futureIso(offsetMs, base),
    };
}

// --- 读-读共存 ---

test('read-read：同一路径两个读锁均可成功获取', async () => {
    const { outputDir } = await makeEnv();
    const fl = createFileLock({ outputDir });

    const l1 = makeLease('agent-a');
    const l2 = makeLease('agent-b');

    const r1 = await fl.acquireLock(RUN_ID, { targetPath: TARGET_PATH, mode: LockMode.READ, ...l1 });
    const r2 = await fl.acquireLock(RUN_ID, { targetPath: TARGET_PATH, mode: LockMode.READ, ...l2 });

    assert.ok(r1.lock_id, '第一个读锁应返回 lock_id');
    assert.ok(r2.lock_id, '第二个读锁应返回 lock_id');
    assert.notEqual(r1.lock_id, r2.lock_id, '两个锁的 lock_id 应不同');
});

// --- 写-写冲突 ---

test('write-write：第二个写锁应抛 ERR_LOCK_CONFLICT，包含 holder 信息', async () => {
    const { outputDir } = await makeEnv();
    const fl = createFileLock({ outputDir });

    const l1 = makeLease('agent-a');
    await fl.acquireLock(RUN_ID, { targetPath: TARGET_PATH, mode: LockMode.WRITE, ...l1 });

    const l2 = makeLease('agent-b');
    await assert.rejects(
        () => fl.acquireLock(RUN_ID, { targetPath: TARGET_PATH, mode: LockMode.WRITE, ...l2 }),
        (err) => {
            assert.equal(err.code, ErrorCode.ERR_LOCK_CONFLICT);
            assert.equal(err.details.holder.agent_id, 'agent-a');
            assert.ok(err.details.holder.lease_expire_at, 'holder 应包含 lease_expire_at');
            return true;
        },
    );
});

// --- 写-读冲突（已有读锁，尝试写锁）---

test('write-read：已有读锁时写锁被拒绝，抛 ERR_LOCK_CONFLICT', async () => {
    const { outputDir } = await makeEnv();
    const fl = createFileLock({ outputDir });

    const l1 = makeLease('agent-a');
    await fl.acquireLock(RUN_ID, { targetPath: TARGET_PATH, mode: LockMode.READ, ...l1 });

    const l2 = makeLease('agent-b');
    await assert.rejects(
        () => fl.acquireLock(RUN_ID, { targetPath: TARGET_PATH, mode: LockMode.WRITE, ...l2 }),
        (err) => {
            assert.equal(err.code, ErrorCode.ERR_LOCK_CONFLICT);
            assert.equal(err.details.holder.agent_id, 'agent-a');
            return true;
        },
    );
});

// --- 读-写冲突（已有写锁，尝试读锁）---

test('read-write：已有写锁时读锁被拒绝，抛 ERR_LOCK_CONFLICT', async () => {
    const { outputDir } = await makeEnv();
    const fl = createFileLock({ outputDir });

    const l1 = makeLease('agent-a');
    await fl.acquireLock(RUN_ID, { targetPath: TARGET_PATH, mode: LockMode.WRITE, ...l1 });

    const l2 = makeLease('agent-b');
    await assert.rejects(
        () => fl.acquireLock(RUN_ID, { targetPath: TARGET_PATH, mode: LockMode.READ, ...l2 }),
        (err) => {
            assert.equal(err.code, ErrorCode.ERR_LOCK_CONFLICT);
            assert.equal(err.details.holder.agent_id, 'agent-a');
            return true;
        },
    );
});

// --- 不同路径互不影响 ---

test('不同路径的写锁互不干扰', async () => {
    const { outputDir } = await makeEnv();
    const fl = createFileLock({ outputDir });

    const l1 = makeLease('agent-a');
    const l2 = makeLease('agent-b');

    await fl.acquireLock(RUN_ID, { targetPath: TARGET_PATH, mode: LockMode.WRITE, ...l1 });
    // 不同路径，不应冲突
    const r2 = await fl.acquireLock(RUN_ID, { targetPath: OTHER_PATH, mode: LockMode.WRITE, ...l2 });
    assert.ok(r2.lock_id);
});

// --- 超时自动释放 ---

test('超时锁在 acquireLock 时被清理，新锁可获取', async () => {
    const { outputDir } = await makeEnv();

    // 用过去时间作为过期时间，让锁立即过期
    const pastExpire = new Date(Date.now() - 1).toISOString();
    const l1 = { leaseToken: randomUUID(), agentId: 'agent-a', leaseExpireAt: pastExpire };

    const flReal = createFileLock({ outputDir });
    await flReal.acquireLock(RUN_ID, { targetPath: TARGET_PATH, mode: LockMode.WRITE, ...l1 });

    // 使用快进时钟：锁已过期，acquireLock 会先清理再获取
    const future = new Date(Date.now() + LEASE_MS * 2);
    const flFuture = createFileLock({ outputDir, now: () => future });

    const l2 = makeLease('agent-b', LEASE_MS, future);
    const r2 = await flFuture.acquireLock(RUN_ID, { targetPath: TARGET_PATH, mode: LockMode.WRITE, ...l2 });
    assert.ok(r2.lock_id, '过期锁清理后新锁应能获取');
});

test('超时读锁被清理后写锁可获取', async () => {
    const { outputDir } = await makeEnv();

    const pastExpire = new Date(Date.now() - 1).toISOString();
    const l1 = { leaseToken: randomUUID(), agentId: 'agent-a', leaseExpireAt: pastExpire };

    const flReal = createFileLock({ outputDir });
    await flReal.acquireLock(RUN_ID, { targetPath: TARGET_PATH, mode: LockMode.READ, ...l1 });

    const future = new Date(Date.now() + LEASE_MS * 2);
    const flFuture = createFileLock({ outputDir, now: () => future });

    const l2 = makeLease('agent-b', LEASE_MS, future);
    const r2 = await flFuture.acquireLock(RUN_ID, { targetPath: TARGET_PATH, mode: LockMode.WRITE, ...l2 });
    assert.ok(r2.lock_id);
});

// --- releaseLock 正常流程 ---

test('releaseLock 正常释放后路径可重新加锁', async () => {
    const { outputDir } = await makeEnv();
    const fl = createFileLock({ outputDir });

    const l1 = makeLease('agent-a');
    await fl.acquireLock(RUN_ID, { targetPath: TARGET_PATH, mode: LockMode.WRITE, ...l1 });

    // 释放
    await fl.releaseLock(RUN_ID, TARGET_PATH, l1.leaseToken);

    // 重新加锁
    const l2 = makeLease('agent-b');
    const r2 = await fl.acquireLock(RUN_ID, { targetPath: TARGET_PATH, mode: LockMode.WRITE, ...l2 });
    assert.ok(r2.lock_id, '释放后应可重新加锁');
});

test('releaseLock 释放后锁文件从 locks 目录消失', async () => {
    const { outputDir } = await makeEnv();
    const fl = createFileLock({ outputDir });
    const { createRunPaths } = await import('../../outputs/runPaths.js');

    const l1 = makeLease('agent-a');
    const { lock_id } = await fl.acquireLock(RUN_ID, { targetPath: TARGET_PATH, mode: LockMode.WRITE, ...l1 });

    const rp = createRunPaths({ outputDir, runId: RUN_ID });
    let entries = await readdir(rp.locksDir);
    assert.ok(entries.some((f) => f.startsWith(lock_id)), '锁文件应存在');

    await fl.releaseLock(RUN_ID, TARGET_PATH, l1.leaseToken);

    entries = await readdir(rp.locksDir);
    assert.ok(!entries.some((f) => f.startsWith(lock_id)), '锁文件应已删除');
});

// --- 错误 lease_token 无法 release ---

test('releaseLock 错误 lease_token 被拒绝，抛 ERR_POLICY_DENIED + LOCK_HELD_BY_OTHER', async () => {
    const { outputDir } = await makeEnv();
    const fl = createFileLock({ outputDir });

    const l1 = makeLease('agent-a');
    await fl.acquireLock(RUN_ID, { targetPath: TARGET_PATH, mode: LockMode.WRITE, ...l1 });

    await assert.rejects(
        () => fl.releaseLock(RUN_ID, TARGET_PATH, randomUUID()),
        (err) => {
            assert.equal(err.code, ErrorCode.ERR_POLICY_DENIED);
            assert.equal(err.deny_reason, DenyReason.LOCK_HELD_BY_OTHER);
            return true;
        },
    );
});

test('releaseLock 不存在的路径被拒绝，抛 ERR_POLICY_DENIED + LOCK_HELD_BY_OTHER', async () => {
    const { outputDir } = await makeEnv();
    const fl = createFileLock({ outputDir });

    await assert.rejects(
        () => fl.releaseLock(RUN_ID, TARGET_PATH, randomUUID()),
        (err) => {
            assert.equal(err.code, ErrorCode.ERR_POLICY_DENIED);
            assert.equal(err.deny_reason, DenyReason.LOCK_HELD_BY_OTHER);
            return true;
        },
    );
});

// --- read 锁释放后写锁可获取 ---

test('释放全部读锁后写锁可获取', async () => {
    const { outputDir } = await makeEnv();
    const fl = createFileLock({ outputDir });

    const l1 = makeLease('agent-a');
    const l2 = makeLease('agent-b');
    await fl.acquireLock(RUN_ID, { targetPath: TARGET_PATH, mode: LockMode.READ, ...l1 });
    await fl.acquireLock(RUN_ID, { targetPath: TARGET_PATH, mode: LockMode.READ, ...l2 });

    await fl.releaseLock(RUN_ID, TARGET_PATH, l1.leaseToken);
    await fl.releaseLock(RUN_ID, TARGET_PATH, l2.leaseToken);

    const l3 = makeLease('agent-c');
    const r3 = await fl.acquireLock(RUN_ID, { targetPath: TARGET_PATH, mode: LockMode.WRITE, ...l3 });
    assert.ok(r3.lock_id);
});
