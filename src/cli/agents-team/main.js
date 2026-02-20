#!/usr/bin/env node
import { Command } from 'commander';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { createRunPaths, formatUtcRunId } from '../../agents/agents-team/core/outputs/runPaths.js';

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

function stubAction(phase) {
    return () => {
        process.stderr.write(`[agents-team] 此子命令将在 ${phase} 阶段实现\n`);
        process.exitCode = 1;
    };
}

const program = new Command();

program
    .name('agents-team')
    .description('Agents Team 执行底座验收入口（Sandbox / Tools / Skills / MCP）')
    .version('0.1.0')
    .option('--output-dir <dir>', '输出目录', './outputs/agents_team')
    .option('--run-id <id>', '指定 run_id（默认 UTC 时间戳生成）')
    .option('--config-dir <dir>', '配置目录', DEFAULT_CONFIG_DIR);

// sandbox
const sandboxCmd = program.command('sandbox').description('Sandbox 相关操作');

sandboxCmd
    .command('doctor')
    .description('检查宿主 engine/runtime 可用性')
    .action(stubAction('P6'));

sandboxCmd
    .command('exec')
    .description('在 sandbox 内执行命令并落盘审计')
    .requiredOption('--cmd <cmd>', '执行命令')
    .option('--args <arg>', '命令参数（可重复）', (v, prev) => [...(prev || []), v], [])
    .option('--network <policy>', 'network 策略：off|restricted|full', 'off')
    .action(stubAction('P10'));

// tool
const toolCmd = program.command('tool').description('Tool 相关操作');

toolCmd
    .command('call')
    .description('通过 ToolGateway 调用指定 tool')
    .requiredOption('--name <tool>', 'tool 名称，例如 sandbox.exec')
    .requiredOption('--json <argsJson>', '参数 JSON 字符串')
    .action(stubAction('P13'));

// skill
const skillCmd = program.command('skill').description('Skill 相关操作');

skillCmd
    .command('run <skill_id>')
    .description('通过 SkillRunner 执行指定 skill')
    .requiredOption('--json <inputJson>', '输入 JSON 字符串')
    .action(stubAction('P16'));

// mcp
const mcpCmd = program.command('mcp').description('MCP 相关操作');

mcpCmd
    .command('call')
    .description('通过 McpClient 调用 MCP method')
    .requiredOption('--server <server>', 'MCP server 名称')
    .requiredOption('--method <method>', 'MCP method')
    .requiredOption('--json <paramsJson>', '参数 JSON 字符串')
    .action(stubAction('P18'));

program.parseAsync(normalizeArgv(process.argv)).catch((err) => {
    process.stderr.write(`[agents-team] 致命错误: ${err?.message ?? String(err)}\n`);
    process.exitCode = 1;
});
