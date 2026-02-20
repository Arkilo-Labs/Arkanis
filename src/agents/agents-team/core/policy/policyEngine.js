import { DenyReason } from '../contracts/denyReasons.js';
import { ErrorCode } from '../contracts/errors.js';

/**
 * PolicyConfig 字段含义：
 *   network          : 'off' | 'restricted' | 'full'  默认 'off'
 *   workspace_access : 'none' | 'read_only' | 'read_write'  默认 'none'
 *   host_exec        : 'deny' | 'allow'  默认 'deny'
 *   secrets          : 'deny' | 'allow'  默认 'deny'
 */
const DEFAULT_POLICY = Object.freeze({
    network: 'off',
    workspace_access: 'none',
    host_exec: 'deny',
    secrets: 'deny',
});

export class PolicyEngine {
    /**
     * @param {object} [config]  PolicyConfig，未设置的字段回退到 DEFAULT_POLICY
     */
    constructor(config = {}) {
        this._policy = { ...DEFAULT_POLICY, ...config };
    }

    /**
     * 检查工具声明的权限是否与当前策略相符。
     *
     * @param {import('../contracts/tool.schema.js').ToolPermission} permissions
     * @returns {{ decision: 'allow'|'deny', reason?: string }}
     */
    evaluate(permissions = {}) {
        if (permissions.needs_network) {
            if (this._policy.network === 'off') {
                return deny(DenyReason.NETWORK_DISABLED);
            }
        }

        if (permissions.needs_workspace_write) {
            if (this._policy.workspace_access === 'none' || this._policy.workspace_access === 'read_only') {
                return deny(DenyReason.WORKSPACE_WRITE_FORBIDDEN);
            }
        }

        if (permissions.needs_host_exec) {
            if (this._policy.host_exec === 'deny') {
                return deny(DenyReason.HOST_EXEC_FORBIDDEN);
            }
        }

        if (permissions.needs_secrets) {
            if (this._policy.secrets === 'deny') {
                return deny(DenyReason.SECRETS_FORBIDDEN);
            }
        }

        return { decision: 'allow' };
    }

    /**
     * 快捷包装：evaluate 后若 deny，抛出标准化错误对象（不 throw，仅返回）。
     * @returns {{ ok: true } | { ok: false, error: object }}
     */
    check(permissions = {}) {
        const result = this.evaluate(permissions);
        if (result.decision === 'deny') {
            return {
                ok: false,
                error: {
                    code: ErrorCode.ERR_POLICY_DENIED,
                    message: `policy denied: ${result.reason}`,
                    deny_reason: result.reason,
                },
                policy_decision: result,
            };
        }
        return { ok: true, policy_decision: result };
    }
}

function deny(reason) {
    return { decision: 'deny', reason };
}
