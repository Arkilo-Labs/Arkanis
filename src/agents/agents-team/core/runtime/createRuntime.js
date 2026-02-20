import { OciProvider } from '../../../../core/sandbox/index.js';
import { createRunPaths, formatUtcRunId } from '../outputs/runPaths.js';
import { PolicyEngine } from '../policy/policyEngine.js';
import { ToolRegistry } from '../tool/toolRegistry.js';
import { ToolGateway } from '../tool/toolGateway.js';
import { ArtifactRegistry } from '../artifacts/artifactRegistry.js';
import { RunContext } from './runContext.js';

import { sandboxExecTool } from '../tool/builtins/sandboxExec.tool.js';
import { artifactWriteTextTool } from '../tool/builtins/artifactWriteText.tool.js';
import { artifactHashTool } from '../tool/builtins/artifactHash.tool.js';
import { mcpCallTool } from '../tool/builtins/mcpCall.tool.js';

/**
 * Composition root：装配一次 run 所需的全部依赖并返回 RunContext。
 *
 * @param {object} opts
 * @param {string} [opts.outputDir]
 * @param {string} [opts.runId]
 * @param {object} [opts.sandboxSpec]  默认 SandboxSpec 覆盖项
 * @param {object} [opts.policyConfig]  PolicyEngine 配置覆盖项
 * @param {object|null} [opts.mcpRegistry]  可选，P17 阶段注入
 * @returns {RunContext}
 */
export function createRuntime({
    outputDir,
    runId,
    sandboxSpec = {},
    policyConfig = {},
    mcpRegistry = null,
} = {}) {
    const runPaths = createRunPaths({
        outputDir: outputDir ?? './outputs/agents_team',
        runId: runId ?? formatUtcRunId(new Date()),
    });

    const sandboxProvider = new OciProvider({ defaultSpec: sandboxSpec });

    const artifactRegistry = new ArtifactRegistry({ artifactsDir: runPaths.artifactsDir });

    const policyEngine = new PolicyEngine(policyConfig);

    const toolRegistry = new ToolRegistry();
    toolRegistry.register(sandboxExecTool);
    toolRegistry.register(artifactWriteTextTool);
    toolRegistry.register(artifactHashTool);
    toolRegistry.register(mcpCallTool);

    const toolGateway = new ToolGateway({
        toolRegistry,
        policyEngine,
        toolCallsJsonlPath: runPaths.toolCallsJsonlPath,
    });

    return new RunContext({
        runPaths,
        sandboxProvider,
        artifactRegistry,
        policyEngine,
        toolRegistry,
        toolGateway,
        mcpRegistry,
    });
}
