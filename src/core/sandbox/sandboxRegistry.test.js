import test from 'node:test';
import assert from 'node:assert/strict';

import { SandboxRegistry } from './sandboxRegistry.js';

function makeHandle(id) {
    return { sandbox_id: id, provider_id: 'oci_local', engine_resolved: 'docker' };
}

// ── register / get / remove ──────────────────────

test('SandboxRegistry: register + get 正常工作', () => {
    const reg = new SandboxRegistry();
    const h = makeHandle('sb_aaa');
    reg.register(h);
    assert.equal(reg.get('sb_aaa'), h);
});

test('SandboxRegistry: get 不存在的 id 返回 undefined', () => {
    const reg = new SandboxRegistry();
    assert.equal(reg.get('sb_nonexist'), undefined);
});

test('SandboxRegistry: register 重复 sandbox_id 抛错', () => {
    const reg = new SandboxRegistry();
    reg.register(makeHandle('sb_dup'));
    assert.throws(
        () => reg.register(makeHandle('sb_dup')),
        (err) => {
            assert.equal(err.code, 'ERR_INVALID_ARGUMENT');
            assert.ok(err.message.includes('sb_dup'));
            return true;
        },
    );
});

test('SandboxRegistry: register 缺少 sandbox_id 抛错', () => {
    const reg = new SandboxRegistry();
    assert.throws(
        () => reg.register({}),
        (err) => {
            assert.equal(err.code, 'ERR_INVALID_ARGUMENT');
            return true;
        },
    );
});

test('SandboxRegistry: remove 已注册项后 get 返回 undefined', () => {
    const reg = new SandboxRegistry();
    reg.register(makeHandle('sb_rm'));
    reg.remove('sb_rm');
    assert.equal(reg.get('sb_rm'), undefined);
});

test('SandboxRegistry: remove 不存在的 id 不抛错', () => {
    const reg = new SandboxRegistry();
    assert.doesNotThrow(() => reg.remove('sb_no'));
});

// ── list / size ─────────────────────────────────

test('SandboxRegistry: list 返回所有已注册 handle 的快照', () => {
    const reg = new SandboxRegistry();
    const h1 = makeHandle('sb_001');
    const h2 = makeHandle('sb_002');
    reg.register(h1);
    reg.register(h2);

    const items = reg.list();
    assert.equal(items.length, 2);
    assert.ok(items.includes(h1));
    assert.ok(items.includes(h2));
});

test('SandboxRegistry: list 返回的是快照，修改不影响 registry', () => {
    const reg = new SandboxRegistry();
    reg.register(makeHandle('sb_snap'));
    const items = reg.list();
    items.length = 0;
    assert.equal(reg.size, 1);
});

test('SandboxRegistry: size 反映注册数量', () => {
    const reg = new SandboxRegistry();
    assert.equal(reg.size, 0);
    reg.register(makeHandle('sb_s1'));
    assert.equal(reg.size, 1);
    reg.register(makeHandle('sb_s2'));
    assert.equal(reg.size, 2);
    reg.remove('sb_s1');
    assert.equal(reg.size, 1);
});

// ── destroyAll ───────────────────────────────────

test('SandboxRegistry: destroyAll 对所有 handle 调用 provider.destroy', async () => {
    const reg = new SandboxRegistry();
    reg.register(makeHandle('sb_d1'));
    reg.register(makeHandle('sb_d2'));
    reg.register(makeHandle('sb_d3'));

    const destroyCalls = [];
    const mockProvider = {
        async destroy(handle) {
            destroyCalls.push(handle.sandbox_id);
        },
    };

    const result = await reg.destroyAll(mockProvider);
    assert.deepEqual(result.destroyed.sort(), ['sb_d1', 'sb_d2', 'sb_d3']);
    assert.deepEqual(result.errors, []);
    assert.deepEqual(destroyCalls.sort(), ['sb_d1', 'sb_d2', 'sb_d3']);
});

test('SandboxRegistry: destroyAll 后 registry 为空', async () => {
    const reg = new SandboxRegistry();
    reg.register(makeHandle('sb_e1'));
    reg.register(makeHandle('sb_e2'));

    await reg.destroyAll({ async destroy() {} });

    assert.equal(reg.size, 0);
    assert.deepEqual(reg.list(), []);
});

test('SandboxRegistry: destroyAll 幂等 — 单个失败不阻塞其余', async () => {
    const reg = new SandboxRegistry();
    reg.register(makeHandle('sb_ok1'));
    reg.register(makeHandle('sb_fail'));
    reg.register(makeHandle('sb_ok2'));

    const mockProvider = {
        async destroy(handle) {
            if (handle.sandbox_id === 'sb_fail') {
                throw new Error('模拟销毁失败');
            }
        },
    };

    const result = await reg.destroyAll(mockProvider);

    assert.deepEqual(result.destroyed.sort(), ['sb_ok1', 'sb_ok2']);
    assert.equal(result.errors.length, 1);
    assert.equal(result.errors[0].sandbox_id, 'sb_fail');
    assert.ok(result.errors[0].error.message.includes('模拟销毁失败'));

    assert.equal(reg.size, 0);
});

test('SandboxRegistry: destroyAll 空 registry 返回空结果', async () => {
    const reg = new SandboxRegistry();
    const result = await reg.destroyAll({ async destroy() {} });
    assert.deepEqual(result.destroyed, []);
    assert.deepEqual(result.errors, []);
});
