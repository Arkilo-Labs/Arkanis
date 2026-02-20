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
