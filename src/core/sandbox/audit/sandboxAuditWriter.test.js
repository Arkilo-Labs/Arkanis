import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

import {
    writeHandleJson,
    loadHandleJson,
    writeCommandRecord,
    writeOutputLogs,
    writeEnvFingerprint,
} from './sandboxAuditWriter.js';

function makeTmpDir() {
    return mkdtemp(path.join(tmpdir(), 'audit-test-'));
}

function makeHandle(id) {
    return {
        sandbox_id: id,
        provider_id: 'oci_local',
        engine_resolved: 'docker',
        runtime_resolved: 'native',
        image: 'node:20-bookworm-slim',
        network_policy: 'off',
        workspace_access: 'none',
        created_at: '2026-02-21T12:00:00.000Z',
    };
}

// ── writeHandleJson / loadHandleJson ──────────────

test('writeHandleJson 写入后 loadHandleJson 可完整回读', async () => {
    const dir = await makeTmpDir();
    try {
        const handle = makeHandle('sb_test001');
        await writeHandleJson(dir, 'sb_test001', handle);
        const loaded = await loadHandleJson(dir, 'sb_test001');
        assert.deepEqual(loaded, handle);
    } finally {
        await rm(dir, { recursive: true, force: true });
    }
});

test('loadHandleJson 文件不存在时返回 null', async () => {
    const dir = await makeTmpDir();
    try {
        const result = await loadHandleJson(dir, 'sb_nonexist');
        assert.equal(result, null);
    } finally {
        await rm(dir, { recursive: true, force: true });
    }
});

test('writeHandleJson 自动创建不存在的目录', async () => {
    const dir = await makeTmpDir();
    const deepDir = path.join(dir, 'nested', 'run_01');
    try {
        const handle = makeHandle('sb_deep01');
        await writeHandleJson(deepDir, 'sb_deep01', handle);
        const loaded = await loadHandleJson(deepDir, 'sb_deep01');
        assert.equal(loaded?.sandbox_id, 'sb_deep01');
    } finally {
        await rm(dir, { recursive: true, force: true });
    }
});

test('loadHandleJson 内容损坏时返回 null', async () => {
    const dir = await makeTmpDir();
    try {
        const handle = makeHandle('sb_corrupt');
        await writeHandleJson(dir, 'sb_corrupt', handle);
        // 写入损坏内容
        const { sandboxAuditPaths } = await import('../utils/paths.js');
        const paths = sandboxAuditPaths(dir, 'sb_corrupt');
        const { writeFile } = await import('node:fs/promises');
        await writeFile(paths.handleJson, 'NOT_JSON{{{', 'utf-8');

        const result = await loadHandleJson(dir, 'sb_corrupt');
        assert.equal(result, null);
    } finally {
        await rm(dir, { recursive: true, force: true });
    }
});

// ── writeCommandRecord 累积写入 ───────────────────

test('writeCommandRecord 多次调用后 commands.jsonl 包含对应行数', async () => {
    const dir = await makeTmpDir();
    try {
        const record1 = { run_id: 'r1', sandbox_id: 'sb_acc', cmd: 'node', args: ['-v'], ok: true };
        const record2 = { run_id: 'r1', sandbox_id: 'sb_acc', cmd: 'node', args: ['-e', 'console.log(1)'], ok: true };

        await writeCommandRecord(dir, 'sb_acc', record1);
        await writeCommandRecord(dir, 'sb_acc', record2);

        const { sandboxAuditPaths } = await import('../utils/paths.js');
        const paths = sandboxAuditPaths(dir, 'sb_acc');
        const raw = await readFile(paths.commandsJsonl, 'utf-8');
        const lines = raw.trim().split('\n').filter(Boolean);

        assert.equal(lines.length, 2);
        assert.deepEqual(JSON.parse(lines[0]), record1);
        assert.deepEqual(JSON.parse(lines[1]), record2);
    } finally {
        await rm(dir, { recursive: true, force: true });
    }
});

// ── writeOutputLogs ───────────────────────────────

test('writeOutputLogs 追加写入 stdout/stderr', async () => {
    const dir = await makeTmpDir();
    try {
        await writeOutputLogs(dir, 'sb_logs', { stdout: 'line1\n', stderr: 'err1\n' });
        await writeOutputLogs(dir, 'sb_logs', { stdout: 'line2\n', stderr: 'err2\n' });

        const { sandboxAuditPaths } = await import('../utils/paths.js');
        const paths = sandboxAuditPaths(dir, 'sb_logs');
        const stdout = await readFile(paths.stdoutLog, 'utf-8');
        const stderr = await readFile(paths.stderrLog, 'utf-8');

        assert.equal(stdout, 'line1\nline2\n');
        assert.equal(stderr, 'err1\nerr2\n');
    } finally {
        await rm(dir, { recursive: true, force: true });
    }
});

// ── writeEnvFingerprint ───────────────────────────

test('writeEnvFingerprint 写入后可解析为 JSON', async () => {
    const dir = await makeTmpDir();
    try {
        const snapshot = {
            provider_id: 'oci_local',
            sandbox_id: 'sb_fp',
            image: 'node:20-bookworm-slim',
            engine: 'docker',
            runtime: 'native',
            host_platform: 'linux',
            host_arch: 'x64',
            node_version: 'v20.0.0',
            captured_at: '2026-02-21T12:00:00.000Z',
        };
        await writeEnvFingerprint(dir, 'sb_fp', snapshot);

        const { sandboxAuditPaths } = await import('../utils/paths.js');
        const paths = sandboxAuditPaths(dir, 'sb_fp');
        const raw = await readFile(paths.envFingerprintJson, 'utf-8');
        assert.deepEqual(JSON.parse(raw), snapshot);
    } finally {
        await rm(dir, { recursive: true, force: true });
    }
});

test('writeEnvFingerprint 覆盖写入（最后一次为准）', async () => {
    const dir = await makeTmpDir();
    try {
        await writeEnvFingerprint(dir, 'sb_fp2', { image: 'old', captured_at: 'old' });
        await writeEnvFingerprint(dir, 'sb_fp2', { image: 'new', captured_at: 'new' });

        const { sandboxAuditPaths } = await import('../utils/paths.js');
        const paths = sandboxAuditPaths(dir, 'sb_fp2');
        const raw = await readFile(paths.envFingerprintJson, 'utf-8');
        assert.equal(JSON.parse(raw).image, 'new');
    } finally {
        await rm(dir, { recursive: true, force: true });
    }
});
