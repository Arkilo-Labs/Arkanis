import { writeFile, mkdir } from 'node:fs/promises';
import path from 'node:path';

import { nowIso } from '../../../../core/sandbox/utils/clock.js';

/**
 * 写入 run 级别的 index.json。
 * 在每次 run 开始时调用一次，后续可由调用方追加更新。
 *
 * @param {import('./runPaths.js').RunPaths} runPaths
 * @param {object} [extra]  可选附加字段（sandbox/tools/skills 摘要等）
 */
export async function writeRunIndex(runPaths, extra = {}) {
    await mkdir(runPaths.runDir, { recursive: true });

    const index = {
        version: 1,
        run_id: runPaths.runId,
        created_at: nowIso(),
        ...extra,
    };

    await writeFile(runPaths.indexJsonPath, JSON.stringify(index, null, 2), 'utf-8');
}
