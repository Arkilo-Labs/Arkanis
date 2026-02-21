import test from 'node:test';
import assert from 'node:assert/strict';
import { writeFile, mkdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { SkillRegistry } from './skillRegistry.js';
import { ErrorCode } from '../contracts/errors.js';

async function makeTempSkillsDir(skillId, manifest) {
    const dir = join(tmpdir(), `skill-test-${Date.now()}-${Math.random().toString(36).slice(2)}`);
    await mkdir(join(dir, skillId), { recursive: true });
    await writeFile(join(dir, skillId, 'manifest.json'), JSON.stringify(manifest), 'utf-8');
    return dir;
}

const VALID_MANIFEST = {
    id: 'run_command',
    version: '0.1.0',
    description: '在 sandbox 内执行命令',
    implementation: { type: 'builtin', entry: 'runCommand' },
    permissions: { network: 'off', workspace_access: 'none', host_exec: 'deny', secrets: 'deny' },
    inputs: { cmd: 'string' },
    outputs: { exit_code: 'number' },
};

test('SkillRegistry: loadManifest 成功加载有效 manifest', async () => {
    const skillsDir = await makeTempSkillsDir('run_command', VALID_MANIFEST);
    try {
        const registry = new SkillRegistry();
        const manifest = await registry.loadManifest(skillsDir, 'run_command');
        assert.equal(manifest.id, 'run_command');
        assert.equal(manifest.version, '0.1.0');
    } finally {
        await rm(skillsDir, { recursive: true, force: true });
    }
});

test('SkillRegistry: getManifest 在 loadManifest 后可获取', async () => {
    const skillsDir = await makeTempSkillsDir('run_command', VALID_MANIFEST);
    try {
        const registry = new SkillRegistry();
        await registry.loadManifest(skillsDir, 'run_command');
        const manifest = registry.getManifest('run_command');
        assert.equal(manifest.id, 'run_command');
    } finally {
        await rm(skillsDir, { recursive: true, force: true });
    }
});

test('SkillRegistry: getManifest 未加载时抛出 ERR_SKILL_NOT_FOUND', () => {
    const registry = new SkillRegistry();
    assert.throws(
        () => registry.getManifest('nonexistent'),
        (err) => err.code === ErrorCode.ERR_SKILL_NOT_FOUND,
    );
});

test('SkillRegistry: loadManifest 文件不存在抛出 ERR_SKILL_NOT_FOUND', async () => {
    const registry = new SkillRegistry();
    await assert.rejects(
        () => registry.loadManifest('/nonexistent/path', 'some_skill'),
        (err) => err.code === ErrorCode.ERR_SKILL_NOT_FOUND,
    );
});

test('SkillRegistry: loadManifest schema 校验失败抛出 ERR_SKILL_VALIDATION_FAILED', async () => {
    const invalidManifest = { id: 'bad', version: '1.0.0' };
    const skillsDir = await makeTempSkillsDir('bad', invalidManifest);
    try {
        const registry = new SkillRegistry();
        await assert.rejects(
            () => registry.loadManifest(skillsDir, 'bad'),
            (err) => err.code === ErrorCode.ERR_SKILL_VALIDATION_FAILED,
        );
    } finally {
        await rm(skillsDir, { recursive: true, force: true });
    }
});

test('SkillRegistry: registerBuiltin 后 getBuiltin 返回函数', () => {
    const registry = new SkillRegistry();
    const fn = async () => ({});
    registry.registerBuiltin('runCommand', fn);
    assert.equal(registry.getBuiltin('runCommand'), fn);
});

test('SkillRegistry: getBuiltin 未注册返回 null', () => {
    const registry = new SkillRegistry();
    assert.equal(registry.getBuiltin('nonexistent'), null);
});

test('SkillRegistry: registerBuiltin 重复注册抛出错误', () => {
    const registry = new SkillRegistry();
    registry.registerBuiltin('runCommand', async () => ({}));
    assert.throws(() => registry.registerBuiltin('runCommand', async () => ({})));
});

test('SkillRegistry: listManifests 返回已加载的 manifests', async () => {
    const skillsDir = await makeTempSkillsDir('run_command', VALID_MANIFEST);
    try {
        const registry = new SkillRegistry();
        assert.equal(registry.listManifests().length, 0);
        await registry.loadManifest(skillsDir, 'run_command');
        assert.equal(registry.listManifests().length, 1);
    } finally {
        await rm(skillsDir, { recursive: true, force: true });
    }
});

test('SkillRegistry: listBuiltins 返回已注册的 entry 名', () => {
    const registry = new SkillRegistry();
    registry.registerBuiltin('runCommand', async () => ({}));
    registry.registerBuiltin('mcpInvoke', async () => ({}));
    const builtins = registry.listBuiltins();
    assert.ok(builtins.includes('runCommand'));
    assert.ok(builtins.includes('mcpInvoke'));
});
