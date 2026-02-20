import { ErrorCode } from '../contracts/errors.js';

/**
 * ToolRegistry — 工具注册表。
 *
 * 每个 tool 必须包含：
 *   name        : string（格式 namespace.action）
 *   permissions : ToolPermission
 *   inputSchema : zod schema
 *   outputSchema: zod schema
 *   run(ctx, args) : Promise<any>
 */
export class ToolRegistry {
    constructor() {
        this._tools = new Map();
    }

    /**
     * 注册工具。name 重复时抛出。
     */
    register(tool) {
        if (!tool?.name) throw new Error('tool.name 必填');
        if (!tool?.run) throw new Error(`tool "${tool.name}" 缺少 run 函数`);
        if (!tool?.inputSchema) throw new Error(`tool "${tool.name}" 缺少 inputSchema`);
        if (!tool?.outputSchema) throw new Error(`tool "${tool.name}" 缺少 outputSchema`);
        if (this._tools.has(tool.name)) {
            throw new Error(`tool "${tool.name}" 已注册，不允许重复`);
        }
        this._tools.set(tool.name, tool);
    }

    /**
     * 获取工具，不存在时抛出标准化错误。
     */
    get(name) {
        const tool = this._tools.get(name);
        if (!tool) {
            const err = new Error(`tool "${name}" 不存在`);
            err.code = ErrorCode.ERR_TOOL_NOT_FOUND;
            throw err;
        }
        return tool;
    }

    list() {
        return [...this._tools.values()].map((t) => ({ name: t.name, permissions: t.permissions ?? {} }));
    }
}
