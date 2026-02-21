#!/usr/bin/env node
import { Command } from 'commander';
import { readFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { createRunPaths, formatUtcRunId } from '../../agents/agents-team/core/outputs/runPaths.js';
import { writeRunIndex } from '../../agents/agents-team/core/outputs/runIndexWriter.js';
import { createRuntime } from '../../agents/agents-team/core/runtime/createRuntime.js';
import { randomBytes } from 'node:crypto';
import {
    OciProvider,
    SandboxRegistry,
    registerCleanupHooks,
    resolveOciEngine,
    writeHandleJson,
    writeEnvFingerprint,
    writeCommandRecord,
    writeOutputLogs,
    loadHandleJson,
} from '../../core/sandbox/index.js';

const DEFAULT_SKILLS_DIR = join(dirname(fileURLToPath(import.meta.url)), '../../agents/agents-team/skills');

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const DEFAULT_CONFIG_DIR = join(__dirname, '../../agents/agents-team/config');

function normalizeArgv(argv) {
    if (argv.length >= 3 && argv[2] === '--') return [...argv.slice(0, 2), ...argv.slice(3)];
    return argv;
}

function resolveRunPaths(program) {
    const opts = program.opts();
    return createRunPaths({
        outputDir: opts.outputDir,
        runId: opts.runId || formatUtcRunId(new Date()),
    });
}

async function loadToolsConfig(configDir) {
    try {
        const raw = await readFile(join(configDir, 'tools.json'), 'utf-8');
        return JSON.parse(raw);
    } catch {
        return { policy: {} };
    }
}

async function loadSandboxConfig(configDir) {
    try {
        const raw = await readFile(join(configDir, 'sandbox.json'), 'utf-8');
        return JSON.parse(raw);
    } catch {
        return {};
    }
}

async function loadSkillsConfig(configDir) {
    try {
        const raw = await readFile(join(configDir, 'skills.json'), 'utf-8');
        return JSON.parse(raw);
    } catch {
        return { allowed_skills: [] };
    }
}

const program = new Command();

program
    .name('agents-team')
    .description('Agents Team 执行底座验收入口（Sandbox / Tools / Skills / MCP）')
    .version('0.1.0')
    .option('--output-dir <dir>', '输出目录', './outputs/agents_team')
    .option('--run-id <id>', '指定 run_id（默认 UTC 时间戳生成）')
    .option('--config-dir <dir>', '配置目录', DEFAULT_CONFIG_DIR);

// ── sandbox ──────────────────────────────────────
const sandboxCmd = program.command('sandbox').description('Sandbox 相关操作');

sandboxCmd
    .command('doctor')
    .description('检查宿主 engine/runtime 可用性')
    .option('--engine <engine>', 'docker|podman|auto', 'auto')
    .option('--runtime <runtime>', 'native|gvisor|auto', 'auto')
    .option('--image <image>', '测试镜像', 'node:20-bookworm-slim')
    .action(async (cmdOpts) => {
        try {
            const provider = new OciProvider();
            const result = await provider.doctor({
                engine: cmdOpts.engine,
                runtime: cmdOpts.runtime,
                image: cmdOpts.image,
            });
            process.stdout.write(JSON.stringify(result, null, 2) + '\n');
            if (!result.probe_ok) {
                process.stderr.write('[agents-team] sandbox probe 失败，请检查 engine 是否运行\n');
                process.exitCode = 1;
            }
        } catch (err) {
            process.stderr.write(`[agents-team] doctor 失败: ${err.message}\n`);
            process.exitCode = 1;
        }
    });

sandboxCmd
    .command('create')
    .description('创建持久化 sandbox 容器（docker run -d）')
    .option('--network <policy>', 'network 策略：off|restricted|full', 'off')
    .option('--image <image>', '镜像', 'node:20-bookworm-slim')
    .action(async (cmdOpts) => {
        const runPaths = resolveRunPaths(program);
        const configDir = program.opts().configDir;

        try {
            const sandboxConfig = await loadSandboxConfig(configDir);
            const provider = new OciProvider({ defaultSpec: sandboxConfig });
            const registry = new SandboxRegistry();
            // 仅处理信号清理；正常退出前会 detach，容器留存
            const { detach } = registerCleanupHooks(registry, provider);

            const handle = await provider.createSandbox(
                {
                    engine: sandboxConfig.engine ?? 'auto',
                    runtime: sandboxConfig.runtime ?? 'auto',
                    mode: 'sandboxed',
                    network_policy: cmdOpts.network,
                    workspace_access: sandboxConfig.workspace_access ?? 'none',
                    image: cmdOpts.image,
                },
                { artifactsDir: runPaths.artifactsDir },
            );

            registry.register(handle);

            // 持久化 handle 供后续 exec/destroy 子命令跨进程使用
            await writeHandleJson(runPaths.runDir, handle.sandbox_id, handle);
            const snapshot = await provider.snapshot(handle);
            await writeEnvFingerprint(runPaths.runDir, handle.sandbox_id, snapshot);

            // 正常退出时移除钩子，容器持续运行
            detach();

            process.stdout.write(JSON.stringify({
                sandbox_id: handle.sandbox_id,
                provider_id: handle.provider_id,
                engine_resolved: handle.engine_resolved,
                runtime_resolved: handle.runtime_resolved,
                image: handle.image,
                network_policy: handle.network_policy,
                created_at: handle.created_at,
            }, null, 2) + '\n');
        } catch (err) {
            process.stderr.write(`[agents-team] sandbox create 失败: ${err.message}\n`);
            process.exitCode = 1;
        }
    });

sandboxCmd
    .command('destroy')
    .description('销毁 sandbox 容器（docker rm -f）')
    .requiredOption('--sandbox-id <id>', 'sandbox ID')
    .action(async (cmdOpts) => {
        const configDir = program.opts().configDir;

        try {
            const sandboxConfig = await loadSandboxConfig(configDir);
            const provider = new OciProvider({ defaultSpec: sandboxConfig });

            const engineResolved = await resolveOciEngine(sandboxConfig.engine ?? 'auto');
            await provider.destroy({
                sandbox_id: cmdOpts.sandboxId,
                engine_resolved: engineResolved,
            });

            process.stdout.write(JSON.stringify({
                sandbox_id: cmdOpts.sandboxId,
                destroyed: true,
            }, null, 2) + '\n');
        } catch (err) {
            process.stderr.write(`[agents-team] sandbox destroy 失败: ${err.message}\n`);
            process.exitCode = 1;
        }
    });

sandboxCmd
    .command('exec')
    .description('在持久容器内执行命令（直接 docker exec，需先 sandbox create）')
    .requiredOption('--sandbox-id <id>', 'sandbox ID（由 sandbox create 返回）')
    .requiredOption('--cmd <cmd>', '执行命令')
    .option('--args <arg>', '命令参数（可重复）', (v, prev) => [...(prev || []), v], [])
    .option('--timeout-ms <ms>', '超时毫秒', (v) => parseInt(v, 10), 60000)
    .action(async (cmdOpts) => {
        const runPaths = resolveRunPaths(program);
        const configDir = program.opts().configDir;

        try {
            const sandboxConfig = await loadSandboxConfig(configDir);
            const provider = new OciProvider({ defaultSpec: sandboxConfig });

            // 优先从磁盘恢复完整 handle（由 sandbox create 写入）
            let handle = await loadHandleJson(runPaths.runDir, cmdOpts.sandboxId);
            if (!handle) {
                const engineResolved = await resolveOciEngine(sandboxConfig.engine ?? 'auto');
                handle = {
                    sandbox_id: cmdOpts.sandboxId,
                    provider_id: 'oci_local',
                    engine_resolved: engineResolved,
                    workspace_access: sandboxConfig.workspace_access ?? 'none',
                    network_policy: sandboxConfig.network_policy ?? 'off',
                    resources: sandboxConfig.resources ?? {},
                };
            }

            const execSpec = {
                cmd: cmdOpts.cmd,
                args: cmdOpts.args,
                timeout_ms: cmdOpts.timeoutMs,
            };

            const result = await provider.exec(handle, execSpec);

            // 写完整审计链路（与 tool call 路径一致）
            const correlationId = `cmd_${randomBytes(4).toString('hex')}`;
            await writeCommandRecord(runPaths.runDir, handle.sandbox_id, {
                run_id: runPaths.runId,
                sandbox_id: handle.sandbox_id,
                provider_id: handle.provider_id ?? 'oci_local',
                correlation_id: correlationId,
                cmd: cmdOpts.cmd,
                args: cmdOpts.args,
                started_at: result.started_at,
                ended_at: result.ended_at,
                duration_ms: result.duration_ms,
                timeout_ms: cmdOpts.timeoutMs,
                timed_out: result.timed_out,
                exit_code: result.exit_code ?? null,
                signal: result.signal ?? null,
                workspace_access: handle.workspace_access ?? 'none',
                network_policy: handle.network_policy ?? 'off',
                stdout_bytes: result.stdout_bytes,
                stderr_bytes: result.stderr_bytes,
                stdout_truncated: result.stdout_truncated,
                stderr_truncated: result.stderr_truncated,
                stdout_max_bytes: result.stdout_max_bytes,
                stderr_max_bytes: result.stderr_max_bytes,
                ok: result.ok,
                ...(result.ok ? {} : { error: result.error }),
            });
            await writeOutputLogs(runPaths.runDir, handle.sandbox_id, {
                stdout: result.stdout,
                stderr: result.stderr,
            });
            const snapshot = await provider.snapshot(handle);
            await writeEnvFingerprint(runPaths.runDir, handle.sandbox_id, snapshot);

            process.stdout.write(JSON.stringify(result, null, 2) + '\n');
            if (!result.ok) process.exitCode = 1;
        } catch (err) {
            process.stderr.write(`[agents-team] sandbox exec 失败: ${err.message}\n`);
            process.exitCode = 1;
        }
    });

// ── tool ─────────────────────────────────────────
const toolCmd = program.command('tool').description('Tool 相关操作');

toolCmd
    .command('call')
    .description('通过 ToolGateway 调用指定 tool')
    .requiredOption('--name <tool>', 'tool 名称，例如 sandbox.exec')
    .requiredOption('--json <argsJson>', '参数 JSON 字符串')
    .action(async (cmdOpts) => {
        const runPaths = resolveRunPaths(program);
        const configDir = program.opts().configDir;

        let rawArgs;
        try {
            rawArgs = JSON.parse(cmdOpts.json);
        } catch {
            process.stderr.write('[agents-team] --json 参数不是合法 JSON\n');
            process.exitCode = 1;
            return;
        }

        try {
            const [sandboxConfig, toolsConfig] = await Promise.all([
                loadSandboxConfig(configDir),
                loadToolsConfig(configDir),
            ]);

            const ctx = createRuntime({
                outputDir: program.opts().outputDir,
                runId: runPaths.runId,
                sandboxSpec: sandboxConfig,
                policyConfig: toolsConfig.policy ?? {},
                allowedTools: toolsConfig.allowed_tools ?? null,
                enableCleanupHooks: true,
            });

            await writeRunIndex(ctx.runPaths);

            const result = await ctx.toolGateway.call(cmdOpts.name, rawArgs, ctx, {
                run_id: runPaths.runId,
            });

            process.stdout.write(JSON.stringify(result, null, 2) + '\n');

            if (!result.ok) {
                process.exitCode = 1;
            }
        } catch (err) {
            process.stderr.write(`[agents-team] tool call 失败: ${err.message}\n`);
            process.exitCode = 1;
        }
    });

toolCmd
    .command('list')
    .description('列出已注册的工具')
    .action(async () => {
        const configDir = program.opts().configDir;
        try {
            const [sandboxConfig, toolsConfig] = await Promise.all([
                loadSandboxConfig(configDir),
                loadToolsConfig(configDir),
            ]);

            const ctx = createRuntime({
                sandboxSpec: sandboxConfig,
                policyConfig: toolsConfig.policy ?? {},
                allowedTools: toolsConfig.allowed_tools ?? null,
            });

            process.stdout.write(JSON.stringify(ctx.toolRegistry.list(), null, 2) + '\n');
        } catch (err) {
            process.stderr.write(`[agents-team] tool list 失败: ${err.message}\n`);
            process.exitCode = 1;
        }
    });

// ── skill ─────────────────────────────────────────
const skillCmd = program.command('skill').description('Skill 相关操作');

skillCmd
    .command('run <skill_id>')
    .description('通过 SkillRunner 执行指定 skill')
    .requiredOption('--json <inputJson>', '输入 JSON 字符串')
    .action(async (skillId, cmdOpts) => {
        const runPaths = resolveRunPaths(program);
        const configDir = program.opts().configDir;

        let inputs;
        try {
            inputs = JSON.parse(cmdOpts.json);
        } catch {
            process.stderr.write('[agents-team] --json 参数不是合法 JSON\n');
            process.exitCode = 1;
            return;
        }

        try {
            const [sandboxConfig, toolsConfig, skillsConfig] = await Promise.all([
                loadSandboxConfig(configDir),
                loadToolsConfig(configDir),
                loadSkillsConfig(configDir),
            ]);

            const ctx = createRuntime({
                outputDir: program.opts().outputDir,
                runId: runPaths.runId,
                sandboxSpec: sandboxConfig,
                policyConfig: toolsConfig.policy ?? {},
                allowedTools: toolsConfig.allowed_tools ?? null,
                skillsConfig,
                skillsDir: DEFAULT_SKILLS_DIR,
                enableCleanupHooks: true,
            });

            await writeRunIndex(ctx.runPaths);

            const result = await ctx.skillRunner.run(skillId, inputs, ctx, {
                run_id: runPaths.runId,
            });

            process.stdout.write(JSON.stringify(result, null, 2) + '\n');

            if (!result.ok) {
                process.exitCode = 1;
            }
        } catch (err) {
            process.stderr.write(`[agents-team] skill run 失败: ${err.message}\n`);
            process.exitCode = 1;
        }
    });

skillCmd
    .command('list')
    .description('列出白名单中的 skill')
    .action(async () => {
        const configDir = program.opts().configDir;
        try {
            const skillsConfig = await loadSkillsConfig(configDir);
            process.stdout.write(JSON.stringify(skillsConfig.allowed_skills ?? [], null, 2) + '\n');
        } catch (err) {
            process.stderr.write(`[agents-team] skill list 失败: ${err.message}\n`);
            process.exitCode = 1;
        }
    });

// ── mcp ───────────────────────────────────────────
const mcpCmd = program.command('mcp').description('MCP 相关操作');

mcpCmd
    .command('call')
    .description('通过 McpClient 调用 MCP method')
    .requiredOption('--server <server>', 'MCP server 名称')
    .requiredOption('--method <method>', 'MCP method')
    .requiredOption('--json <paramsJson>', '参数 JSON 字符串')
    .action(() => {
        process.stderr.write('[agents-team] 此子命令将在 P18 阶段实现\n');
        process.exitCode = 1;
    });

program.parseAsync(normalizeArgv(process.argv)).catch((err) => {
    process.stderr.write(`[agents-team] 致命错误: ${err?.message ?? String(err)}\n`);
    process.exitCode = 1;
});
