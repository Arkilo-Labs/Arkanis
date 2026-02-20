import test from 'node:test';
import assert from 'node:assert/strict';

import { runOciCommand, probeExecutable } from './ociCli.js';

// 用当前 Node.js 进程作为受控 "engine"，跨平台可用
const NODE = process.execPath;

// ── runOciCommand ────────────────────────────────────────────────

test('ociCli: 基本 stdout 捕获', async () => {
    const result = await runOciCommand(NODE, ['-e', "process.stdout.write('hello')"], {});

    assert.equal(result.exit_code, 0);
    assert.equal(result.stdout, 'hello');
    assert.equal(result.stdout_bytes, 5);
    assert.equal(result.stdout_truncated, false);
    assert.equal(result.timed_out, false);
    assert.equal(result.spawnError, null);
});

test('ociCli: 基本 stderr 捕获', async () => {
    const result = await runOciCommand(NODE, ['-e', "process.stderr.write('err')"], {});

    assert.equal(result.exit_code, 0);
    assert.equal(result.stderr, 'err');
    assert.equal(result.stderr_bytes, 3);
    assert.equal(result.stderr_truncated, false);
    assert.equal(result.timed_out, false);
});

test('ociCli: 非零退出码正常返回', async () => {
    const result = await runOciCommand(NODE, ['-e', 'process.exit(42)'], {});

    assert.equal(result.exit_code, 42);
    assert.equal(result.timed_out, false);
    assert.equal(result.spawnError, null);
});

test('ociCli: 超时时 SIGKILL 进程，timed_out=true 且 exit_code=null', async () => {
    const result = await runOciCommand(
        NODE,
        ['-e', 'setTimeout(()=>{}, 30000)'],
        { timeout_ms: 400 },
    );

    assert.equal(result.timed_out, true);
    assert.equal(result.exit_code, null);
    assert.equal(result.spawnError, null);
});

test('ociCli: 超时时 spawnError 仍为 null（kill 后 close 事件正常收尾）', async () => {
    const result = await runOciCommand(
        NODE,
        ['-e', 'setInterval(()=>{}, 1000)'],
        { timeout_ms: 200 },
    );

    assert.equal(result.timed_out, true);
    assert.equal(result.spawnError, null);
});

test('ociCli: stdout 超出 max_stdout_bytes 时截断', async () => {
    const result = await runOciCommand(
        NODE,
        ['-e', "process.stdout.write('a'.repeat(200))"],
        { max_stdout_bytes: 10 },
    );

    assert.equal(result.stdout_truncated, true);
    assert.equal(result.stdout_bytes, 200);
    assert.equal(result.stdout.length, 10);
    assert.equal(result.stdout_max_bytes, 10);
});

test('ociCli: stderr 超出 max_stderr_bytes 时截断', async () => {
    const result = await runOciCommand(
        NODE,
        ['-e', "process.stderr.write('x'.repeat(200))"],
        { max_stderr_bytes: 5 },
    );

    assert.equal(result.stderr_truncated, true);
    assert.equal(result.stderr_bytes, 200);
    assert.equal(result.stderr.length, 5);
    assert.equal(result.stderr_max_bytes, 5);
});

test('ociCli: stdout 未截断时 truncated=false 且 bytes 与长度一致', async () => {
    const result = await runOciCommand(
        NODE,
        ['-e', "process.stdout.write('abc')"],
        { max_stdout_bytes: 1024 },
    );

    assert.equal(result.stdout_truncated, false);
    assert.equal(result.stdout_bytes, 3);
    assert.equal(result.stdout.length, 3);
    assert.equal(result.stdout_max_bytes, 1024);
});

test('ociCli: 二进制不存在时 spawnError 非 null', async () => {
    const result = await runOciCommand('__nonexistent_binary_xyz_8734__', [], {});

    assert.ok(result.spawnError !== null, 'spawnError 应为非 null');
    assert.equal(result.timed_out, false);
    assert.equal(result.exit_code, null);
});

test('ociCli: 结果包含 ISO 时间戳与非负 duration_ms', async () => {
    const result = await runOciCommand(NODE, ['-e', ''], {});

    assert.match(result.startedAt, /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/);
    assert.match(result.endedAt, /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/);
    assert.ok(typeof result.duration_ms === 'number');
    assert.ok(result.duration_ms >= 0);
});

test('ociCli: endedAt >= startedAt', async () => {
    const result = await runOciCommand(NODE, ['-e', ''], {});

    const start = new Date(result.startedAt).getTime();
    const end = new Date(result.endedAt).getTime();
    assert.ok(end >= start, `endedAt(${result.endedAt}) 应 >= startedAt(${result.startedAt})`);
});

test('ociCli: stdout 与 stderr 同时输出时各自独立捕获', async () => {
    const result = await runOciCommand(
        NODE,
        ['-e', "process.stdout.write('out'); process.stderr.write('err')"],
        {},
    );

    assert.equal(result.stdout, 'out');
    assert.equal(result.stderr, 'err');
});

// ── probeExecutable ──────────────────────────────────────────────

test('ociCli: probeExecutable 对 node 返回 true', async () => {
    const found = await probeExecutable(NODE);
    assert.equal(found, true);
});

test('ociCli: probeExecutable 对不存在的二进制返回 false', async () => {
    const found = await probeExecutable('__nonexistent_binary_xyz_8734__');
    assert.equal(found, false);
});
