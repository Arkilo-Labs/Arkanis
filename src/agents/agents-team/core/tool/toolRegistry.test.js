import test from 'node:test';
import assert from 'node:assert/strict';

import { z } from 'zod';

import { ToolRegistry } from './toolRegistry.js';
import { ErrorCode } from '../contracts/errors.js';

function makeTool(name, permissions = {}) {
    return {
        name,
        permissions,
        inputSchema: z.object({}).strict(),
        outputSchema: z.object({}).strict(),
        run: async () => ({}),
    };
}

test('ToolRegistry: 注册后可通过 get 获取', () => {
    const registry = new ToolRegistry();
    registry.register(makeTool('ns.action'));
    const tool = registry.get('ns.action');
    assert.equal(tool.name, 'ns.action');
});

test('ToolRegistry: 获取不存在的工具抛出 ERR_TOOL_NOT_FOUND', () => {
    const registry = new ToolRegistry();
    assert.throws(
        () => registry.get('nonexistent.tool'),
        (err) => err.code === ErrorCode.ERR_TOOL_NOT_FOUND,
    );
});

test('ToolRegistry: 重复注册同名工具抛出错误', () => {
    const registry = new ToolRegistry();
    registry.register(makeTool('ns.dup'));
    assert.throws(() => registry.register(makeTool('ns.dup')));
});

test('ToolRegistry: list 返回已注册工具摘要', () => {
    const registry = new ToolRegistry();
    registry.register(makeTool('ns.a'));
    registry.register(makeTool('ns.b'));
    const list = registry.list();
    assert.equal(list.length, 2);
    const names = list.map((t) => t.name);
    assert.ok(names.includes('ns.a'));
    assert.ok(names.includes('ns.b'));
});

test('ToolRegistry: 注册时缺少 name 抛出错误', () => {
    const registry = new ToolRegistry();
    assert.throws(() =>
        registry.register({
            run: async () => ({}),
            inputSchema: z.object({}),
            outputSchema: z.object({}),
        }),
    );
});

test('ToolRegistry: 注册时缺少 run 抛出错误', () => {
    const registry = new ToolRegistry();
    assert.throws(() =>
        registry.register({
            name: 'ns.tool',
            inputSchema: z.object({}),
            outputSchema: z.object({}),
        }),
    );
});

test('ToolRegistry: 注册时缺少 inputSchema 抛出错误', () => {
    const registry = new ToolRegistry();
    assert.throws(() =>
        registry.register({
            name: 'ns.tool',
            run: async () => ({}),
            outputSchema: z.object({}),
        }),
    );
});
