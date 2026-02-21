import { OciProvider, SandboxRegistry, registerCleanupHooks } from '../../../../core/sandbox/index.js';
import { createRunPaths, formatUtcRunId } from '../outputs/runPaths.js';
import { PolicyEngine } from '../policy/policyEngine.js';
import { ToolRegistry } from '../tool/toolRegistry.js';
import { ToolGateway } from '../tool/toolGateway.js';
import { ArtifactRegistry } from '../artifacts/artifactRegistry.js';
import { SkillRegistry } from '../skill/skillRegistry.js';
import { SkillRunner } from '../skill/skillRunner.js';
import { RunContext } from './runContext.js';

import { sandboxCreateTool } from '../tool/builtins/sandboxCreate.tool.js';
import { sandboxExecTool } from '../tool/builtins/sandboxExec.tool.js';
import { sandboxDestroyTool } from '../tool/builtins/sandboxDestroy.tool.js';
import { artifactWriteTextTool } from '../tool/builtins/artifactWriteText.tool.js';
import { artifactHashTool } from '../tool/builtins/artifactHash.tool.js';
import { mcpCallTool } from '../tool/builtins/mcpCall.tool.js';
import { httpFetchTool } from '../tool/builtins/httpFetch.tool.js';
import { fileReadTool } from '../tool/builtins/fileRead.tool.js';
import { fileWriteTool } from '../tool/builtins/fileWrite.tool.js';
import { filePatchTool } from '../tool/builtins/filePatch.tool.js';
import { runCommand } from '../skill/builtins/runCommand.skill.js';

/**
 * Composition root：装配一次 run 所需的全部依赖并返回 RunContext。
 *
 * @param {object} opts
 * @param {string} [opts.outputDir]
 * @param {string} [opts.runId]
 * @param {object} [opts.sandboxSpec]  默认 SandboxSpec 覆盖项
 * @param {object} [opts.policyConfig]  PolicyEngine 配置覆盖项
 * @param {object} [opts.skillsConfig]  skills 白名单配置，来自 skills.json
 * @param {string} [opts.skillsDir]  skills manifests 根目录（绝对路径）
 * @param {object|null} [opts.mcpRegistry]  可选，P17 阶段注入
 * @param {boolean} [opts.enableCleanupHooks]  是否注册进程退出自动 cleanup（长生命周期场景开启）
 * @returns {RunContext}
 */
export function createRuntime({
    outputDir,
    runId,
    sandboxSpec = {},
    policyConfig = {},
    skillsConfig = {},
    skillsDir = null,
    mcpRegistry = null,
    enableCleanupHooks = false,
    allowedTools = null,
} = {}) {
    const runPaths = createRunPaths({
        outputDir: outputDir ?? './outputs/agents_team',
        runId: runId ?? formatUtcRunId(new Date()),
    });

    const sandboxProvider = new OciProvider({ defaultSpec: sandboxSpec });
    const sandboxRegistry = new SandboxRegistry();

    if (enableCleanupHooks) {
        registerCleanupHooks(sandboxRegistry, sandboxProvider);
    }

    const artifactRegistry = new ArtifactRegistry({ artifactsDir: runPaths.artifactsDir });

    const policyEngine = new PolicyEngine(policyConfig);

    const toolRegistry = new ToolRegistry();
    toolRegistry.register(sandboxCreateTool);
    toolRegistry.register(sandboxExecTool);
    toolRegistry.register(sandboxDestroyTool);
    toolRegistry.register(artifactWriteTextTool);
    toolRegistry.register(artifactHashTool);
    toolRegistry.register(mcpCallTool);
    toolRegistry.register(httpFetchTool);
    toolRegistry.register(fileReadTool);
    toolRegistry.register(fileWriteTool);
    toolRegistry.register(filePatchTool);

    const toolGateway = new ToolGateway({
        toolRegistry,
        policyEngine,
        toolCallsJsonlPath: runPaths.toolCallsJsonlPath,
        allowedTools,
    });

    const skillRegistry = new SkillRegistry();
    skillRegistry.registerBuiltin('runCommand', runCommand);

    const skillRunner = new SkillRunner({
        skillRegistry,
        skillRunsJsonlPath: runPaths.skillRunsJsonlPath,
        skillsDir: skillsDir ?? null,
        allowedSkills: skillsConfig?.allowed_skills ?? [],
    });

    return new RunContext({
        runPaths,
        sandboxProvider,
        sandboxRegistry,
        artifactRegistry,
        policyEngine,
        toolRegistry,
        toolGateway,
        skillRegistry,
        skillRunner,
        mcpRegistry,
    });
}
