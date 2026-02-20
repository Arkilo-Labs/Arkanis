import { writeFile, mkdir } from 'node:fs/promises';
import { randomBytes } from 'node:crypto';
import path from 'node:path';

import { nowIso } from '../../../../core/sandbox/utils/clock.js';
import { hashFile } from './artifactHasher.js';
import { artifactDir, artifactFilePath } from './artifactPaths.js';
import { SAFE_SEGMENT_REGEX } from '../contracts/patterns.js';

function generateArtifactId() {
    return `art_${randomBytes(6).toString('hex')}`;
}

function validateArtifactsDir(artifactsDir) {
    if (!path.isAbsolute(artifactsDir)) {
        throw new Error('artifactsDir 必须是绝对路径');
    }
}

/**
 * ArtifactRegistry — 负责把产物写入 run 目录下的 artifacts/<id>/ 并建立索引。
 *
 * 禁止写入 artifactsDir 之外的任意路径。
 */
export class ArtifactRegistry {
    constructor({ artifactsDir }) {
        validateArtifactsDir(artifactsDir);
        this._artifactsDir = artifactsDir;
        this._records = new Map();
    }

    /**
     * 写入文本 artifact，返回 ArtifactRecord。
     */
    async writeText({ content, type = 'text', filename = 'content.txt', provenance }) {
        const artifactId = generateArtifactId();
        const dir = artifactDir(this._artifactsDir, artifactId);
        await mkdir(dir, { recursive: true });

        const filePath = artifactFilePath(this._artifactsDir, artifactId, filename);
        await writeFile(filePath, content, 'utf-8');

        const hash = await hashFile(filePath);
        const stat = Buffer.byteLength(content, 'utf-8');

        const record = {
            artifact_id: artifactId,
            type,
            path: filePath,
            hash,
            ...(provenance ? { provenance } : {}),
            created_at: nowIso(),
            size_bytes: stat,
        };

        this._records.set(artifactId, record);
        return record;
    }

    /**
     * 写入 Buffer artifact，返回 ArtifactRecord。
     */
    async writeBuffer({ data, type = 'binary', filename = 'content.bin', provenance }) {
        const artifactId = generateArtifactId();
        const dir = artifactDir(this._artifactsDir, artifactId);
        await mkdir(dir, { recursive: true });

        const filePath = artifactFilePath(this._artifactsDir, artifactId, filename);
        const buf = Buffer.isBuffer(data) ? data : Buffer.from(data);
        await writeFile(filePath, buf);

        const hash = await hashFile(filePath);

        const record = {
            artifact_id: artifactId,
            type,
            path: filePath,
            hash,
            ...(provenance ? { provenance } : {}),
            created_at: nowIso(),
            size_bytes: buf.byteLength,
        };

        this._records.set(artifactId, record);
        return record;
    }

    /**
     * 查询已注册的 artifact record。
     */
    get(artifactId) {
        return this._records.get(artifactId) ?? null;
    }

    list() {
        return [...this._records.values()];
    }
}
