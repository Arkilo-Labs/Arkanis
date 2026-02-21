/**
 * RunContext — 一次 run 的上下文容器，持有所有运行时依赖。
 *
 * 注入顺序（自上而下）：
 *   runPaths → sandboxProvider → sandboxRegistry → artifactRegistry
 *   → policyEngine → toolRegistry → toolGateway
 *   → skillRegistry → skillRunner → mcpRegistry（可选）
 */
export class RunContext {
    constructor({
        runPaths,
        sandboxProvider,
        sandboxRegistry = null,
        artifactRegistry,
        policyEngine,
        toolRegistry,
        toolGateway,
        skillRegistry = null,
        skillRunner = null,
        mcpRegistry = null,
    }) {
        this.runPaths = runPaths;
        this.sandboxProvider = sandboxProvider;
        this.sandboxRegistry = sandboxRegistry;
        this.artifactRegistry = artifactRegistry;
        this.policyEngine = policyEngine;
        this.toolRegistry = toolRegistry;
        this.toolGateway = toolGateway;
        this.skillRegistry = skillRegistry;
        this.skillRunner = skillRunner;
        this.mcpRegistry = mcpRegistry;
    }
}
