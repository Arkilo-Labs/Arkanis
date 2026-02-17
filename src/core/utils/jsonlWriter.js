import path from 'node:path';
import { appendFile, mkdir } from 'node:fs/promises';

export async function appendJsonlLine(filePath, value) {
    const json = JSON.stringify(value);
    if (typeof json !== 'string') throw new Error('JSON 序列化失败，无法写入 JSONL');

    await mkdir(path.dirname(filePath), { recursive: true });
    await appendFile(filePath, `${json}\n`, { encoding: 'utf-8' });
}

