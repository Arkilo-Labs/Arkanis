import { writeFile, rename, copyFile, unlink, mkdir } from 'node:fs/promises';
import { randomBytes } from 'node:crypto';
import path from 'node:path';

/**
 * 原子写 JSON 文件。
 * 先写临时文件（同目录），再 rename；Windows 跨盘符时降级为 copyFile + unlink。
 *
 * @param {string} filePath  目标文件绝对路径
 * @param {unknown} data     可序列化的数据
 */
export async function atomicWriteJson(filePath, data) {
    const tmpPath = `${filePath}.${randomBytes(4).toString('hex')}.tmp`;
    await mkdir(path.dirname(filePath), { recursive: true });
    await writeFile(tmpPath, JSON.stringify(data, null, 2), 'utf-8');
    try {
        await rename(tmpPath, filePath);
    } catch (err) {
        if (err.code === 'EXDEV') {
            // 跨盘符：rename 不可用，降级为 copy + delete
            try {
                await copyFile(tmpPath, filePath);
            } finally {
                await unlink(tmpPath).catch(() => {});
            }
        } else if (err.code === 'EPERM') {
            // Windows：目标文件被其他进程持有读锁时 rename 抛 EPERM，降级为 copy + delete
            try {
                await copyFile(tmpPath, filePath);
            } finally {
                await unlink(tmpPath).catch(() => {});
            }
        } else {
            await unlink(tmpPath).catch(() => {});
            throw err;
        }
    }
}
