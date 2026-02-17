import path from 'node:path';

import { RUN_ID_REGEX, SAFE_SEGMENT_REGEX } from '../contracts/patterns.js';

function pad2(n) {
    return String(n).padStart(2, '0');
}

export function formatUtcRunId(date) {
    if (date !== undefined && !(date instanceof Date)) {
        throw new Error('date 必须是 Date 或 undefined');
    }
    const d = date instanceof Date ? date : new Date();
    return `${d.getUTCFullYear()}${pad2(d.getUTCMonth() + 1)}${pad2(d.getUTCDate())}_${pad2(
        d.getUTCHours(),
    )}${pad2(d.getUTCMinutes())}${pad2(d.getUTCSeconds())}`;
}

export function normalizeRunId(value) {
    const id = String(value || '').trim();
    if (!id) throw new Error('run_id 不能为空');
    if (!RUN_ID_REGEX.test(id)) {
        throw new Error(`run_id 格式不合法: ${id}`);
    }
    return id;
}

function normalizeSafeSegment(label, value) {
    const id = String(value || '').trim();
    if (!id) throw new Error(`${label} 不能为空`);
    if (!SAFE_SEGMENT_REGEX.test(id)) {
        throw new Error(`${label} 格式不合法: ${id}`);
    }
    return id;
}

function resolveAbsolutePath(cwd, p) {
    const base = String(cwd || '').trim() ? String(cwd) : process.cwd();
    const raw = String(p || '').trim();
    if (!raw) throw new Error('output_dir 不能为空');
    return path.isAbsolute(raw) ? raw : path.resolve(base, raw);
}

export function createRunPaths({ outputDir, runId, cwd } = {}) {
    const normalizedRunId = runId ? normalizeRunId(runId) : formatUtcRunId(new Date());
    const outputsRootDir = resolveAbsolutePath(cwd, outputDir || './outputs/agents_team');
    const runDir = path.join(outputsRootDir, normalizedRunId);

    const sandboxRootDir = path.join(runDir, 'sandbox');
    const toolsDir = path.join(runDir, 'tools');
    const skillsDir = path.join(runDir, 'skills');
    const artifactsDir = path.join(runDir, 'artifacts');

    const sandboxDir = (sandboxId) =>
        path.join(sandboxRootDir, normalizeSafeSegment('sandbox_id', sandboxId));

    const artifactDir = (artifactId) =>
        path.join(artifactsDir, normalizeSafeSegment('artifact_id', artifactId));

    return {
        runId: normalizedRunId,
        outputsRootDir,
        runDir,

        indexJsonPath: path.join(runDir, 'index.json'),

        sandboxRootDir,
        sandboxDir,
        sandboxCommandsJsonlPath: (sandboxId) => path.join(sandboxDir(sandboxId), 'commands.jsonl'),
        sandboxStdoutLogPath: (sandboxId) => path.join(sandboxDir(sandboxId), 'stdout.log'),
        sandboxStderrLogPath: (sandboxId) => path.join(sandboxDir(sandboxId), 'stderr.log'),
        sandboxEnvFingerprintJsonPath: (sandboxId) =>
            path.join(sandboxDir(sandboxId), 'env_fingerprint.json'),
        sandboxNetworkJsonlPath: (sandboxId) => path.join(sandboxDir(sandboxId), 'network.jsonl'),

        toolsDir,
        toolCallsJsonlPath: path.join(toolsDir, 'tool_calls.jsonl'),

        skillsDir,
        skillRunsJsonlPath: path.join(skillsDir, 'skill_runs.jsonl'),

        artifactsDir,
        artifactDir,
    };
}
