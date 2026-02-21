import { readFile } from 'node:fs/promises';
import path from 'node:path';

import { SkillManifestSchema } from '../contracts/skill.schema.js';
import { ErrorCode } from '../contracts/errors.js';

/**
 * SkillRegistry — 管理 skill manifest 加载与 builtin 实现注册。
 *
 * manifest 按需从磁盘 lazy 加载；builtin fn 通过 registerBuiltin 预先注册。
 * builtin fn 签名：async (ctx, inputs, meta) => outputs
 *   meta = { manifest, toolGateway, correlationId, runId }
 */
export class SkillRegistry {
    constructor() {
        this._manifests = new Map();
        this._builtins = new Map();
    }

    /**
     * 注册 builtin 实现函数。entry 为 manifest.implementation.entry。
     * @param {string} entry
     * @param {Function} fn  async (ctx, inputs, meta) => outputs
     */
    registerBuiltin(entry, fn) {
        if (!entry || typeof fn !== 'function') throw new Error('entry 和 fn 必填');
        if (this._builtins.has(entry)) throw new Error(`builtin "${entry}" 已注册，不允许重复`);
        this._builtins.set(entry, fn);
    }

    /**
     * 从磁盘加载并校验 manifest，注册到内存。
     * @param {string} skillsDir  skills 根目录（绝对路径）
     * @param {string} skillId
     * @returns {Promise<import('../contracts/skill.schema.js').SkillManifest>}
     */
    async loadManifest(skillsDir, skillId) {
        const manifestPath = path.join(skillsDir, skillId, 'manifest.json');

        let raw;
        try {
            raw = await readFile(manifestPath, 'utf-8');
        } catch (err) {
            const e = new Error(`skill "${skillId}" manifest 不存在: ${err.message}`);
            e.code = ErrorCode.ERR_SKILL_NOT_FOUND;
            throw e;
        }

        let data;
        try {
            data = JSON.parse(raw);
        } catch (err) {
            const e = new Error(`skill "${skillId}" manifest JSON 解析失败: ${err.message}`);
            e.code = ErrorCode.ERR_SKILL_VALIDATION_FAILED;
            throw e;
        }

        let manifest;
        try {
            manifest = SkillManifestSchema.parse(data);
        } catch (err) {
            const e = new Error(`skill "${skillId}" manifest schema 校验失败: ${err.message}`);
            e.code = ErrorCode.ERR_SKILL_VALIDATION_FAILED;
            throw e;
        }

        this._manifests.set(skillId, manifest);
        return manifest;
    }

    /**
     * 获取已加载的 manifest。未加载时抛出 ERR_SKILL_NOT_FOUND。
     * @param {string} skillId
     */
    getManifest(skillId) {
        const m = this._manifests.get(skillId);
        if (!m) {
            const e = new Error(`skill "${skillId}" manifest 未加载`);
            e.code = ErrorCode.ERR_SKILL_NOT_FOUND;
            throw e;
        }
        return m;
    }

    /**
     * 获取已注册的 builtin fn，不存在返回 null。
     * @param {string} entry
     * @returns {Function|null}
     */
    getBuiltin(entry) {
        return this._builtins.get(entry) ?? null;
    }

    listManifests() {
        return [...this._manifests.values()];
    }

    listBuiltins() {
        return [...this._builtins.keys()];
    }
}
