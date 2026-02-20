/**
 * RunContext — 一次 run 的上下文容器，持有所有运行时依赖。
 *
 * 注入顺序（自上而下）：
 *   runPaths → sandboxProvider → artifactRegistry → policyEngine
 *   → toolRegistry → toolGateway → mcpRegistry（可选）
 */
export class RunContext {
    constructor({
        runPaths,
        sandboxProvider,
        artifactRegistry,
        policyEngine,
        toolRegistry,
        toolGateway,
        mcpRegistry = null,
    }) {
        this.runPaths = runPaths;
        this.sandboxProvider = sandboxProvider;
        this.artifactRegistry = artifactRegistry;
        this.policyEngine = policyEngine;
        this.toolRegistry = toolRegistry;
        this.toolGateway = toolGateway;
        this.mcpRegistry = mcpRegistry;
    }
}
