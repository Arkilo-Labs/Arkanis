import { WorkspaceAccess, NetworkPolicy } from '../../contracts/sandboxSpec.schema.js';
import { SandboxRuntimeResolved } from '../../contracts/sandboxHandle.schema.js';

/**
 * 将 SandboxHandle 与 ExecSpec 拼装成 `docker run` / `podman run` 参数数组。
 * 此模块是所有 CLI 参数的单点真相源。
 */

/** 默认镜像 */
export const DEFAULT_IMAGE = 'node:20-bookworm-slim';

/** 容器内挂载路径约定 */
export const CONTAINER_ARTIFACTS_PATH = '/artifacts';
export const CONTAINER_WORKSPACE_PATH = '/workspace';
export const CONTAINER_TMP_PATH = '/tmp';

/**
 * 构建 `docker/podman run --rm` 命令的完整参数数组。
 *
 * @param {object} params
 * @param {import('../../contracts/sandboxHandle.schema.js').SandboxHandle} params.handle
 * @param {import('../../contracts/execSpec.schema.js').ExecSpec} params.execSpec
 * @param {string} params.artifactsDir  - 宿主机 artifacts 目录（绝对路径）
 * @returns {{ args: string[], runtimeNote?: string }}
 */
export function buildRunArgs({ handle, execSpec, artifactsDir }) {
    const args = ['run', '--rm'];

    // runtime（gvisor 需要放在 --runtime 参数）
    const runtimeNote = applyRuntime(args, handle);

    // 加固参数
    applyHardening(args);

    // 网络策略
    applyNetwork(args, handle.network_policy);

    // 资源限制
    applyResources(args, handle.resources);

    // read-only rootfs + /tmp tmpfs（减小逃逸面）
    args.push('--read-only');
    args.push('--tmpfs', `${CONTAINER_TMP_PATH}:rw,size=256m,exec`);

    // workspace 挂载
    applyWorkspace(args, handle);

    // artifacts 挂载（读写，用于落盘产物）
    args.push('-v', `${artifactsDir}:${CONTAINER_ARTIFACTS_PATH}:rw`);

    // 镜像
    args.push(handle.image || DEFAULT_IMAGE);

    // 执行命令
    args.push(execSpec.cmd);
    if (Array.isArray(execSpec.args)) {
        args.push(...execSpec.args);
    }

    return { args, runtimeNote };
}

/**
 * 构建 `docker/podman run` 用于 doctor 检查的最小参数（不挂载任何目录）。
 */
export function buildDoctorArgs(engine, image) {
    const args = ['run', '--rm', '--network', 'none'];
    applyHardening(args);
    args.push(image || DEFAULT_IMAGE);
    args.push('echo', 'ok');
    return args;
}

// ──────────────────────────────────────────────
// 内部辅助

function applyRuntime(args, handle) {
    const resolved = handle.runtime_resolved;
    if (resolved === SandboxRuntimeResolved.GVISOR) {
        args.push('--runtime=runsc');
        return 'gvisor';
    }
    return 'native';
}

function applyHardening(args) {
    args.push('--security-opt', 'no-new-privileges');
    args.push('--cap-drop', 'ALL');
    args.push('--pids-limit', '512');
}

function applyNetwork(args, policy) {
    if (policy === NetworkPolicy.OFF || policy === NetworkPolicy.RESTRICTED) {
        args.push('--network', 'none');
    }
    // full：不添加 network 限制（走 default bridge）
}

function applyResources(args, resources) {
    if (resources?.max_memory_mb) {
        args.push('--memory', `${resources.max_memory_mb}m`);
        args.push('--memory-swap', `${resources.max_memory_mb}m`);
    }
    if (resources?.max_cpu) {
        args.push('--cpus', String(resources.max_cpu));
    }
}

function applyWorkspace(args, handle) {
    if (!handle.workspace_mount_path) return;

    const access = handle.workspace_access;
    if (access === WorkspaceAccess.READ_ONLY) {
        args.push('-v', `${handle.workspace_mount_path}:${CONTAINER_WORKSPACE_PATH}:ro`);
    } else if (access === WorkspaceAccess.READ_WRITE) {
        args.push('-v', `${handle.workspace_mount_path}:${CONTAINER_WORKSPACE_PATH}:rw`);
    }
    // NONE：不挂载
}
