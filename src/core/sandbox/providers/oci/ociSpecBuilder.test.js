import test from 'node:test';
import assert from 'node:assert/strict';

import {
    buildCreateArgs,
    buildExecArgs,
    buildDoctorArgs,
    DEFAULT_IMAGE,
    CONTAINER_ARTIFACTS_PATH,
    CONTAINER_WORKSPACE_PATH,
    CONTAINER_TMP_PATH,
} from './ociSpecBuilder.js';

const ARTIFACTS_DIR = '/abs/outputs/agents_team/20260217_153012/artifacts';

function makeHandle(overrides = {}) {
    return {
        provider_id: 'oci_local',
        sandbox_id: 'sb_test',
        created_at: '2026-02-17T15:30:12.000Z',
        engine: 'auto',
        engine_resolved: 'docker',
        runtime: 'auto',
        runtime_resolved: 'native',
        mode: 'sandboxed',
        image: 'node:20-bookworm-slim',
        workspace_access: 'none',
        workspace_mount_path: null,
        network_policy: 'off',
        mounts: [],
        resources: {
            max_wall_clock_ms: 60000,
            max_stdout_bytes: 1048576,
            max_stderr_bytes: 1048576,
            max_memory_mb: 1024,
            max_cpu: 1,
        },
        ...overrides,
    };
}

function makeExecSpec(overrides = {}) {
    return {
        cmd: 'node',
        args: ['-v'],
        ...overrides,
    };
}

// ═══════════════════════════════════════════════
// buildCreateArgs
// ═══════════════════════════════════════════════

test('buildCreateArgs: 前缀为 run -d --name <sandbox_id>', () => {
    const handle = makeHandle({ sandbox_id: 'sb_abc123' });
    const { args } = buildCreateArgs({ handle, artifactsDir: ARTIFACTS_DIR });
    assert.equal(args[0], 'run');
    assert.equal(args[1], '-d');
    assert.equal(args[2], '--name');
    assert.equal(args[3], 'sb_abc123');
});

test('buildCreateArgs: 末尾为 image + sleep infinity', () => {
    const handle = makeHandle({ image: 'node:20-bookworm-slim' });
    const { args } = buildCreateArgs({ handle, artifactsDir: ARTIFACTS_DIR });
    const imgIdx = args.lastIndexOf('node:20-bookworm-slim');
    assert.ok(imgIdx !== -1, 'image should be in args');
    assert.equal(args[imgIdx + 1], 'sleep');
    assert.equal(args[imgIdx + 2], 'infinity');
});

test('buildCreateArgs: network_policy=off -> --network none', () => {
    const { args } = buildCreateArgs({
        handle: makeHandle({ network_policy: 'off' }),
        artifactsDir: ARTIFACTS_DIR,
    });
    assert.ok(args.join(' ').includes('--network none'));
});

test('buildCreateArgs: network_policy=restricted -> --network none', () => {
    const { args } = buildCreateArgs({
        handle: makeHandle({ network_policy: 'restricted' }),
        artifactsDir: ARTIFACTS_DIR,
    });
    assert.ok(args.join(' ').includes('--network none'));
});

test('buildCreateArgs: network_policy=full -> 无 --network 限制', () => {
    const { args } = buildCreateArgs({
        handle: makeHandle({ network_policy: 'full' }),
        artifactsDir: ARTIFACTS_DIR,
    });
    assert.ok(!args.includes('none'), 'network=full should not have --network none');
});

test('buildCreateArgs: runtime_resolved=gvisor -> --runtime=runsc', () => {
    const { args, runtimeNote } = buildCreateArgs({
        handle: makeHandle({ runtime_resolved: 'gvisor' }),
        artifactsDir: ARTIFACTS_DIR,
    });
    assert.ok(args.includes('--runtime=runsc'));
    assert.equal(runtimeNote, 'gvisor');
});

test('buildCreateArgs: runtime_resolved=native -> 无 --runtime 参数', () => {
    const { args, runtimeNote } = buildCreateArgs({
        handle: makeHandle({ runtime_resolved: 'native' }),
        artifactsDir: ARTIFACTS_DIR,
    });
    assert.ok(!args.some((a) => a.startsWith('--runtime')));
    assert.equal(runtimeNote, 'native');
});

test('buildCreateArgs: 包含加固参数', () => {
    const { args } = buildCreateArgs({
        handle: makeHandle(),
        artifactsDir: ARTIFACTS_DIR,
    });
    assert.ok(args.includes('--security-opt'));
    assert.ok(args.includes('no-new-privileges'));
    assert.ok(args.includes('--cap-drop'));
    assert.ok(args.includes('ALL'));
    assert.ok(args.includes('--pids-limit'));
    assert.ok(args.includes('512'));
});

