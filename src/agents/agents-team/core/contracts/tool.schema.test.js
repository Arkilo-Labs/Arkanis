import test from 'node:test';
import assert from 'node:assert/strict';

import { ToolNameSchema, ToolPermissionSchema, ToolCallSchema, ToolResultSchema } from './tool.schema.js';
import { ErrorCode } from './errors.js';
import { DenyReason } from './denyReasons.js';

// ──────────────────────────────────────────────
// ToolNameSchema

test('ToolNameSchema: 接受合法 namespace.action 格式', () => {
    assert.equal(ToolNameSchema.parse('sandbox.exec'), 'sandbox.exec');
    assert.equal(ToolNameSchema.parse('mcp.call'), 'mcp.call');
    assert.equal(ToolNameSchema.parse('artifact.write_text'), 'artifact.write_text');
    assert.equal(ToolNameSchema.parse('a.b.c'), 'a.b.c');
});

test('ToolNameSchema: 拒绝不含点的名称', () => {
    assert.throws(() => ToolNameSchema.parse('sandboxexec'));
});

test('ToolNameSchema: 拒绝首字母大写', () => {
    assert.throws(() => ToolNameSchema.parse('Sandbox.exec'));
});

test('ToolNameSchema: 拒绝以点结尾', () => {
    assert.throws(() => ToolNameSchema.parse('sandbox.'));
});

// ──────────────────────────────────────────────
// ToolPermissionSchema

test('ToolPermissionSchema: 接受空对象', () => {
    assert.deepEqual(ToolPermissionSchema.parse({}), {});
});

test('ToolPermissionSchema: 接受全字段 false', () => {
    const input = {
        needs_network: false,
        needs_workspace_write: false,
        needs_host_exec: false,
        needs_secrets: false,
    };
    assert.deepEqual(ToolPermissionSchema.parse(input), input);
});

test('ToolPermissionSchema: 接受全字段 true', () => {
    const input = {
        needs_network: true,
        needs_workspace_write: true,
        needs_host_exec: true,
        needs_secrets: true,
    };
    assert.deepEqual(ToolPermissionSchema.parse(input), input);
});

test('ToolPermissionSchema: 拒绝未知字段（strict）', () => {
    assert.throws(() => ToolPermissionSchema.parse({ unknown_field: true }));
});

// ──────────────────────────────────────────────
// ToolCallSchema

test('ToolCallSchema: 接受合法完整样例', () => {
    const sample = {
        run_id: '20260217_153012',
        correlation_id: 'c_01abc',
        tool_name: 'sandbox.exec',
        args: { cmd: 'node', args: ['-v'] },
    };
    const parsed = ToolCallSchema.parse(sample);
    assert.equal(parsed.tool_name, 'sandbox.exec');
    assert.equal(parsed.run_id, '20260217_153012');
});

test('ToolCallSchema: 接受可选 parent_correlation_id', () => {
    const sample = {
        run_id: '20260217_153012',
        correlation_id: 'c_01abc',
        parent_correlation_id: 'c_parent',
        tool_name: 'artifact.hash',
        args: {},
    };
    assert.equal(ToolCallSchema.parse(sample).parent_correlation_id, 'c_parent');
});

test('ToolCallSchema: 拒绝非法 tool_name', () => {
    assert.throws(() =>
        ToolCallSchema.parse({
            run_id: '20260217_153012',
            correlation_id: 'c_x',
            tool_name: 'badname',
            args: {},
        }),
    );
});

test('ToolCallSchema: 拒绝缺失 run_id', () => {
    assert.throws(() =>
        ToolCallSchema.parse({
            correlation_id: 'c_x',
            tool_name: 'sandbox.exec',
            args: {},
        }),
    );
});

// ──────────────────────────────────────────────
// ToolResultSchema

test('ToolResultSchema: ok=true 含 data', () => {
    const r = ToolResultSchema.parse({ ok: true, data: { exit_code: 0 } });
    assert.equal(r.ok, true);
    assert.deepEqual(r.data, { exit_code: 0 });
});

test('ToolResultSchema: ok=false 含标准 error（ERR_POLICY_DENIED）', () => {
    const r = ToolResultSchema.parse({
        ok: false,
        error: {
            code: ErrorCode.ERR_POLICY_DENIED,
            message: 'network is disabled',
            deny_reason: DenyReason.NETWORK_DISABLED,
        },
    });
    assert.equal(r.ok, false);
    assert.equal(r.error.code, ErrorCode.ERR_POLICY_DENIED);
    assert.equal(r.error.deny_reason, DenyReason.NETWORK_DISABLED);
});

test('ToolResultSchema: ok=false 含标准 error（非 policy）', () => {
    const r = ToolResultSchema.parse({
        ok: false,
        error: { code: ErrorCode.ERR_TOOL_NOT_FOUND, message: 'tool missing' },
    });
    assert.equal(r.error.code, ErrorCode.ERR_TOOL_NOT_FOUND);
});

test('ToolResultSchema: 拒绝 ok=true 却缺少 data', () => {
    assert.throws(() => ToolResultSchema.parse({ ok: true }));
});

test('ToolResultSchema: 拒绝 ok=false 却缺少 error', () => {
    assert.throws(() => ToolResultSchema.parse({ ok: false }));
});
