import path from 'node:path';

/**
 * 给定 runDir 与 sandboxId，返回 sandbox 审计文件的绝对路径。
 * 与 runPaths.js 保持一致的路径约定。
 */
export function sandboxAuditPaths(runDir, sandboxId) {
    const dir = path.join(runDir, 'sandbox', sandboxId);
    return {
        dir,
        commandsJsonl: path.join(dir, 'commands.jsonl'),
        stdoutLog: path.join(dir, 'stdout.log'),
        stderrLog: path.join(dir, 'stderr.log'),
        envFingerprintJson: path.join(dir, 'env_fingerprint.json'),
        networkJsonl: path.join(dir, 'network.jsonl'),
        handleJson: path.join(dir, 'handle.json'),
    };
}