test('buildCreateArgs: 包含 --read-only 与 /tmp tmpfs', () => {
    const { args } = buildCreateArgs({
        handle: makeHandle(),
        artifactsDir: ARTIFACTS_DIR,
    });
    assert.ok(args.includes('--read-only'));
    assert.ok(args.includes('--tmpfs'));
    assert.ok(args.some((a) => a.startsWith(`${CONTAINER_TMP_PATH}:`)));
});

test('buildCreateArgs: max_memory_mb -> --memory 与 --memory-swap', () => {
    const { args } = buildCreateArgs({
        handle: makeHandle({
            resources: { max_wall_clock_ms: 60000, max_stdout_bytes: 1048576, max_stderr_bytes: 1048576, max_memory_mb: 512, max_cpu: 1 },
        }),
        artifactsDir: ARTIFACTS_DIR,
    });
    assert.ok(args.includes('--memory'));
    assert.ok(args.includes('512m'));
    assert.ok(args.includes('--memory-swap'));
});

test('buildCreateArgs: max_cpu -> --cpus', () => {
    const { args } = buildCreateArgs({
        handle: makeHandle({
            resources: { max_wall_clock_ms: 60000, max_stdout_bytes: 1048576, max_stderr_bytes: 1048576, max_memory_mb: 1024, max_cpu: 2 },
        }),
        artifactsDir: ARTIFACTS_DIR,
    });
    assert.ok(args.includes('--cpus'));
    assert.ok(args.includes('2'));
});

test('buildCreateArgs: workspace_access=read_only -> :ro 挂载', () => {
    const { args } = buildCreateArgs({
        handle: makeHandle({ workspace_access: 'read_only', workspace_mount_path: '/host/project' }),
        artifactsDir: ARTIFACTS_DIR,
    });
    assert.ok(args.some((a) => a === `/host/project:${CONTAINER_WORKSPACE_PATH}:ro`));
});

test('buildCreateArgs: workspace_access=read_write -> :rw 挂载', () => {
    const { args } = buildCreateArgs({
        handle: makeHandle({ workspace_access: 'read_write', workspace_mount_path: '/host/project' }),
        artifactsDir: ARTIFACTS_DIR,
    });
    assert.ok(args.some((a) => a === `/host/project:${CONTAINER_WORKSPACE_PATH}:rw`));
});

test('buildCreateArgs: workspace_access=none -> 无 /workspace 挂载', () => {
    const { args } = buildCreateArgs({
        handle: makeHandle({ workspace_access: 'none', workspace_mount_path: null }),
        artifactsDir: ARTIFACTS_DIR,
    });
    assert.ok(!args.some((a) => a.includes(CONTAINER_WORKSPACE_PATH)));
});

test('buildCreateArgs: 包含 artifacts 挂载（rw）', () => {
    const { args } = buildCreateArgs({
        handle: makeHandle(),
        artifactsDir: ARTIFACTS_DIR,
    });
    const expected = `${ARTIFACTS_DIR}:${CONTAINER_ARTIFACTS_PATH}:rw`;
    assert.ok(args.some((a) => a === expected));
});

test('buildCreateArgs: bind mount (read_only=true) -> :ro', () => {
    const { args } = buildCreateArgs({
        handle: makeHandle({
            mounts: [{ type: 'bind', source_path: '/host/data', target_path: '/data', read_only: true }],
        }),
        artifactsDir: ARTIFACTS_DIR,
    });
    assert.ok(args.some((a) => a === '/host/data:/data:ro'));
});

test('buildCreateArgs: bind mount (read_only=false) -> :rw', () => {
    const { args } = buildCreateArgs({
        handle: makeHandle({
            mounts: [{ type: 'bind', source_path: '/host/data', target_path: '/data', read_only: false }],
        }),
        artifactsDir: ARTIFACTS_DIR,
    });
    assert.ok(args.some((a) => a === '/host/data:/data:rw'));
});

test('buildCreateArgs: tmpfs mount（含 size_mb）', () => {
    const { args } = buildCreateArgs({
        handle: makeHandle({
            mounts: [{ type: 'tmpfs', target_path: '/tmp/cache', size_mb: 128, read_only: false }],
        }),
        artifactsDir: ARTIFACTS_DIR,
    });
    let found = false;
    for (let i = 0; i < args.length; i++) {
        if (args[i] === '--tmpfs' && args[i + 1]?.startsWith('/tmp/cache:')) {
            found = true;
            assert.ok(args[i + 1].includes('size=128m'));
            break;
        }
    }
    assert.ok(found, 'should have --tmpfs for /tmp/cache');
});

