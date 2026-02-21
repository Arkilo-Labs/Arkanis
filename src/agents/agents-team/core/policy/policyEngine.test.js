import test from 'node:test';
import assert from 'node:assert/strict';

import { PolicyEngine } from './policyEngine.js';
import { PolicyConfigSchema } from './policyConfig.schema.js';
import { DenyReason } from '../contracts/denyReasons.js';
import { ErrorCode } from '../contracts/errors.js';

test('PolicyEngine: 默认策略拒绝 needs_network', () => {
    const engine = new PolicyEngine();
    const result = engine.evaluate({ needs_network: true });
    assert.equal(result.decision, 'deny');
    assert.equal(result.reason, DenyReason.NETWORK_DISABLED);
});

test('PolicyEngine: 默认策略拒绝 needs_workspace_write', () => {
    const engine = new PolicyEngine();
    const result = engine.evaluate({ needs_workspace_write: true });
    assert.equal(result.decision, 'deny');
    assert.equal(result.reason, DenyReason.WORKSPACE_WRITE_FORBIDDEN);
});

test('PolicyEngine: 默认策略拒绝 needs_host_exec', () => {
    const engine = new PolicyEngine();
    const result = engine.evaluate({ needs_host_exec: true });
    assert.equal(result.decision, 'deny');
    assert.equal(result.reason, DenyReason.HOST_EXEC_FORBIDDEN);
});

test('PolicyEngine: 默认策略拒绝 needs_secrets', () => {
    const engine = new PolicyEngine();
    const result = engine.evaluate({ needs_secrets: true });
    assert.equal(result.decision, 'deny');
    assert.equal(result.reason, DenyReason.SECRETS_FORBIDDEN);
});

test('PolicyEngine: 空 permissions 允许', () => {
    const engine = new PolicyEngine();
    const result = engine.evaluate({});
    assert.equal(result.decision, 'allow');
});

test('PolicyEngine: network=full 时允许 needs_network', () => {
    const engine = new PolicyEngine({ network: 'full' });
    const result = engine.evaluate({ needs_network: true });
    assert.equal(result.decision, 'allow');
});

test('PolicyEngine: workspace_access=read_write 时允许 needs_workspace_write', () => {
    const engine = new PolicyEngine({ workspace_access: 'read_write' });
    const result = engine.evaluate({ needs_workspace_write: true });
    assert.equal(result.decision, 'allow');
});

test('PolicyEngine.check: deny 时返回标准化 error 对象', () => {
    const engine = new PolicyEngine();
    const result = engine.check({ needs_network: true });
    assert.equal(result.ok, false);
    assert.equal(result.error.code, ErrorCode.ERR_POLICY_DENIED);
    assert.equal(result.error.deny_reason, DenyReason.NETWORK_DISABLED);
});

test('PolicyEngine.check: allow 时返回 ok=true', () => {
    const engine = new PolicyEngine();
    const result = engine.check({});
    assert.equal(result.ok, true);
    assert.equal(result.policy_decision.decision, 'allow');
});

test('PolicyEngine: workspace=read_only 仍拒绝 write', () => {
    const engine = new PolicyEngine({ workspace_access: 'read_only' });
    const result = engine.evaluate({ needs_workspace_write: true });
    assert.equal(result.decision, 'deny');
    assert.equal(result.reason, DenyReason.WORKSPACE_WRITE_FORBIDDEN);
});

// ──────────────────────────────────────────────
// PolicyConfigSchema

test('PolicyConfigSchema: 空对象解析返回全默认值', () => {
    const result = PolicyConfigSchema.parse({});
    assert.deepEqual(result, {
        network: 'off',
        workspace_access: 'none',
        host_exec: 'deny',
        secrets: 'deny',
    });
});

test('PolicyConfigSchema: 拒绝未知字段（strict）', () => {
    assert.throws(() => PolicyConfigSchema.parse({ unknown_key: 'x' }));
});

test('PolicyConfigSchema: 拒绝非法枚举值', () => {
    assert.throws(() => PolicyConfigSchema.parse({ network: 'all' }));
    assert.throws(() => PolicyConfigSchema.parse({ host_exec: 'maybe' }));
});
