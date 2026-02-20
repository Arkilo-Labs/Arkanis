import { randomBytes } from 'node:crypto';
import os from 'node:os';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

import { SandboxEngine, SandboxRuntime } from '../../contracts/sandboxSpec.schema.js';
import { SandboxEngineResolved, SandboxRuntimeResolved } from '../../contracts/sandboxHandle.schema.js';
import { nowIso, durationMs } from '../../utils/clock.js';
import { probeExecutable, runOciCommand } from './ociCli.js';
import { buildRunArgs, buildDoctorArgs, DEFAULT_IMAGE } from './ociSpecBuilder.js';
import { SandboxErrorCode as ErrorCode } from '../../contracts/sandboxErrors.js';

const execFileAsync = promisify(execFile);

const PROVIDER_ID = 'oci_local';

/** 解析 engine：auto → docker → podman */
async function resolveEngine(engine) {
    if (engine === SandboxEngine.DOCKER || engine === undefined) return SandboxEngineResolved.DOCKER;
    if (engine === SandboxEngine.PODMAN) return SandboxEngineResolved.PODMAN;
    // auto
    if (await probeExecutable('docker')) return SandboxEngineResolved.DOCKER;
    if (await probeExecutable('podman')) return SandboxEngineResolved.PODMAN;
    throw makeError(ErrorCode.ERR_SANDBOX_START_FAILED, '未找到可用的 OCI engine（docker/podman）');
}

/** 解析 runtime：auto → gvisor（若 runsc 可用） → native */
async function resolveRuntime(runtime) {
    if (runtime === SandboxRuntime.GVISOR) return SandboxRuntimeResolved.GVISOR;
    if (runtime === SandboxRuntime.NATIVE) return SandboxRuntimeResolved.NATIVE;
    // auto
    if (await probeExecutable('runsc')) return SandboxRuntimeResolved.GVISOR;
    return SandboxRuntimeResolved.NATIVE;
}

async function getEngineVersion(engine) {
    try {
        const { stdout } = await execFileAsync(engine, ['--version'], { timeout: 5000 });
        return String(stdout || '').trim().split('\n')[0] || null;
    } catch {
        return null;
    }
}

function makeError(code, message, details) {
    const err = new Error(message);
    err.code = code;
    if (details) err.details = details;
    return err;
}

function generateSandboxId() {
    return `sb_${randomBytes(6).toString('hex')}`;
}

/**
 * OCI sandbox provider。
 *
 * 实例化时需要传入 defaultSpec（SandboxSpec），运行时会在 exec 前解析 engine/runtime。
 * 每次 exec 使用 `engine run --rm`，不维护长驻容器。
 */
export class OciProvider {
    constructor({ defaultSpec } = {}) {
        this._defaultSpec = defaultSpec ?? {};
        this._id = PROVIDER_ID;
    }

    get providerId() {
        return this._id;
    }

    /**
     * 创建 sandbox handle（只分配 ID，不启动容器）。
     */
    async createSandbox(spec) {
        const engineResolved = await resolveEngine(spec.engine ?? this._defaultSpec.engine);
        const runtimeResolved = await resolveRuntime(spec.runtime ?? this._defaultSpec.runtime);

        return {
            provider_id: this._id,
            sandbox_id: generateSandboxId(),
            created_at: nowIso(),

            engine: spec.engine ?? this._defaultSpec.engine ?? SandboxEngine.AUTO,
            engine_resolved: engineResolved,

            runtime: spec.runtime ?? this._defaultSpec.runtime ?? SandboxRuntime.AUTO,
            runtime_resolved: runtimeResolved,

            mode: spec.mode ?? this._defaultSpec.mode ?? 'sandboxed',
            image: spec.image ?? this._defaultSpec.image ?? DEFAULT_IMAGE,

            workspace_access: spec.workspace_access ?? this._defaultSpec.workspace_access ?? 'none',
            workspace_mount_path: spec.workspace_mount_path ?? this._defaultSpec.workspace_mount_path ?? null,
            network_policy: spec.network_policy ?? this._defaultSpec.network_policy ?? 'off',

            mounts: spec.mounts ?? this._defaultSpec.mounts ?? [],
            resources: spec.resources ?? this._defaultSpec.resources ?? defaultResources(),
        };
    }

