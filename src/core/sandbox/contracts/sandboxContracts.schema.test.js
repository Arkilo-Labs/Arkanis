import test from 'node:test';
import assert from 'node:assert/strict';

import { SandboxErrorCode as ErrorCode } from './sandboxErrors.js';

import { ExecResultSchema } from './execResult.schema.js';
import { ExecSpecSchema } from './execSpec.schema.js';
import { SandboxHandleSchema } from './sandboxHandle.schema.js';
import { SandboxSnapshotSchema } from './sandboxSnapshot.schema.js';
import { SandboxSpecSchema } from './sandboxSpec.schema.js';

const sandboxSpecFixture = {
    version: 1,
    provider_id: 'oci_local',
    engine: 'auto',
    runtime: 'auto',
    mode: 'sandboxed',
    image: 'node:20-bookworm-slim',
    workspace_access: 'none',
    network_policy: 'off',
    mounts: [
        {
            type: 'bind',
            source_path: '/abs/path/to/outputs/agents_team/20260217_153012/artifacts',
            target_path: '/artifacts',
            read_only: false,
        },
    ],
    resources: {
        max_wall_clock_ms: 60000,
        max_stdout_bytes: 1048576,
        max_stderr_bytes: 1048576,
        max_memory_mb: 1024,
        max_cpu: 1,
    },
};

test('SandboxSpecSchema：能 parse 文档 E.1 SandboxSpec fixture', () => {
    assert.deepEqual(SandboxSpecSchema.parse(sandboxSpecFixture), sandboxSpecFixture);
});

test('SandboxSpecSchema：strict 拒绝多余字段', () => {
    assert.throws(() => SandboxSpecSchema.parse({ ...sandboxSpecFixture, extra: 1 }));
});

test('SandboxHandleSchema：能 parse 固定 fixture（含 resolved 字段）', () => {
    const handleFixture = {
        provider_id: 'oci_local',
        sandbox_id: 'sb1',
        created_at: '2026-02-17T15:30:12.000Z',

        engine: 'auto',
        engine_resolved: 'docker',
        runtime: 'auto',
        runtime_resolved: 'native',

        mode: 'sandboxed',
        image: 'node:20-bookworm-slim',

        workspace_access: 'none',
        network_policy: 'off',

        mounts: sandboxSpecFixture.mounts,
        resources: sandboxSpecFixture.resources,
    };

    assert.deepEqual(SandboxHandleSchema.parse(handleFixture), handleFixture);
    assert.throws(() => SandboxHandleSchema.parse({ ...handleFixture, extra: 1 }));
});

test('ExecSpecSchema：能 parse 固定 fixture', () => {
    const execSpecFixture = {
        cmd: 'node',
        args: ['-v'],
        cwd: '/',
        timeout_ms: 5000,
        env: { FOO: 'bar' },
    };

    assert.deepEqual(ExecSpecSchema.parse(execSpecFixture), execSpecFixture);
    assert.throws(() => ExecSpecSchema.parse({ ...execSpecFixture, extra: 1 }));
});

test('ExecResultSchema：ok=true 时 exit_code!=0 不影响 ok 语义', () => {
    const okFixture = {
        started_at: '2026-02-17T15:30:12.000Z',
        ended_at: '2026-02-17T15:30:12.100Z',
        duration_ms: 100,
        timeout_ms: 5000,
        timed_out: false,
        exit_code: 0,
        signal: null,
        stdout: 'v20.0.0\n',
        stderr: '',
        stdout_bytes: 9,
        stderr_bytes: 0,
        stdout_truncated: false,
        stderr_truncated: false,
        stdout_max_bytes: 1048576,
        stderr_max_bytes: 1048576,
        ok: true,
    };

    assert.deepEqual(ExecResultSchema.parse(okFixture), okFixture);
    assert.throws(() => ExecResultSchema.parse({ ...okFixture, extra: 1 }));
});

test('ExecResultSchema：ok=false 时必须带标准化 error', () => {
    const failedFixture = {
        started_at: '2026-02-17T15:30:12.000Z',
        ended_at: '2026-02-17T15:30:17.000Z',
        duration_ms: 5000,
        timeout_ms: 5000,
        timed_out: true,
        exit_code: null,
        signal: null,
        stdout: '',
        stderr: '',
        stdout_bytes: 0,
        stderr_bytes: 0,
        stdout_truncated: false,
        stderr_truncated: false,
        stdout_max_bytes: 1048576,
        stderr_max_bytes: 1048576,
        ok: false,
        error: { code: ErrorCode.ERR_SANDBOX_EXEC_TIMEOUT, message: 'exec timeout' },
    };

    assert.deepEqual(ExecResultSchema.parse(failedFixture), failedFixture);
    assert.throws(() => ExecResultSchema.parse({ ...failedFixture, extra: 1 }));
});

test('SandboxSnapshotSchema：能 parse 固定 fixture', () => {
    const snapshotFixture = {
        provider_id: 'oci_local',
        sandbox_id: 'sb1',
        image: 'node:20-bookworm-slim',
        image_digest: 'sha256:deadbeef',
        engine: 'docker',
        runtime: 'native',
        host_platform: 'darwin',
        host_arch: 'arm64',
        node_version: 'v20.0.0',
        engine_version: 'docker 25.0.0',
        captured_at: '2026-02-17T15:30:12.000Z',
    };

    assert.deepEqual(SandboxSnapshotSchema.parse(snapshotFixture), snapshotFixture);
    assert.throws(() => SandboxSnapshotSchema.parse({ ...snapshotFixture, extra: 1 }));
});

