#!/usr/bin/env node
import { Command } from 'commander';
import { readFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { createRunPaths, formatUtcRunId } from '../../agents/agents-team/core/outputs/runPaths.js';
import { writeRunIndex } from '../../agents/agents-team/core/outputs/runIndexWriter.js';
import { createRuntime } from '../../agents/agents-team/core/runtime/createRuntime.js';
import { OciProvider } from '../../core/sandbox/index.js';

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
    .command('exec')
    .description('在 sandbox 内执行命令并落盘审计')
    .requiredOption('--cmd <cmd>', '执行命令')
    .option('--args <arg>', '命令参数（可重复）', (v, prev) => [...(prev || []), v], [])
    .option('--network <policy>', 'network 策略：off|restricted|full', 'off')
    .option('--timeout-ms <ms>', '超时毫秒', (v) => parseInt(v, 10), 60000)
    .action(async (cmdOpts, cmd) => {
        const runPaths = resolveRunPaths(program);
        const configDir = program.opts().configDir;

        try {
            const [sandboxConfig, toolsConfig] = await Promise.all([
                loadSandboxConfig(configDir),
                loadToolsConfig(configDir),
            ]);

            const ctx = createRuntime({
                outputDir: program.opts().outputDir,
                runId: runPaths.runId,
                sandboxSpec: { ...sandboxConfig, network_policy: cmdOpts.network },
                policyConfig: toolsConfig.policy ?? {},
            });

            await writeRunIndex(ctx.runPaths);

            const result = await ctx.toolGateway.call(
                'sandbox.exec',
                {
                    cmd: cmdOpts.cmd,
                    args: cmdOpts.args,
                    network: cmdOpts.network,
                    timeout_ms: cmdOpts.timeoutMs,
                },
                ctx,
                { run_id: runPaths.runId },
            );

            process.stdout.write(JSON.stringify(result, null, 2) + '\n');

            if (!result.ok || (result.data && !result.data.ok)) {
                process.exitCode = 1;
            }
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
    .action(() => {
        process.stderr.write('[agents-team] 此子命令将在 P16 阶段实现\n');
        process.exitCode = 1;
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