    /**
     * 在 sandbox 内执行命令（每次 = 一个临时容器 + --rm）。
     */
    async exec(handle, execSpec, { artifactsDir }) {
        const { args } = buildRunArgs({ handle, execSpec, artifactsDir });
        const timeoutMs = execSpec.timeout_ms ?? handle.resources?.max_wall_clock_ms ?? 60_000;

        const raw = await runOciCommand(handle.engine_resolved, args, {
            timeout_ms: timeoutMs,
            max_stdout_bytes: handle.resources?.max_stdout_bytes,
            max_stderr_bytes: handle.resources?.max_stderr_bytes,
        });

        if (raw.spawnError) {
            const err = makeError(
                ErrorCode.ERR_SANDBOX_EXEC_FAILED,
                `engine spawn 失败: ${raw.spawnError.message}`,
            );
            return {
                ok: false,
                error: { code: err.code, message: err.message },
                ...baseExecResult(raw),
            };
        }

        if (raw.timed_out) {
            return {
                ok: false,
                error: { code: ErrorCode.ERR_SANDBOX_EXEC_TIMEOUT, message: `exec 超时（${timeoutMs}ms）` },
                ...baseExecResult(raw),
            };
        }

        return {
            ok: true,
            ...baseExecResult(raw),
        };
    }

    /**
     * 销毁 sandbox（临时容器模式下主要用于审计 cleanup 标记）。
     */
    async destroy(_handle) {
        // --rm 语义下无需额外清理
    }

    /**
     * 生成 sandbox 快照（env fingerprint）。
     */
    async snapshot(handle) {
        const engineVersion = await getEngineVersion(handle.engine_resolved);
        return {
            provider_id: handle.provider_id,
            sandbox_id: handle.sandbox_id,
            image: handle.image,
            engine: handle.engine_resolved,
            runtime: handle.runtime_resolved,
            host_platform: os.platform(),
            host_arch: os.arch(),
            node_version: process.version,
            engine_version: engineVersion ?? undefined,
            captured_at: nowIso(),
        };
    }

    /**
     * 检查 engine/runtime 可用性（doctor 命令）。
     */
    async doctor({ engine, runtime, image } = {}) {
        const engineResolved = await resolveEngine(engine ?? this._defaultSpec.engine ?? SandboxEngine.AUTO);
        const runtimeResolved = await resolveRuntime(runtime ?? this._defaultSpec.runtime ?? SandboxRuntime.AUTO);
        const img = image ?? this._defaultSpec.image ?? DEFAULT_IMAGE;

        const engineVersion = await getEngineVersion(engineResolved);
        const runscAvailable = await probeExecutable('runsc');

        const testArgs = buildDoctorArgs(engineResolved, img);
        const testResult = await runOciCommand(engineResolved, testArgs, { timeout_ms: 30_000 });

        return {
            engine: engineResolved,
            engine_version: engineVersion,
            runtime: runtimeResolved,
            runtime_resolved: runtimeResolved,
            runsc_available: runscAvailable,
            image: img,
            probe_ok: testResult.exit_code === 0 && !testResult.timed_out && !testResult.spawnError,
            probe_exit_code: testResult.exit_code,
            probe_stderr: testResult.stderr || null,
            host_platform: os.platform(),
            host_arch: os.arch(),
            node_version: process.version,
        };
    }
}

function baseExecResult(raw) {
    return {
        started_at: raw.startedAt,
        ended_at: raw.endedAt,
        duration_ms: raw.duration_ms,
        timeout_ms: undefined,
        timed_out: raw.timed_out,
        exit_code: raw.exit_code,
        signal: raw.signal,
        stdout: raw.stdout,
        stderr: raw.stderr,
        stdout_bytes: raw.stdout_bytes,
        stderr_bytes: raw.stderr_bytes,
        stdout_truncated: raw.stdout_truncated,
        stderr_truncated: raw.stderr_truncated,
        stdout_max_bytes: raw.stdout_max_bytes,
        stderr_max_bytes: raw.stderr_max_bytes,
    };
}

function defaultResources() {
    return {
        max_wall_clock_ms: 60_000,
        max_stdout_bytes: 4 * 1024 * 1024,
        max_stderr_bytes: 1 * 1024 * 1024,
        max_memory_mb: 512,
        max_cpu: 1,
    };
}
