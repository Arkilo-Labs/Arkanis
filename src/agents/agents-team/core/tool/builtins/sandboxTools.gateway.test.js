import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, mkdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { SandboxRegistry } from '../../../../../core/sandbox/sandboxRegistry.js';
import { ArtifactRegistry } from '../../artifacts/artifactRegistry.js';
import { PolicyEngine } from '../../policy/policyEngine.js';
import { ToolRegistry } from '../toolRegistry.js';
import { ToolGateway } from '../toolGateway.js';
import { RunContext } from '../../runtime/runContext.js';
import { createRunPaths } from '../../outputs/runPaths.js';
import { ErrorCode } from '../../contracts/errors.js';
import { DenyReason } from '../../contracts/denyReasons.js';

import { sandboxCreateTool } from './sandboxCreate.tool.js';
import { sandboxExecTool } from './sandboxExec.tool.js';
import { sandboxDestroyTool } from './sandboxDestroy.tool.js';

function splitJsonl(raw) {
    return String(raw || '')
        .split('\n')
        .map((l) => l.trim())
        .filter(Boolean);
}

function makeMockProvider({ execResult } = {}) {
    return {
        async createSandbox(spec, opts) {
            if (opts?.artifactsDir) {
                await mkdir(opts.artifactsDir, { recursive: true });
            }
            return {
                provider_id: 'oci_local',
                sandbox_id: 'sb_test01',
                created_at: new Date().toISOString(),
                engine: spec.engine ?? 'auto',
                engine_resolved: 'docker',
                runtime: spec.runtime ?? 'auto',
                runtime_resolved: 'native',
                mode: spec.mode ?? 'sandboxed',
                image: spec.image ?? 'node:20-bookworm-slim',
                workspace_access: spec.workspace_access ?? 'none',
                network_policy: spec.network_policy ?? 'off',
                mounts: [],
                resources: {},
            };
        },
        async exec(_handle, _execSpec) {
            if (execResult) return execResult;
            return {
                ok: true,
                exit_code: 0,
                timed_out: false,
                stdout: 'v20.0.0\n',
                stderr: '',
                stdout_bytes: 10,
                stderr_bytes: 0,
                stdout_truncated: false,
                stderr_truncated: false,
                started_at: new Date().toISOString(),
                ended_at: new Date().toISOString(),
                duration_ms: 50,
                signal: null,
                stdout_max_bytes: 4194304,
                stderr_max_bytes: 1048576,
            };
        },
        async destroy(_handle) {},
        async snapshot(handle) {
            return {
                provider_id: handle.provider_id,
                sandbox_id: handle.sandbox_id,
                image: handle.image,
                engine: handle.engine_resolved,
                runtime: handle.runtime_resolved,
                host_platform: 'linux',
                host_arch: 'x64',
                node_version: process.version,
                captured_at: new Date().toISOString(),
            };
        },
    };
}

async function makeCtx({ policyConfig = {}, execResult } = {}) {
    const tmpDir = await mkdtemp(path.join(tmpdir(), 'arkanis-p13-'));
    const runPaths = createRunPaths({ outputDir: tmpDir, runId: '20260221_000000' });

    const sandboxProvider = makeMockProvider({ execResult });
    const sandboxRegistry = new SandboxRegistry();
    const artifactRegistry = new ArtifactRegistry({ artifactsDir: runPaths.artifactsDir });
    const policyEngine = new PolicyEngine(policyConfig);

    const toolRegistry = new ToolRegistry();
    toolRegistry.register(sandboxCreateTool);
    toolRegistry.register(sandboxExecTool);
    toolRegistry.register(sandboxDestroyTool);

    const toolGateway = new ToolGateway({
        toolRegistry,
        policyEngine,
        toolCallsJsonlPath: runPaths.toolCallsJsonlPath,
    });

    const ctx = new RunContext({
        runPaths,
        sandboxProvider,
        sandboxRegistry,
        artifactRegistry,
        policyEngine,
        toolRegistry,
        toolGateway,
    });

    return { ctx, runPaths };
}

