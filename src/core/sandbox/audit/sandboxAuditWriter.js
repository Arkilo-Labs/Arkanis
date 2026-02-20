import { writeFile, appendFile, mkdir } from 'node:fs/promises';
import path from 'node:path';

import { appendJsonlLine } from '../../utils/jsonlWriter.js';
import { sandboxAuditPaths } from '../utils/paths.js';

async function ensureDir(dir) {
    await mkdir(dir, { recursive: true });
}

/**
 * 写 commands.jsonl 单行审计记录。
 *
 * @param {string} runDir
 * @param {string} sandboxId
 * @param {object} record  AuditCommandRecord
 */
export async function writeCommandRecord(runDir, sandboxId, record) {
    const paths = sandboxAuditPaths(runDir, sandboxId);
    await appendJsonlLine(paths.commandsJsonl, record);
}

/**
 * 把 stdout/stderr 追加写入到 sandbox 目录下的 .log 文件。
 */
export async function writeOutputLogs(runDir, sandboxId, { stdout, stderr }) {
    const paths = sandboxAuditPaths(runDir, sandboxId);
    await ensureDir(paths.dir);

    await Promise.all([
        appendFile(paths.stdoutLog, stdout ?? '', 'utf-8'),
        appendFile(paths.stderrLog, stderr ?? '', 'utf-8'),
    ]);
}

/**
 * 写 env_fingerprint.json（覆盖写，最后一次 exec 的 snapshot 为准）。
 *
 * @param {string} runDir
 * @param {string} sandboxId
 * @param {object} snapshot  SandboxSnapshot
 */
export async function writeEnvFingerprint(runDir, sandboxId, snapshot) {
    const paths = sandboxAuditPaths(runDir, sandboxId);
    await ensureDir(paths.dir);
    await writeFile(paths.envFingerprintJson, JSON.stringify(snapshot, null, 2), 'utf-8');
}