test('buildCreateArgs: tmpfs mount（无 size_mb）', () => {
    const { args } = buildCreateArgs({
        handle: makeHandle({
            mounts: [{ type: 'tmpfs', target_path: '/run/volatile' }],
        }),
        artifactsDir: ARTIFACTS_DIR,
    });
    let found = false;
    for (let i = 0; i < args.length; i++) {
        if (args[i] === '--tmpfs' && args[i + 1] === '/run/volatile') {
            found = true;
            break;
        }
    }
    assert.ok(found, 'should have --tmpfs /run/volatile');
});

// ═══════════════════════════════════════════════
// buildExecArgs
// ═══════════════════════════════════════════════

test('buildExecArgs: 前缀为 exec <sandbox_id>', () => {
    const handle = makeHandle({ sandbox_id: 'sb_abc123' });
    const { args } = buildExecArgs({ handle, execSpec: makeExecSpec() });
    assert.equal(args[0], 'exec');
    // sandbox_id 在 cmd 之前
    const idIdx = args.indexOf('sb_abc123');
    assert.ok(idIdx !== -1);
});

test('buildExecArgs: 命令与 args 在 sandbox_id 之后', () => {
    const handle = makeHandle({ sandbox_id: 'sb_abc123' });
    const { args } = buildExecArgs({ handle, execSpec: makeExecSpec({ cmd: 'node', args: ['-v', '--check'] }) });
    const idIdx = args.indexOf('sb_abc123');
    assert.equal(args[idIdx + 1], 'node');
    assert.equal(args[idIdx + 2], '-v');
    assert.equal(args[idIdx + 3], '--check');
});

test('buildExecArgs: 不包含加固参数（已在 create 施加）', () => {
    const { args } = buildExecArgs({
        handle: makeHandle(),
        execSpec: makeExecSpec(),
    });
    assert.ok(!args.includes('--cap-drop'), 'exec should not have --cap-drop');
    assert.ok(!args.includes('--security-opt'), 'exec should not have --security-opt');
    assert.ok(!args.includes('--read-only'), 'exec should not have --read-only');
});

test('buildExecArgs: 不包含 volume 挂载参数', () => {
    const { args } = buildExecArgs({
        handle: makeHandle(),
        execSpec: makeExecSpec({ cmd: 'echo', args: ['hello'] }),
    });
    for (let i = 0; i < args.length; i++) {
        if (args[i] === '-v' && args[i + 1]?.includes(':')) {
            assert.fail('exec should not have -v volume mount');
        }
    }
});

test('buildExecArgs: execSpec.cwd -> -w 参数', () => {
    const { args } = buildExecArgs({
        handle: makeHandle(),
        execSpec: makeExecSpec({ cwd: '/workspace/subdir' }),
    });
    const wIdx = args.indexOf('-w');
    assert.notEqual(wIdx, -1);
    assert.equal(args[wIdx + 1], '/workspace/subdir');
});

test('buildExecArgs: 无 cwd 时不添加 -w', () => {
    const { args } = buildExecArgs({
        handle: makeHandle(),
        execSpec: makeExecSpec(),
    });
    assert.ok(!args.includes('-w'));
});

test('buildExecArgs: execSpec.env -> -e KEY=VALUE', () => {
    const { args } = buildExecArgs({
        handle: makeHandle(),
        execSpec: makeExecSpec({ env: { NODE_ENV: 'test', DEBUG: '1' } }),
    });
    assert.ok(args.includes('-e'));
    assert.ok(args.includes('NODE_ENV=test'));
    assert.ok(args.includes('DEBUG=1'));
});

test('buildExecArgs: 无 env 时不添加 -e', () => {
    const { args } = buildExecArgs({
        handle: makeHandle(),
        execSpec: makeExecSpec(),
    });
    assert.ok(!args.includes('-e'));
});

// ═══════════════════════════════════════════════
// buildDoctorArgs（保持不变）
// ═══════════════════════════════════════════════

test('buildDoctorArgs: 包含 --network none', () => {
    const args = buildDoctorArgs('docker', DEFAULT_IMAGE);
    assert.ok(args.includes('--network'));
    assert.ok(args.includes('none'));
});

test('buildDoctorArgs: 包含镜像与 echo ok', () => {
    const args = buildDoctorArgs('docker', 'node:20-bookworm-slim');
    assert.ok(args.includes('node:20-bookworm-slim'));
    assert.ok(args.includes('echo'));
    assert.ok(args.includes('ok'));
});

test('buildDoctorArgs: 无 image 参数时使用 DEFAULT_IMAGE', () => {
    const args = buildDoctorArgs('docker');
    assert.ok(args.includes(DEFAULT_IMAGE));
});

test('buildDoctorArgs: 第一个参数为 run，第二个为 --rm', () => {
    const args = buildDoctorArgs('docker', DEFAULT_IMAGE);
    assert.equal(args[0], 'run');
    assert.equal(args[1], '--rm');
});
