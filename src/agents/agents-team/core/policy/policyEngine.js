import { DenyReason } from '../contracts/denyReasons.js';
import { ErrorCode } from '../contracts/errors.js';
import { PolicyConfigSchema } from './policyConfig.schema.js';

export class PolicyEngine {
    /**
     * @param {object} [config]  PolicyConfig，字段缺失时使用 schema 默认值
     */
    constructor(config = {}) {
        this._policy = PolicyConfigSchema.parse(config);
    }

    /**
     * 检查工具声明的权限是否与当前策略相符。
     *
     * @param {import('../contracts/tool.schema.js').ToolPermission} permissions
     * @returns {{ decision: 'allow'|'deny', reason?: string }}
     */
    evaluate(permissions = {}) {
        if (permissions.needs_network) {
            if (this._policy.network === 'off' || this._policy.network === 'restricted') {
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
