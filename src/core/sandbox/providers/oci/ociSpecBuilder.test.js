import test from 'node:test';
import assert from 'node:assert/strict';

import {
    buildRunArgs,
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

// ──────────────────────────────────────────────
// 网络策略

test('ociSpecBuilder: network_policy=off → --network none', () => {
    const { args } = buildRunArgs({
        handle: makeHandle({ network_policy: 'off' }),
        execSpec: makeExecSpec(),
        artifactsDir: ARTIFACTS_DIR,
    });
    const joined = args.join(' ');
    assert.ok(joined.includes('--network none'), `expected --network none in: ${joined}`);
});

test('ociSpecBuilder: network_policy=restricted → --network none', () => {
    const { args } = buildRunArgs({
        handle: makeHandle({ network_policy: 'restricted' }),
        execSpec: makeExecSpec(),
        artifactsDir: ARTIFACTS_DIR,
    });
    const joined = args.join(' ');
    assert.ok(joined.includes('--network none'), `expected --network none in: ${joined}`);
});

test('ociSpecBuilder: network_policy=full → 无 --network 限制', () => {
    const { args } = buildRunArgs({
        handle: makeHandle({ network_policy: 'full' }),
        execSpec: makeExecSpec(),
        artifactsDir: ARTIFACTS_DIR,
    });
    assert.ok(!args.includes('none'), 'network=full 不应有 --network none');
});

// ──────────────────────────────────────────────
// runtime

test('ociSpecBuilder: runtime_resolved=gvisor → --runtime=runsc', () => {
    const { args, runtimeNote } = buildRunArgs({
        handle: makeHandle({ runtime_resolved: 'gvisor' }),
        execSpec: makeExecSpec(),
        artifactsDir: ARTIFACTS_DIR,
    });
    assert.ok(args.includes('--runtime=runsc'), `expected --runtime=runsc in: ${args.join(' ')}`);
    assert.equal(runtimeNote, 'gvisor');
});

test('ociSpecBuilder: runtime_resolved=native → 无 --runtime 参数', () => {
    const { args, runtimeNote } = buildRunArgs({
        handle: makeHandle({ runtime_resolved: 'native' }),
        execSpec: makeExecSpec(),
        artifactsDir: ARTIFACTS_DIR,
    });
    assert.ok(
        !args.some((a) => a.startsWith('--runtime')),
        `native 不应有 --runtime in: ${args.join(' ')}`,
    );
    assert.equal(runtimeNote, 'native');
});

// ──────────────────────────────────────────────
// artifacts 挂载

test('ociSpecBuilder: 包含 artifacts 挂载（rw）', () => {
    const { args } = buildRunArgs({
        handle: makeHandle(),
        execSpec: makeExecSpec(),
        artifactsDir: ARTIFACTS_DIR,
    });
    const expected = `${ARTIFACTS_DIR}:${CONTAINER_ARTIFACTS_PATH}:rw`;
    const vIdx = args.indexOf('-v');
    let found = false;
    while (vIdx !== -1) {
        const idx = args.indexOf('-v', found ? args.lastIndexOf('-v') + 1 : 0);
        if (idx === -1) break;
        if (args[idx + 1] === expected) { found = true; break; }
        // advance
        const next = args.indexOf('-v', idx + 1);
        if (next === idx) break;
        if (next !== -1 && args[next + 1] === expected) { found = true; break; }
        break;
    }
    // simpler check: look for the mount string in the flat arg list
    assert.ok(
        args.some((a) => a === expected),
        `expected artifacts mount ${expected} in args`,
    );
});

// ──────────────────────────────────────────────
// workspace 挂载

test('ociSpecBuilder: workspace_access=read_only → :ro 挂载', () => {
    const workspacePath = '/host/project';
    const { args } = buildRunArgs({
        handle: makeHandle({
            workspace_access: 'read_only',
            workspace_mount_path: workspacePath,
        }),
        execSpec: makeExecSpec(),
        artifactsDir: ARTIFACTS_DIR,
    });
    const expected = `${workspacePath}:${CONTAINER_WORKSPACE_PATH}:ro`;
    assert.ok(args.some((a) => a === expected), `expected workspace ro mount in args`);
});

test('ociSpecBuilder: workspace_access=read_write → :rw 挂载', () => {
    const workspacePath = '/host/project';
    const { args } = buildRunArgs({
        handle: makeHandle({
            workspace_access: 'read_write',
            workspace_mount_path: workspacePath,
        }),
        execSpec: makeExecSpec(),
        artifactsDir: ARTIFACTS_DIR,
    });
    const expected = `${workspacePath}:${CONTAINER_WORKSPACE_PATH}:rw`;
    assert.ok(args.some((a) => a === expected), `expected workspace rw mount in args`);
});

test('ociSpecBuilder: workspace_access=none → 无 /workspace 挂载', () => {
    const { args } = buildRunArgs({
        handle: makeHandle({ workspace_access: 'none', workspace_mount_path: null }),
        execSpec: makeExecSpec(),
        artifactsDir: ARTIFACTS_DIR,
    });
    assert.ok(
        !args.some((a) => a.includes(CONTAINER_WORKSPACE_PATH)),
        `workspace_access=none 不应挂载 /workspace`,
    );
});

// ──────────────────────────────────────────────
// 资源限制

test('ociSpecBuilder: max_memory_mb → --memory 与 --memory-swap', () => {
    const { args } = buildRunArgs({
        handle: makeHandle({ resources: { max_wall_clock_ms: 60000, max_stdout_bytes: 1048576, max_stderr_bytes: 1048576, max_memory_mb: 512, max_cpu: 1 } }),
        execSpec: makeExecSpec(),
        artifactsDir: ARTIFACTS_DIR,
    });
    assert.ok(args.includes('--memory'), 'should have --memory');
    assert.ok(args.includes('512m'), 'should have 512m');
    assert.ok(args.includes('--memory-swap'), 'should have --memory-swap');
});

test('ociSpecBuilder: max_cpu → --cpus', () => {
    const { args } = buildRunArgs({
        handle: makeHandle({ resources: { max_wall_clock_ms: 60000, max_stdout_bytes: 1048576, max_stderr_bytes: 1048576, max_memory_mb: 1024, max_cpu: 2 } }),
        execSpec: makeExecSpec(),
        artifactsDir: ARTIFACTS_DIR,
    });
    assert.ok(args.includes('--cpus'), 'should have --cpus');
    assert.ok(args.includes('2'), 'should have cpu value 2');
});

// ──────────────────────────────────────────────
// 加固参数

test('ociSpecBuilder: 包含加固参数（no-new-privileges / cap-drop / pids-limit）', () => {
    const { args } = buildRunArgs({
        handle: makeHandle(),
        execSpec: makeExecSpec(),
        artifactsDir: ARTIFACTS_DIR,
    });
    assert.ok(args.includes('--security-opt'), 'should have --security-opt');
    assert.ok(args.includes('no-new-privileges'), 'should have no-new-privileges');
    assert.ok(args.includes('--cap-drop'), 'should have --cap-drop');
    assert.ok(args.includes('ALL'), 'should have ALL for cap-drop');
    assert.ok(args.includes('--pids-limit'), 'should have --pids-limit');
    assert.ok(args.includes('512'), 'should have pids-limit value 512');
});

// ──────────────────────────────────────────────
// read-only rootfs + tmpfs

test('ociSpecBuilder: 包含 --read-only 与 /tmp tmpfs', () => {
    const { args } = buildRunArgs({
        handle: makeHandle(),
        execSpec: makeExecSpec(),
        artifactsDir: ARTIFACTS_DIR,
    });
    assert.ok(args.includes('--read-only'), 'should have --read-only');
    assert.ok(args.includes('--tmpfs'), 'should have --tmpfs');
    assert.ok(
        args.some((a) => a.startsWith(`${CONTAINER_TMP_PATH}:`)),
        `should have tmpfs for ${CONTAINER_TMP_PATH}`,
    );
});

// ──────────────────────────────────────────────
// 命令与镜像顺序

test('ociSpecBuilder: 镜像、命令、args 在末尾且顺序正确', () => {
    const image = 'node:20-bookworm-slim';
    const { args } = buildRunArgs({
        handle: makeHandle({ image }),
        execSpec: makeExecSpec({ cmd: 'node', args: ['-v', '--check'] }),
        artifactsDir: ARTIFACTS_DIR,
    });
    const imgIdx = args.lastIndexOf(image);
    assert.ok(imgIdx !== -1, 'image should be in args');
    assert.equal(args[imgIdx + 1], 'node', 'cmd after image');
    assert.equal(args[imgIdx + 2], '-v', 'first arg after cmd');
    assert.equal(args[imgIdx + 3], '--check', 'second arg after cmd');
});

test('ociSpecBuilder: 第一个参数为 run，第二个为 --rm', () => {
    const { args } = buildRunArgs({
        handle: makeHandle(),
        execSpec: makeExecSpec(),
        artifactsDir: ARTIFACTS_DIR,
    });
    assert.equal(args[0], 'run');
    assert.equal(args[1], '--rm');
});

// ──────────────────────────────────────────────
// cwd 与 env

test('ociSpecBuilder: execSpec.cwd → -w 参数', () => {
    const { args } = buildRunArgs({
        handle: makeHandle(),
        execSpec: makeExecSpec({ cwd: '/workspace/subdir' }),
        artifactsDir: ARTIFACTS_DIR,
    });
    const wIdx = args.indexOf('-w');
    assert.notEqual(wIdx, -1, 'should have -w');
    assert.equal(args[wIdx + 1], '/workspace/subdir');
});

test('ociSpecBuilder: 无 cwd 时不添加 -w', () => {
    const { args } = buildRunArgs({
        handle: makeHandle(),
        execSpec: makeExecSpec(),
        artifactsDir: ARTIFACTS_DIR,
    });
    assert.ok(!args.includes('-w'), 'no -w when cwd is not set');
});

test('ociSpecBuilder: execSpec.env → -e KEY=VALUE 参数', () => {
    const { args } = buildRunArgs({
        handle: makeHandle(),
        execSpec: makeExecSpec({ env: { NODE_ENV: 'test', DEBUG: '1' } }),
        artifactsDir: ARTIFACTS_DIR,
    });
    assert.ok(args.includes('-e'), 'should have -e');
    assert.ok(args.includes('NODE_ENV=test'), 'should have NODE_ENV=test');
    assert.ok(args.includes('DEBUG=1'), 'should have DEBUG=1');
});

test('ociSpecBuilder: 无 env 时不添加 -e', () => {
    const { args } = buildRunArgs({
        handle: makeHandle(),
        execSpec: makeExecSpec(),
        artifactsDir: ARTIFACTS_DIR,
    });
    assert.ok(!args.includes('-e'), 'no -e when env is not set');
});

// ──────────────────────────────────────────────
// 自定义挂载（handle.mounts）

test('ociSpecBuilder: bind mount（read_only=true）→ :ro', () => {
    const { args } = buildRunArgs({
        handle: makeHandle({
            mounts: [
                {
                    type: 'bind',
                    source_path: '/host/data',
                    target_path: '/data',
                    read_only: true,
                },
            ],
        }),
        execSpec: makeExecSpec(),
        artifactsDir: ARTIFACTS_DIR,
    });
    assert.ok(args.some((a) => a === '/host/data:/data:ro'), 'bind mount ro should be in args');
});

test('ociSpecBuilder: bind mount（read_only=false）→ :rw', () => {
    const { args } = buildRunArgs({
        handle: makeHandle({
            mounts: [
                {
                    type: 'bind',
                    source_path: '/host/data',
                    target_path: '/data',
                    read_only: false,
                },
            ],
        }),
        execSpec: makeExecSpec(),
        artifactsDir: ARTIFACTS_DIR,
    });
    assert.ok(args.some((a) => a === '/host/data:/data:rw'), 'bind mount rw should be in args');
});

test('ociSpecBuilder: tmpfs mount（含 size_mb）→ --tmpfs target:size=Xm,rw', () => {
    const { args } = buildRunArgs({
        handle: makeHandle({
            mounts: [
                {
                    type: 'tmpfs',
                    target_path: '/tmp/cache',
                    size_mb: 128,
                    read_only: false,
                },
            ],
        }),
        execSpec: makeExecSpec(),
        artifactsDir: ARTIFACTS_DIR,
    });
    const tmpfsIdx = args.indexOf('--tmpfs');
    // 可能有多个 --tmpfs（/tmp 与 /tmp/cache），找包含 /tmp/cache 的那个
    let found = false;
    for (let i = 0; i < args.length; i++) {
        if (args[i] === '--tmpfs' && args[i + 1]?.startsWith('/tmp/cache:')) {
            found = true;
            assert.ok(args[i + 1].includes('size=128m'), 'should include size=128m');
            break;
        }
    }
    assert.ok(found, 'should have --tmpfs for /tmp/cache');
});

test('ociSpecBuilder: tmpfs mount（无 size_mb）→ --tmpfs target', () => {
    const { args } = buildRunArgs({
        handle: makeHandle({
            mounts: [
                {
                    type: 'tmpfs',
                    target_path: '/run/volatile',
                },
            ],
        }),
        execSpec: makeExecSpec(),
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

// ──────────────────────────────────────────────
// buildDoctorArgs

test('buildDoctorArgs: 包含 --network none', () => {
    const args = buildDoctorArgs('docker', DEFAULT_IMAGE);
    assert.ok(args.includes('--network'), 'should have --network');
    assert.ok(args.includes('none'), 'should have none');
});

test('buildDoctorArgs: 包含镜像与 echo ok', () => {
    const args = buildDoctorArgs('docker', 'node:20-bookworm-slim');
    assert.ok(args.includes('node:20-bookworm-slim'), 'should include image');
    assert.ok(args.includes('echo'), 'should include echo');
    assert.ok(args.includes('ok'), 'should include ok');
});

test('buildDoctorArgs: 无 image 参数时使用 DEFAULT_IMAGE', () => {
    const args = buildDoctorArgs('docker');
    assert.ok(args.includes(DEFAULT_IMAGE), 'should use DEFAULT_IMAGE');
});

test('buildDoctorArgs: 第一个参数为 run，第二个为 --rm', () => {
    const args = buildDoctorArgs('docker', DEFAULT_IMAGE);
    assert.equal(args[0], 'run');
    assert.equal(args[1], '--rm');
});
