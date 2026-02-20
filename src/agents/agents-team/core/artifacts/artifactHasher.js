import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';

/**
 * 对文件内容计算 SHA-256 哈希。
 * @param {string} filePath
 * @returns {Promise<{alg: 'sha256', value: string}>}
 */
export async function hashFile(filePath) {
    const buf = await readFile(filePath);
    const value = createHash('sha256').update(buf).digest('hex');
    return { alg: 'sha256', value };
}

/**
 * 对 Buffer/string 计算 SHA-256 哈希。
 */
export function hashBuffer(data) {
    const buf = Buffer.isBuffer(data) ? data : Buffer.from(data, 'utf-8');
    const value = createHash('sha256').update(buf).digest('hex');
    return { alg: 'sha256', value };
}