// ── 测试 1 ────────────────────────────────────────────────────────────────────

test('sandbox.create 成功，audit 记录含 sandbox_ref', async () => {
    const { ctx, runPaths } = await makeCtx();

    const result = await ctx.toolGateway.call(
        'sandbox.create',
        { network: 'off' },
        ctx,
        { run_id: runPaths.runId },
    );

    assert.equal(result.ok, true);
    assert.equal(result.data.sandbox_id, 'sb_test01');
    assert.deepEqual(result.data.sandbox_ref, { provider_id: 'oci_local', sandbox_id: 'sb_test01' });

    const raw = await readFile(runPaths.toolCallsJsonlPath, 'utf-8');
    const record = JSON.parse(splitJsonl(raw)[0]);
    assert.equal(record.ok, true);
    assert.deepEqual(record.sandbox_ref, { provider_id: 'oci_local', sandbox_id: 'sb_test01' });
});

// ── 测试 2 ────────────────────────────────────────────────────────────────────

test('sandbox.create → exec → destroy 三条 audit 记录的 sandbox_ref.sandbox_id 一致', async () => {
    const { ctx, runPaths } = await makeCtx();
    const meta = { run_id: runPaths.runId };

    const createRes = await ctx.toolGateway.call('sandbox.create', { network: 'off' }, ctx, meta);
    assert.equal(createRes.ok, true);

    const sandboxId = createRes.data.sandbox_id;

    const execRes = await ctx.toolGateway.call(
        'sandbox.exec',
        { sandbox_id: sandboxId, cmd: 'node', args: ['-v'], timeout_ms: 5000 },
        ctx,
        meta,
    );
    assert.equal(execRes.ok, true);
    assert.equal(execRes.data.ok, true);

    const destroyRes = await ctx.toolGateway.call(
        'sandbox.destroy',
        { sandbox_id: sandboxId },
        ctx,
        meta,
    );
    assert.equal(destroyRes.ok, true);

    const raw = await readFile(runPaths.toolCallsJsonlPath, 'utf-8');
    const lines = splitJsonl(raw);
    assert.equal(lines.length, 3);

    for (const line of lines) {
        const rec = JSON.parse(line);
        assert.equal(rec.sandbox_ref?.sandbox_id, sandboxId, `audit 记录缺少正确的 sandbox_ref: ${line}`);
    }
});

// ── 测试 3 ────────────────────────────────────────────────────────────────────

test('sandbox.create with network=restricted 被 policy 拒绝，返回 ERR_POLICY_DENIED', async () => {
    const { ctx, runPaths } = await makeCtx({ policyConfig: { network: 'off' } });

    const result = await ctx.toolGateway.call(
        'sandbox.create',
        { network: 'restricted' },
        ctx,
        { run_id: runPaths.runId },
    );

    assert.equal(result.ok, false);
    assert.equal(result.error.code, ErrorCode.ERR_POLICY_DENIED);
    assert.equal(result.error.deny_reason, DenyReason.NETWORK_DISABLED);
});

// ── 测试 4 ────────────────────────────────────────────────────────────────────

test('sandbox.create with network=full 被 policy 拒绝，返回 ERR_POLICY_DENIED', async () => {
    const { ctx, runPaths } = await makeCtx({ policyConfig: { network: 'off' } });

    const result = await ctx.toolGateway.call(
        'sandbox.create',
        { network: 'full' },
        ctx,
        { run_id: runPaths.runId },
    );

    assert.equal(result.ok, false);
    assert.equal(result.error.code, ErrorCode.ERR_POLICY_DENIED);
});

// ── 测试 5 ────────────────────────────────────────────────────────────────────

