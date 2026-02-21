import path from 'node:path';

/**
 * 生成 artifact 在 run 目录下的文件路径。
 *
 * @param {string} artifactsDir  runPaths.artifactsDir
 * @param {string} artifactId
 * @param {string} filename  e.g. 'content.txt'
 */
export function artifactFilePath(artifactsDir, artifactId, filename) {
    return path.join(artifactsDir, artifactId, filename);
}

/**
 * 生成 artifact 目录路径。
 */
export function artifactDir(artifactsDir, artifactId) {
    return path.join(artifactsDir, artifactId);
}

/**
 * 解析用户提供的相对路径，确保结果不逃出 artifactsDir。
 * 路径穿越时 throw，code = 'ERR_INVALID_ARGUMENT'。
 *
 * @param {string} artifactsDir  绝对路径
 * @param {string} userPath      用户输入的相对路径
 * @returns {string}             解析后的绝对路径
 */
export function resolveUserPath(artifactsDir, userPath) {
    const base = path.resolve(artifactsDir);
    const resolved = path.resolve(base, userPath);
    if (resolved !== base && !resolved.startsWith(base + path.sep)) {
        const err = new Error(`path traversal: "${userPath}"`);
        err.code = 'ERR_INVALID_ARGUMENT';
        throw err;
    }
    return resolved;
}
