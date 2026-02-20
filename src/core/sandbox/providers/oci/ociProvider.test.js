import test from 'node:test';
import assert from 'node:assert/strict';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { rm } from 'node:fs/promises';

import { OciProvider } from './ociProvider.js';

// 使用固定 engine/runtime 避免 probe Docker/runsc
function minimalSpec(overrides = {}) {
    return {
        engine: 'docker',
        runtime: 'native',
        mode: 'sandboxed',
        network_policy: 'off',
        workspace_access: 'none',
        ...overrides,
    };
}

// ── createSandbox ────────────────────────────────────────────────

test('OciProvider: createSandbox 返回合法 handle 结构', async () => {
    const provider = new OciProvider();
    const handle = await provider.createSandbox(minimalSpec());

    assert.equal(handle.provider_id, 'oci_local');
    assert.match(handle.sandbox_id, /^sb_[0-9a-f]{12}$/);
    assert.match(handle.created_at, /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/);
    assert.equal(handle.engine_resolved, 'docker');
    assert.equal(handle.runtime_resolved, 'native');
    assert.equal(handle.network_policy, 'off');
    assert.equal(handle.workspace_access, 'none');
    assert.equal(handle.mode, 'sandboxed');
});

test('OciProvider: createSandbox 每次生成唯一 sandbox_id', async () => {
    const provider = new OciProvider();
    const [h1, h2, h3] = await Promise.all([
        provider.createSandbox(minimalSpec()),
        provider.createSandbox(minimalSpec()),
        provider.createSandbox(minimalSpec()),
    ]);
    const ids = new Set([h1.sandbox_id, h2.sandbox_id, h3.sandbox_id]);
    assert.equal(ids.size, 3, 'sandbox_id 应全部唯一');
});

test('OciProvider: createSandbox 继承 defaultSpec 的 image', async () => {
    const provider = new OciProvider({ defaultSpec: { image: 'alpine:3.19' } });
    const handle = await provider.createSandbox(minimalSpec());
    assert.equal(handle.image, 'alpine:3.19');
});

test('OciProvider: createSandbox spec.image 优先于 defaultSpec.image', async () => {
    const provider = new OciProvider({ defaultSpec: { image: 'alpine:3.19' } });
    const handle = await provider.createSandbox(minimalSpec({ image: 'node:20-bookworm-slim' }));
    assert.equal(handle.image, 'node:20-bookworm-slim');
});

test('OciProvider: createSandbox 无 mounts 时 handle.mounts 为空数组', async () => {
    const provider = new OciProvider();
    const handle = await provider.createSandbox(minimalSpec());
    assert.deepEqual(handle.mounts, []);
});

// ── docker.sock 安全拦截 ──────────────────────────────────────────

test('OciProvider: createSandbox 拒绝挂载 docker.sock', async () => {
    const provider = new OciProvider();
    await assert.rejects(
        () =>
            provider.createSandbox(
                minimalSpec({
                    mounts: [
                        {
                            type: 'bind',
                            source_path: '/var/run/docker.sock',
                            target_path: '/var/run/docker.sock',
                            read_only: false,
                        },
                    ],
                }),
            ),
        (err) => {
            assert.equal(err.code, 'ERR_SANDBOX_START_FAILED');
            assert.ok(
                err.message.includes('docker.sock'),
                `message 应含 docker.sock，实际: ${err.message}`,
            );
            return true;
        },
    );
});

test('OciProvider: createSandbox 拒绝挂载 podman.sock', async () => {
    const provider = new OciProvider();
    await assert.rejects(
        () =>
            provider.createSandbox(
                minimalSpec({
                    mounts: [
                        {
                            type: 'bind',
                            source_path: '/run/podman/podman.sock',
                            target_path: '/run/podman.sock',
                            read_only: true,
                        },
                    ],
                }),
            ),
        (err) => {
            assert.equal(err.code, 'ERR_SANDBOX_START_FAILED');
            return true;
        },
    );
});

test('OciProvider: createSandbox 允许普通 bind mount', async () => {
    const provider = new OciProvider();
    const handle = await provider.createSandbox(
        minimalSpec({
            mounts: [
                {
                    type: 'bind',
                    source_path: '/tmp/safe-data',
                    target_path: '/data',
                    read_only: true,
                },
            ],
        }),
    );
    assert.equal(handle.mounts.length, 1);
    assert.equal(handle.mounts[0].source_path, '/tmp/safe-data');
});

// ── exec — spawn 错误路径（无需 Docker）────────────────────────────

test('OciProvider: exec 使用不存在的 engine 时返回 ok=false（spawnError）', async () => {
    const provider = new OciProvider();
    const handle = await provider.createSandbox(minimalSpec());

    const artifactsDir = join(tmpdir(), `oci-test-${Date.now()}`);
    let result;
    try {
        result = await provider.exec(
            { ...handle, engine_resolved: '__nonexistent_engine_xyz__' },
            { cmd: 'echo', args: ['hello'] },
            { artifactsDir },
        );
    } finally {
        await rm(artifactsDir, { recursive: true, force: true });
    }

    assert.equal(result.ok, false);
    assert.ok(result.error, 'should have error field');
    assert.equal(result.error.code, 'ERR_SANDBOX_EXEC_FAILED');
});

test('OciProvider: exec 缺少 artifactsDir 时抛错', async () => {
    const provider = new OciProvider();
    const handle = await provider.createSandbox(minimalSpec());

    await assert.rejects(
        () => provider.exec(handle, { cmd: 'echo', args: [] }, { artifactsDir: '' }),
        (err) => {
            assert.equal(err.code, 'ERR_SANDBOX_EXEC_FAILED');
            return true;
        },
    );
});

test('OciProvider: exec 会创建 artifactsDir（若不存在）', async () => {
    const { stat } = await import('node:fs/promises');
    const provider = new OciProvider();
    const handle = await provider.createSandbox(minimalSpec());

    const artifactsDir = join(tmpdir(), `oci-mkdir-test-${Date.now()}`);
    // 使用不存在的 engine 让 exec 快速失败（但 mkdir 应已完成）
    await provider
        .exec(
            { ...handle, engine_resolved: '__nonexistent_engine_xyz__' },
            { cmd: 'echo', args: [] },
            { artifactsDir },
        )
        .catch(() => {});

    try {
        const info = await stat(artifactsDir);
        assert.ok(info.isDirectory(), 'artifactsDir 应已被创建');
    } finally {
        await rm(artifactsDir, { recursive: true, force: true });
    }
});

// ── snapshot ─────────────────────────────────────────────────────

test('OciProvider: snapshot 返回合法结构', async () => {
    const provider = new OciProvider();
    const handle = await provider.createSandbox(minimalSpec());
    const snap = await provider.snapshot(handle);

    assert.equal(snap.provider_id, 'oci_local');
    assert.equal(snap.sandbox_id, handle.sandbox_id);
    assert.equal(snap.image, handle.image);
    assert.equal(snap.engine, handle.engine_resolved);
    assert.equal(snap.runtime, handle.runtime_resolved);
    assert.ok(typeof snap.host_platform === 'string');
    assert.ok(typeof snap.host_arch === 'string');
    assert.match(snap.node_version, /^v\d+\.\d+/);
    assert.match(snap.captured_at, /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/);
});
