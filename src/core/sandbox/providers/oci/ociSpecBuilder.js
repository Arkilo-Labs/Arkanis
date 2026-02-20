import { WorkspaceAccess, NetworkPolicy } from '../../contracts/sandboxSpec.schema.js';
import { SandboxRuntimeResolved } from '../../contracts/sandboxHandle.schema.js';

/**
 * OCI CLI 参数构建器。
 * 三个公开函数分别对应容器生命周期的三个阶段：create / exec / doctor。
 */

/** 默认镜像 */
export const DEFAULT_IMAGE = 'node:20-bookworm-slim';

/** 容器内挂载路径约定 */
export const CONTAINER_ARTIFACTS_PATH = '/artifacts';
export const CONTAINER_WORKSPACE_PATH = '/workspace';
export const CONTAINER_TMP_PATH = '/tmp';

/**
 * 构建 `docker run -d --name <sandbox_id> ... sleep infinity` 参数。
 * 仅在 createSandbox 时调用一次，加固 / 资源限制 / 挂载全部在此施加。
 *
 * @param {object} params
 * @param {import('../../contracts/sandboxHandle.schema.js').SandboxHandle} params.handle
 * @param {string} params.artifactsDir
 * @returns {{ args: string[], runtimeNote: string }}
 */
export function buildCreateArgs({ handle, artifactsDir }) {
    const args = ['run', '-d', '--name', handle.sandbox_id];

    const runtimeNote = applyRuntime(args, handle);
    applyHardening(args);
    applyNetwork(args, handle.network_policy);
    applyResources(args, handle.resources);

    args.push('--read-only');
    args.push('--tmpfs', `${CONTAINER_TMP_PATH}:rw,size=256m,exec`);

    applyWorkspace(args, handle);
    args.push('-v', `${artifactsDir}:${CONTAINER_ARTIFACTS_PATH}:rw`);
    applyCustomMounts(args, handle.mounts);

    // 镜像 + 长驻入口
    args.push(handle.image || DEFAULT_IMAGE);
    args.push('sleep', 'infinity');

    return { args, runtimeNote };
}

/**
 * 构建 `docker exec <sandbox_id> cmd ...args` 参数。
 * 加固参数已在 create 阶段施加，此处仅注入命令。
 *
 * @param {object} params
 * @param {import('../../contracts/sandboxHandle.schema.js').SandboxHandle} params.handle
 * @param {import('../../contracts/execSpec.schema.js').ExecSpec} params.execSpec
 * @returns {{ args: string[] }}
 */
export function buildExecArgs({ handle, execSpec }) {
    const args = ['exec'];

    if (execSpec.cwd) {
        args.push('-w', execSpec.cwd);
    }

    if (execSpec.env && typeof execSpec.env === 'object') {
        for (const [key, value] of Object.entries(execSpec.env)) {
            args.push('-e', `${key}=${value}`);
        }
    }

    args.push(handle.sandbox_id);

    args.push(execSpec.cmd);
    if (Array.isArray(execSpec.args)) {
        args.push(...execSpec.args);
    }

    return { args };
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

function applyCustomMounts(args, mounts) {
    if (!Array.isArray(mounts) || mounts.length === 0) return;

    for (const mount of mounts) {
        if (mount.type === 'bind') {
            const mode = mount.read_only ? 'ro' : 'rw';
            args.push('-v', `${mount.source_path}:${mount.target_path}:${mode}`);
        } else if (mount.type === 'tmpfs') {
            const opts = [];
            if (mount.size_mb) opts.push(`size=${mount.size_mb}m`);
            if (mount.read_only === false) opts.push('rw');
            const spec =
                opts.length > 0
                    ? `${mount.target_path}:${opts.join(',')}`
                    : mount.target_path;
            args.push('--tmpfs', spec);
        }
    }
}
