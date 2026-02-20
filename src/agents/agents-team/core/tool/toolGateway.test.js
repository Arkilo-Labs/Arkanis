import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { z } from 'zod';

import { ToolRegistry } from './toolRegistry.js';
import { ToolGateway } from './toolGateway.js';
import { PolicyEngine } from '../policy/policyEngine.js';
import { DenyReason } from '../contracts/denyReasons.js';
import { ErrorCode } from '../contracts/errors.js';

function splitJsonl(raw) {
    return String(raw || '')
        .split('\n')
        .map((l) => l.trim())
        .filter(Boolean);
}

function makeTool(name, permissions = {}, runFn = async (_ctx, args) => args) {
    return {
        name,
        permissions,
        inputSchema: z.object({ value: z.string() }).strict(),
        outputSchema: z.object({ value: z.string() }).strict(),
        run: runFn,
    };
}

async function makeGateway(policyConfig = {}, toolOverrides = {}) {
    const dir = await mkdtemp(path.join(tmpdir(), 'arkanis-gw-'));
    const auditPath = path.join(dir, 'tool_calls.jsonl');

    const registry = new ToolRegistry();
    const policy = new PolicyEngine(policyConfig);

    registry.register(
        makeTool('test.echo', toolOverrides.permissions ?? {}, toolOverrides.run),
    );

    const gateway = new ToolGateway({
        toolRegistry: registry,
        policyEngine: policy,
        toolCallsJsonlPath: auditPath,
    });

    return { gateway, auditPath, runId: '20260217_153012' };
}

test('ToolGateway: 工具不存在返回 ERR_TOOL_NOT_FOUND 并写审计', async () => {
    const dir = await mkdtemp(path.join(tmpdir(), 'arkanis-gw-'));
    const auditPath = path.join(dir, 'tool_calls.jsonl');

    const registry = new ToolRegistry();
    const gateway = new ToolGateway({
        toolRegistry: registry,
        policyEngine: new PolicyEngine(),
        toolCallsJsonlPath: auditPath,
    });

    const result = await gateway.call('nonexistent.tool', {}, {}, { run_id: '20260217_153012' });

    assert.equal(result.ok, false);
    assert.equal(result.error.code, ErrorCode.ERR_TOOL_NOT_FOUND);

    const raw = await readFile(auditPath, 'utf-8');
    const lines = splitJsonl(raw);
    assert.equal(lines.length, 1);
    const record = JSON.parse(lines[0]);
    assert.equal(record.ok, false);
    assert.equal(record.error.code, ErrorCode.ERR_TOOL_NOT_FOUND);
});

test('ToolGateway: 参数校验失败返回 ERR_INVALID_ARGUMENT 并写审计', async () => {
    const { gateway, auditPath, runId } = await makeGateway();

    const result = await gateway.call('test.echo', { bad_field: 1 }, {}, { run_id: runId });

    assert.equal(result.ok, false);
    assert.equal(result.error.code, ErrorCode.ERR_INVALID_ARGUMENT);

    const raw = await readFile(auditPath, 'utf-8');
    const record = JSON.parse(splitJsonl(raw)[0]);
    assert.equal(record.ok, false);
    assert.equal(record.tool_name, 'test.echo');
});

test('ToolGateway: policy deny 时返回 ERR_POLICY_DENIED 并写审计（ok=false）', async () => {
    const { gateway, auditPath, runId } = await makeGateway(
        {},
        { permissions: { needs_network: true } },
    );

    const result = await gateway.call('test.echo', { value: 'hi' }, {}, { run_id: runId });

    assert.equal(result.ok, false);
    assert.equal(result.error.code, ErrorCode.ERR_POLICY_DENIED);
    assert.equal(result.error.deny_reason, DenyReason.NETWORK_DISABLED);

    const raw = await readFile(auditPath, 'utf-8');
    const record = JSON.parse(splitJsonl(raw)[0]);
    assert.equal(record.ok, false);
    assert.equal(record.policy_decision.decision, 'deny');
    assert.equal(record.policy_decision.reason, DenyReason.NETWORK_DISABLED);
});

test('ToolGateway: 执行成功时 ok=true 且写审计', async () => {
    const { gateway, auditPath, runId } = await makeGateway();

    const result = await gateway.call('test.echo', { value: 'hello' }, {}, { run_id: runId });

    assert.equal(result.ok, true);
    assert.deepEqual(result.data, { value: 'hello' });

    const raw = await readFile(auditPath, 'utf-8');
    const record = JSON.parse(splitJsonl(raw)[0]);
    assert.equal(record.ok, true);
    assert.equal(record.tool_name, 'test.echo');
    assert.ok(record.args_hash?.value);
});

test('ToolGateway: run 抛出时返回 ERR_TOOL_EXEC_FAILED', async () => {
    const { gateway, auditPath, runId } = await makeGateway(
        {},
        { run: async () => { throw new Error('boom'); } },
    );

    const result = await gateway.call('test.echo', { value: 'x' }, {}, { run_id: runId });

    assert.equal(result.ok, false);
    assert.equal(result.error.code, ErrorCode.ERR_TOOL_EXEC_FAILED);
});

test('ToolGateway: outputSchema 校验失败时返回 ERR_TOOL_EXEC_FAILED', async () => {
    const badTool = {
        name: 'test.badout',
        permissions: {},
        inputSchema: z.object({ value: z.string() }).strict(),
        outputSchema: z.object({ must_have: z.string() }).strict(),
        run: async (_ctx, args) => ({ value: args.value }),
    };

    const dir = await mkdtemp(path.join(tmpdir(), 'arkanis-gw-'));
    const auditPath = path.join(dir, 'tool_calls.jsonl');
    const registry = new ToolRegistry();
    registry.register(badTool);
    const gateway = new ToolGateway({
        toolRegistry: registry,
        policyEngine: new PolicyEngine(),
        toolCallsJsonlPath: auditPath,
    });

    const result = await gateway.call('test.badout', { value: 'x' }, {}, { run_id: '20260217_153012' });

    assert.equal(result.ok, false);
    assert.equal(result.error.code, ErrorCode.ERR_TOOL_EXEC_FAILED);
    assert.ok(result.error.message.includes('输出 schema 校验失败'));
});
