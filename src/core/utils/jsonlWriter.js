import path from 'node:path';
import { appendFile, mkdir } from 'node:fs/promises';

function stringifyJson(value) {
    try {
        const json = JSON.stringify(value);
        if (typeof json !== 'string') throw new Error('JSON 序列化失败，无法写入 JSONL');
        return json;
    } catch (err) {
        const e = new Error('JSON 序列化失败，无法写入 JSONL');
        e.cause = err;
        throw e;
    }
}

export async function appendJsonlLine(filePath, value) {
    const json = stringifyJson(value);

    await mkdir(path.dirname(filePath), { recursive: true });
    await appendFile(filePath, `${json}\n`, { encoding: 'utf-8' });
}
