/**
 * SandboxRegistry — per-run 生命周期管理。
 * 跟踪所有 live sandbox handle，退出时统一 destroyAll 防止容器泄漏。
 */

import { SandboxErrorCode } from './contracts/sandboxErrors.js';

function makeError(code, message) {
    const err = new Error(message);
    err.code = code;
    return err;
}

export class SandboxRegistry {
    /** @type {Map<string, object>} */
    #handles = new Map();

    /**
     * 注册 handle。sandbox_id 重复时抛 ERR_INVALID_ARGUMENT。
     * @param {object} handle - 必须包含 sandbox_id 字段
     */
    register(handle) {
        const id = handle?.sandbox_id;
        if (!id) {
            throw makeError('ERR_INVALID_ARGUMENT', 'handle 缺少 sandbox_id');
        }
        if (this.#handles.has(id)) {
            throw makeError('ERR_INVALID_ARGUMENT', `sandbox_id ${id} 已注册`);
        }
        this.#handles.set(id, handle);
    }

    /** @returns {object|undefined} */
    get(sandboxId) {
        return this.#handles.get(sandboxId);
    }

    /** 移除，不存在不抛错。 */
    remove(sandboxId) {
        this.#handles.delete(sandboxId);
    }

    /** 返回当前所有 handle 的快照数组。 */
    list() {
        return [...this.#handles.values()];
    }

    /** @returns {number} */
    get size() {
        return this.#handles.size;
    }

    /**
     * 遍历销毁所有已注册容器。单个 destroy 失败不阻塞其余。
     * 完成后清空 registry。
     *
     * @param {object} provider - 需要有 destroy(handle) 方法
     * @returns {Promise<{destroyed: string[], errors: Array<{sandbox_id: string, error: Error}>}>}
     */
    async destroyAll(provider) {
        const destroyed = [];
        const errors = [];

        const entries = [...this.#handles.entries()];
        this.#handles.clear();

        for (const [sandboxId, handle] of entries) {
            try {
                await provider.destroy(handle);
                destroyed.push(sandboxId);
            } catch (err) {
                errors.push({ sandbox_id: sandboxId, error: err });
            }
        }

        return { destroyed, errors };
    }
}

/**
 * 注册进程退出钩子。SIGTERM / SIGINT 时执行 destroyAll，防止容器泄漏。
 * 返回 detach 函数，调用后移除所有已注册的监听器。
 *
 * @param {SandboxRegistry} registry
 * @param {object} provider
 * @returns {{ detach: () => void }}
 */
export function registerCleanupHooks(registry, provider) {
    let cleaned = false;

    async function cleanup() {
        if (cleaned) return;
        cleaned = true;

        if (registry.size === 0) return;

        try {
            const result = await registry.destroyAll(provider);
            if (result.errors.length > 0) {
                for (const { sandbox_id, error } of result.errors) {
                    process.stderr.write(`[sandbox-cleanup] ${sandbox_id} 销毁失败: ${error.message}\n`);
                }
            }
        } catch (err) {
            process.stderr.write(`[sandbox-cleanup] destroyAll 异常: ${err.message}\n`);
        }
    }

    async function onSignal() {
        await cleanup();
        process.exit(1);
    }

    async function onBeforeExit() {
        await cleanup();
    }

    process.on('SIGTERM', onSignal);
    process.on('SIGINT', onSignal);
    process.on('beforeExit', onBeforeExit);

    return {
        detach() {
            process.removeListener('SIGTERM', onSignal);
            process.removeListener('SIGINT', onSignal);
            process.removeListener('beforeExit', onBeforeExit);
        },
    };
}
