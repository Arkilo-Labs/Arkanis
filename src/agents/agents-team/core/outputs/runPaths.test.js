import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';

import { createRunPaths, formatUtcRunId, normalizeRunId } from './runPaths.js';

test('formatUtcRunId 使用 UTC 时间戳风格', () => {
    const d = new Date(Date.UTC(2026, 1, 17, 15, 30, 12));
    assert.equal(formatUtcRunId(d), '20260217_153012');
});

test('formatUtcRunId：拒绝非 Date 参数', () => {
    assert.throws(() => formatUtcRunId('2026-02-17'), /date 必须是 Date/);
});

test('normalizeRunId 只接受固定格式', () => {
    assert.equal(normalizeRunId('20260217_153012'), '20260217_153012');
    assert.throws(() => normalizeRunId('2026-02-17'), /run_id 格式不合法/);
});

test('createRunPaths 生成的路径是绝对路径且可预测', () => {
    const cwd = path.join(process.cwd(), 'tmp_p1');
    const runId = '20260217_153012';

    const paths = createRunPaths({ cwd, outputDir: 'outputs/agents_team', runId });

    const expectedRoot = path.resolve(cwd, 'outputs/agents_team');
    const expectedRunDir = path.join(expectedRoot, runId);

    assert.equal(paths.runId, runId);
    assert.equal(paths.outputsRootDir, expectedRoot);
    assert.equal(paths.runDir, expectedRunDir);
    assert.ok(path.isAbsolute(paths.outputsRootDir));
    assert.ok(path.isAbsolute(paths.runDir));

    assert.equal(paths.indexJsonPath, path.join(expectedRunDir, 'index.json'));

    assert.equal(paths.toolsDir, path.join(expectedRunDir, 'tools'));
    assert.equal(paths.toolCallsJsonlPath, path.join(expectedRunDir, 'tools', 'tool_calls.jsonl'));

    assert.equal(paths.skillsDir, path.join(expectedRunDir, 'skills'));
    assert.equal(paths.skillRunsJsonlPath, path.join(expectedRunDir, 'skills', 'skill_runs.jsonl'));

    assert.equal(paths.artifactsDir, path.join(expectedRunDir, 'artifacts'));
    assert.equal(paths.artifactDir('a1'), path.join(expectedRunDir, 'artifacts', 'a1'));

    assert.equal(paths.sandboxRootDir, path.join(expectedRunDir, 'sandbox'));
    assert.equal(paths.sandboxDir('sb1'), path.join(expectedRunDir, 'sandbox', 'sb1'));
    assert.equal(
        paths.sandboxCommandsJsonlPath('sb1'),
        path.join(expectedRunDir, 'sandbox', 'sb1', 'commands.jsonl'),
    );
    assert.equal(
        paths.sandboxEnvFingerprintJsonPath('sb1'),
        path.join(expectedRunDir, 'sandbox', 'sb1', 'env_fingerprint.json'),
    );
});

test('createRunPaths 新增控制面路径正确', () => {
    const cwd = path.join(process.cwd(), 'tmp_p2');
    const runId = '20260217_153012';
    const paths = createRunPaths({ cwd, outputDir: 'outputs/agents_team', runId });
    const runDir = paths.runDir;

    assert.equal(paths.tasksDir, path.join(runDir, 'tasks'));
    assert.equal(paths.taskPath('task-1'), path.join(runDir, 'tasks', 'task-1.json'));

    assert.equal(paths.mailboxDir, path.join(runDir, 'mailbox'));
    assert.equal(paths.messagePath('msg-1'), path.join(runDir, 'mailbox', 'msg-1.json'));
    assert.equal(paths.messageAckPath('msg-1'), path.join(runDir, 'mailbox', 'msg-1.ack.json'));

    assert.equal(paths.locksDir, path.join(runDir, 'locks'));
    assert.equal(paths.lockPath('lock-1'), path.join(runDir, 'locks', 'lock-1.json'));

    assert.equal(paths.promptsDir, path.join(runDir, 'prompts'));
});

test('taskPath / messagePath / lockPath 拒绝不合法的 segment', () => {
    const paths = createRunPaths({ outputDir: 'outputs/agents_team', runId: '20260217_153012' });
    assert.throws(() => paths.taskPath(''), /task_id 不能为空/);
    assert.throws(() => paths.messagePath(''), /msg_id 不能为空/);
    assert.throws(() => paths.lockPath(''), /lock_id 不能为空/);
});
