import test from 'node:test';
import assert from 'node:assert/strict';

import { DenyReason } from './denyReasons.js';
import { AgentsTeamErrorSchema, ErrorCode } from './errors.js';

test('ErrorCode 集合冻结且不可变', () => {
    assert.equal(Object.isFrozen(ErrorCode), true);

    const values = [...Object.values(ErrorCode)].sort();
    const expected = [
        'ERR_INVALID_ARGUMENT',
        'ERR_MCP_PROTOCOL_ERROR',
        'ERR_MCP_START_FAILED',
        'ERR_POLICY_DENIED',
        'ERR_SANDBOX_EXEC_FAILED',
        'ERR_SANDBOX_EXEC_TIMEOUT',
        'ERR_SANDBOX_NOT_FOUND',
        'ERR_SANDBOX_START_FAILED',
        'ERR_SKILL_NOT_FOUND',
        'ERR_SKILL_VALIDATION_FAILED',
        'ERR_TOOL_EXEC_FAILED',
        'ERR_TOOL_NOT_FOUND',
        'ERR_TASK_NOT_FOUND',
        'ERR_MESSAGE_NOT_FOUND',
        'ERR_LEASE_CONFLICT',
        'ERR_LEASE_EXPIRED',
        'ERR_TASK_DEPENDENCY_NOT_MET',
        'ERR_LOCK_CONFLICT',
        'ERR_SESSION_INVALID_STATE',
    ].sort();

    assert.deepEqual(values, expected);
    assert.throws(() => {
        ErrorCode.NEW = 'ERR_NEW';
    }, TypeError);
});

test('DenyReason 集合冻结且不可变', () => {
    assert.equal(Object.isFrozen(DenyReason), true);

    const values = [...Object.values(DenyReason)].sort();
    const expected = [
        'HOST_EXEC_FORBIDDEN',
        'NETWORK_DISABLED',
        'SECRETS_FORBIDDEN',
        'SKILL_NOT_WHITELISTED',
        'WORKSPACE_WRITE_FORBIDDEN',
        'TASK_WRONG_STATE',
        'TASK_DEPENDENCY_NOT_MET',
        'LEASE_REQUIRED',
        'LOCK_HELD_BY_OTHER',
    ].sort();

    assert.deepEqual(values, expected);
    assert.throws(() => {
        DenyReason.NEW = 'NEW_REASON';
    }, TypeError);
});

test('AgentsTeamErrorSchema：能 parse 正确样例', () => {
    assert.deepEqual(
        AgentsTeamErrorSchema.parse({ code: ErrorCode.ERR_INVALID_ARGUMENT, message: 'x' }),
        { code: ErrorCode.ERR_INVALID_ARGUMENT, message: 'x' },
    );

    assert.deepEqual(
        AgentsTeamErrorSchema.parse({
            code: ErrorCode.ERR_POLICY_DENIED,
            message: 'x',
            deny_reason: DenyReason.NETWORK_DISABLED,
        }),
        {
            code: ErrorCode.ERR_POLICY_DENIED,
            message: 'x',
            deny_reason: DenyReason.NETWORK_DISABLED,
        },
    );
});

test('AgentsTeamErrorSchema：能拒绝错误样例', () => {
    assert.throws(() => {
        AgentsTeamErrorSchema.parse({ code: ErrorCode.ERR_POLICY_DENIED, message: 'x' });
    });

    assert.throws(() => {
        AgentsTeamErrorSchema.parse({
            code: ErrorCode.ERR_INVALID_ARGUMENT,
            message: 'x',
            deny_reason: DenyReason.NETWORK_DISABLED,
        });
    });

    assert.throws(() => {
        AgentsTeamErrorSchema.parse({ code: 'ERR_UNKNOWN', message: 'x' });
    });
});

