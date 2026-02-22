import { readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';

/**
 * 加载 .md fragment 文件，内容不变时从内存缓存返回，避免重复读盘。
 */
export function createFragmentLoader() {
    const cache = new Map(); // absolutePath -> { content, hash }

    /**
     * @param {string} fragmentPath 绝对路径
     * @returns {Promise<{ content: string, hash: string }>}
     */
    async function load(fragmentPath) {
        const cached = cache.get(fragmentPath);
        if (cached !== undefined) return cached;

        const content = await readFile(fragmentPath, 'utf-8');
        const hash = createHash('sha256').update(content).digest('hex');
        const result = Object.freeze({ content, hash });
        cache.set(fragmentPath, result);
        return result;
    }

    function clearCache() {
        cache.clear();
    }

    return { load, clearCache };
}