test('sandbox.exec 成功，audit 记录含 sandbox_ref', async () => {
    const { ctx, runPaths } = await makeCtx();
    const meta = { run_id: runPaths.runId };

    const createRes = await ctx.toolGateway.call('sandbox.create', { network: 'off' }, ctx, meta);
    const sandboxId = createRes.data.sandbox_id;

    await ctx.toolGateway.call(
        'sandbox.exec',
        { sandbox_id: sandboxId, cmd: 'node', args: ['-v'], timeout_ms: 5000 },
        ctx,
        meta,
    );

    const raw = await readFile(runPaths.toolCallsJsonlPath, 'utf-8');
    const execRecord = JSON.parse(splitJsonl(raw)[1]);
    assert.equal(execRecord.tool_name, 'sandbox.exec');
    assert.deepEqual(execRecord.sandbox_ref, { provider_id: 'oci_local', sandbox_id: sandboxId });
});

// ── 测试 6 ────────────────────────────────────────────────────────────────────

test('sandbox.exec 在容器不存在时 data.ok=false + ERR_SANDBOX_NOT_FOUND', async () => {
    // mock provider 模拟 OciProvider 检测到 "No such container" 后的返回结构
    const notFoundResult = {
        ok: false,
        error: { code: ErrorCode.ERR_SANDBOX_NOT_FOUND, message: '容器 sb_gone 不存在' },
        exit_code: null,
        timed_out: false,
        stdout: '',
        stderr: 'Error response from daemon: No such container: sb_gone',
        stdout_bytes: 0,
        stderr_bytes: 52,
        stdout_truncated: false,
        stderr_truncated: false,
        started_at: new Date().toISOString(),
        ended_at: new Date().toISOString(),
        duration_ms: 5,
        signal: null,
        stdout_max_bytes: 4194304,
        stderr_max_bytes: 1048576,
    };

    const { ctx, runPaths } = await makeCtx({ execResult: notFoundResult });
    const meta = { run_id: runPaths.runId };

    // 手动注入 handle 到 registry（跳过 create 避免 snapshot 写文件干扰）
    const fakeHandle = {
        provider_id: 'oci_local',
        sandbox_id: 'sb_gone',
        engine_resolved: 'docker',
        runtime_resolved: 'native',
        image: 'node:20-bookworm-slim',
        resources: {},
    };
    ctx.sandboxRegistry.register(fakeHandle);

    const result = await ctx.toolGateway.call(
        'sandbox.exec',
        { sandbox_id: 'sb_gone', cmd: 'node', args: ['-v'], timeout_ms: 5000 },
        ctx,
        meta,
    );

    // ToolGateway 层 ok=true（schema 通过），但 data.ok=false
    assert.equal(result.ok, true);
    assert.equal(result.data.ok, false);
    assert.equal(result.data.error.code, ErrorCode.ERR_SANDBOX_NOT_FOUND);
});

// ── 测试 7 ────────────────────────────────────────────────────────────────────

test('sandbox.destroy 成功，audit 记录含 sandbox_ref', async () => {
    const { ctx, runPaths } = await makeCtx();
    const meta = { run_id: runPaths.runId };

    const createRes = await ctx.toolGateway.call('sandbox.create', { network: 'off' }, ctx, meta);
    const sandboxId = createRes.data.sandbox_id;

    const destroyRes = await ctx.toolGateway.call(
        'sandbox.destroy',
        { sandbox_id: sandboxId },
        ctx,
        meta,
    );
    assert.equal(destroyRes.ok, true);
    assert.deepEqual(destroyRes.data.sandbox_ref, { provider_id: 'oci_local', sandbox_id: sandboxId });

    const raw = await readFile(runPaths.toolCallsJsonlPath, 'utf-8');
    const destroyRecord = JSON.parse(splitJsonl(raw)[1]);
    assert.equal(destroyRecord.tool_name, 'sandbox.destroy');
    assert.equal(destroyRecord.sandbox_ref?.sandbox_id, sandboxId);
});

// ── 测试 8 ────────────────────────────────────────────────────────────────────

test('sandbox.create 默认 network=off 不被 policy 拒绝', async () => {
    const { ctx, runPaths } = await makeCtx({ policyConfig: { network: 'off' } });

    const result = await ctx.toolGateway.call(
        'sandbox.create',
        {},
        ctx,
        { run_id: runPaths.runId },
    );

    assert.equal(result.ok, true);
    assert.equal(result.data.network_policy, 'off');
});
