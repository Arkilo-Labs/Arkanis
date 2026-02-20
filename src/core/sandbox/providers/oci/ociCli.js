import { spawn } from 'node:child_process';

import { limitBytes } from '../../utils/fileSizeLimiter.js';
import { nowIso, durationMs } from '../../utils/clock.js';

const DEFAULT_MAX_STDOUT_BYTES = 4 * 1024 * 1024; // 4 MiB
const DEFAULT_MAX_STDERR_BYTES = 1 * 1024 * 1024; // 1 MiB
const PROBE_TIMEOUT_MS = 5_000;

/**
 * 检测指定可执行文件是否存在于 PATH（带超时保护，防止 `--version` 挂住）。
 * @param {string} name
 * @returns {Promise<boolean>}
 */
export async function probeExecutable(name) {
    return new Promise((resolve) => {
        let settled = false;

        function settle(value) {
            if (settled) return;
            settled = true;
            clearTimeout(timer);
            resolve(value);
        }

        const child = spawn(name, ['--version'], { stdio: 'ignore' });
        child.on('error', () => settle(false));
        child.on('close', () => settle(true));

        // 防止 --version 挂住（某些二进制等待 stdin）
        const timer = setTimeout(() => {
            try {
                child.kill('SIGKILL');
            } catch {
                // 已退出
            }
            settle(false);
        }, PROBE_TIMEOUT_MS);
    });
}

/**
 * 运行 engine CLI 命令，统一处理超时、stdout/stderr 截断。
 * 超时时发送 SIGKILL 并在结果中标记 timed_out=true；由上层（OciProvider）将其转换为标准错误码。
 *
 * @param {string} engine - 'docker' | 'podman' 或任意可执行文件
 * @param {string[]} args
 * @param {object} opts
 * @param {number} [opts.timeout_ms]        0 或缺省表示不设超时
 * @param {number} [opts.max_stdout_bytes]
 * @param {number} [opts.max_stderr_bytes]
 * @returns {Promise<OciCliResult>}
 */
export async function runOciCommand(engine, args, opts = {}) {
    const timeoutMs = opts.timeout_ms ?? 0;
    const maxStdout = opts.max_stdout_bytes ?? DEFAULT_MAX_STDOUT_BYTES;
    const maxStderr = opts.max_stderr_bytes ?? DEFAULT_MAX_STDERR_BYTES;

    const startedAt = nowIso();

    const child = spawn(engine, args, { stdio: ['ignore', 'pipe', 'pipe'] });

    const stdoutChunks = [];
    const stderrChunks = [];

    child.stdout.on('data', (chunk) => stdoutChunks.push(chunk));
    child.stderr.on('data', (chunk) => stderrChunks.push(chunk));

    let timedOut = false;
    let timer = null;

    const exitPromise = new Promise((resolve, reject) => {
        child.on('error', reject);
        child.on('close', (code, signal) => resolve({ code, signal }));
    });

    if (timeoutMs > 0) {
        timer = setTimeout(() => {
            timedOut = true;
            try {
                child.kill('SIGKILL');
            } catch {
                // 进程可能已退出
            }
        }, timeoutMs);
    }

    let exitCode = null;
    let exitSignal = null;
    let spawnError = null;

    try {
        const result = await exitPromise;
        exitCode = result.code;
        exitSignal = result.signal ?? null;
    } catch (err) {
        spawnError = err;
    } finally {
        if (timer) clearTimeout(timer);
    }

    const endedAt = nowIso();
    const rawStdout = Buffer.concat(stdoutChunks);
    const rawStderr = Buffer.concat(stderrChunks);

    const stdoutLimited = limitBytes(rawStdout, maxStdout);
    const stderrLimited = limitBytes(rawStderr, maxStderr);

    return {
        startedAt,
        endedAt,
        duration_ms: durationMs(startedAt, endedAt),
        timed_out: timedOut,
        exit_code: exitCode,
        signal: exitSignal,
        stdout: stdoutLimited.text,
        stderr: stderrLimited.text,
        stdout_bytes: stdoutLimited.bytes,
        stderr_bytes: stderrLimited.bytes,
        stdout_truncated: stdoutLimited.truncated,
        stderr_truncated: stderrLimited.truncated,
        stdout_max_bytes: maxStdout,
        stderr_max_bytes: maxStderr,
        spawnError,
    };
}
