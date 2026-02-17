import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { appendJsonlLine } from '../../../../core/utils/jsonlWriter.js';

import {
    AuditCommandRecordSchema,
    AuditSkillRunRecordSchema,
    AuditToolCallRecordSchema,
} from './audit.schema.js';
import { DenyReason } from './denyReasons.js';
import { ErrorCode } from './errors.js';

function nowIso() {
    return new Date().toISOString();
}

function splitJsonl(raw) {
    return String(raw || '')
        .split('\n')
        .map((line) => line.trim())
        .filter(Boolean);
}

test('appendJsonlLine：写入 commands.jsonl 单行且可被 schema 解析（ok=true）', async () => {
    const dir = await mkdtemp(path.join(tmpdir(), 'arkanis-audit-p3-'));
    const filePath = path.join(dir, 'commands.jsonl');

    const startedAt = nowIso();
    const endedAt = nowIso();

    const record = {
        run_id: '20260217_153012',
        sandbox_id: 'sb1',
        provider_id: 'oci_local',
        correlation_id: 'c_cmd_1',

        cmd: 'node',
        args: ['-v'],

        started_at: startedAt,
        ended_at: endedAt,
        duration_ms: 12,

        timed_out: false,
        timeout_ms: 5000,
        exit_code: 0,
        signal: null,

        workspace_access: 'none',
        network_policy: 'off',

        stdout_bytes: 10,
        stderr_bytes: 0,
        stdout_truncated: false,
        stderr_truncated: false,
        stdout_max_bytes: 1048576,
        stderr_max_bytes: 1048576,

        ok: true,
    };

    await appendJsonlLine(filePath, record);

    const raw = await readFile(filePath, 'utf-8');
    assert.ok(raw.endsWith('\n'));

    const lines = splitJsonl(raw);
    assert.equal(lines.length, 1);

    const parsed = JSON.parse(lines[0]);
    assert.deepEqual(AuditCommandRecordSchema.parse(parsed), record);
});

test('appendJsonlLine：写入 tool_calls.jsonl 且 deny 也能落盘（ok=false）', async () => {
    const dir = await mkdtemp(path.join(tmpdir(), 'arkanis-audit-p3-'));
    const filePath = path.join(dir, 'tool_calls.jsonl');

    const startedAt = nowIso();
    const endedAt = nowIso();

    const record = {
        run_id: '20260217_153012',
        correlation_id: 'c_tool_1',

        tool_name: 'sandbox.exec',
        args_hash: { alg: 'sha256', value: 'a'.repeat(64) },
        args_size_bytes: 123,
        policy_decision: { decision: 'deny', reason: DenyReason.NETWORK_DISABLED },

        started_at: startedAt,
        ended_at: endedAt,
        duration_ms: 1,

        ok: false,
        error: {
            code: ErrorCode.ERR_POLICY_DENIED,
            message: 'network is disabled',
            deny_reason: DenyReason.NETWORK_DISABLED,
        },
    };

    await appendJsonlLine(filePath, record);

    const raw = await readFile(filePath, 'utf-8');
    const lines = splitJsonl(raw);
    assert.equal(lines.length, 1);

    const parsed = JSON.parse(lines[0]);
    assert.deepEqual(AuditToolCallRecordSchema.parse(parsed), record);
});

test('appendJsonlLine：写入 skill_runs.jsonl 单行且可被 schema 解析（ok=true）', async () => {
    const dir = await mkdtemp(path.join(tmpdir(), 'arkanis-audit-p3-'));
    const filePath = path.join(dir, 'skill_runs.jsonl');

    const startedAt = nowIso();
    const endedAt = nowIso();

    const record = {
        run_id: '20260217_153012',
        correlation_id: 'c_skill_1',

        skill_id: 'run_command',
        skill_version: '0.1.0',

        inputs_hash: { alg: 'sha256', value: 'b'.repeat(64) },
        inputs_size_bytes: 456,

        tool_correlation_ids: ['c_tool_1'],
        artifact_refs: [{ artifact_id: 'a1', type: 'stdout' }],

        started_at: startedAt,
        ended_at: endedAt,
        duration_ms: 9,

        ok: true,
    };

    await appendJsonlLine(filePath, record);

    const raw = await readFile(filePath, 'utf-8');
    const lines = splitJsonl(raw);
    assert.equal(lines.length, 1);

    const parsed = JSON.parse(lines[0]);
    assert.deepEqual(AuditSkillRunRecordSchema.parse(parsed), record);
});

test('appendJsonlLine：拒绝写入不可序列化值', async () => {
    const dir = await mkdtemp(path.join(tmpdir(), 'arkanis-audit-p3-'));
    const filePath = path.join(dir, 'x.jsonl');

    await assert.rejects(() => appendJsonlLine(filePath, undefined), /JSON 序列化失败/);
});

