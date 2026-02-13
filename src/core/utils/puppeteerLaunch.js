/**
 * Puppeteer 启动封装
 */

import { config as dotenvConfig } from 'dotenv';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import { existsSync, mkdirSync } from 'fs';
import puppeteer from 'puppeteer';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const envPath = join(__dirname, '..', '..', '..', '.env');
if (existsSync(envPath)) {
    dotenvConfig({ path: envPath });
}

function getEnvString(env, key) {
    const val = env[key];
    if (val == null) return '';
    return String(val).trim();
}

function getEnvBool(env, key, defaultValue = false) {
    const raw = getEnvString(env, key);
    if (!raw) return defaultValue;
    return ['1', 'true', 'yes', 'y', 'on'].includes(raw.toLowerCase());
}

function uniqArgs(args) {
    const seen = new Set();
    const result = [];
    for (const arg of args) {
        if (!arg) continue;
        if (seen.has(arg)) continue;
        seen.add(arg);
        result.push(arg);
    }
    return result;
}

function ensureDir(dirPath) {
    if (!dirPath) return;
    try {
        mkdirSync(dirPath, { recursive: true });
    } catch {
        // 让 Chrome 报更准的错误
    }
}

function readLaunchEnv({ env, platform }) {
    return {
        executablePath: getEnvString(env, 'CHART_PUPPETEER_EXECUTABLE_PATH') || getEnvString(env, 'PUPPETEER_EXECUTABLE_PATH'),
        channel: getEnvString(env, 'CHART_PUPPETEER_CHANNEL') || getEnvString(env, 'PUPPETEER_CHANNEL'),
        userDataDir: getEnvString(env, 'CHART_PUPPETEER_USER_DATA_DIR') || getEnvString(env, 'PUPPETEER_USER_DATA_DIR'),
        dumpio: getEnvBool(env, 'CHART_PUPPETEER_DUMPIO', false),
        forceNoSandbox: getEnvBool(env, 'CHART_PUPPETEER_NO_SANDBOX', false) || getEnvBool(env, 'PUPPETEER_NO_SANDBOX', false),
        disableCrashReporter:
            getEnvBool(env, 'CHART_PUPPETEER_DISABLE_CRASH_REPORTER', platform === 'darwin') ||
            getEnvBool(env, 'PUPPETEER_DISABLE_CRASH_REPORTER', platform === 'darwin'),
    };
}

function shouldDisableSandbox({ platform, forceNoSandbox }) {
    if (platform !== 'linux') return false;
    if (forceNoSandbox) return true;
    if (typeof process.getuid !== 'function') return false;
    return process.getuid() === 0;
}

function buildChromiumArgs({ platform, disableSandbox, disableCrashReporter, extraArgs }) {
    const args = [];

    if (disableSandbox) args.push('--no-sandbox', '--disable-setuid-sandbox');
    if (disableCrashReporter) args.push('--disable-crash-reporter', '--disable-breakpad');
    if (platform === 'darwin') args.push('--use-mock-keychain');

    args.push('--no-first-run', '--no-default-browser-check');
    args.push(...extraArgs);

    return uniqArgs(args);
}

export function buildPuppeteerLaunchOptions({
    headless = 'new',
    extraArgs = [],
} = {}) {
    const platform = process.platform;
    const env = readLaunchEnv({ env: process.env, platform });
    const disableSandbox = shouldDisableSandbox({ platform, forceNoSandbox: env.forceNoSandbox });
    const args = buildChromiumArgs({
        platform,
        disableSandbox,
        disableCrashReporter: env.disableCrashReporter,
        extraArgs,
    });

    if (env.userDataDir) ensureDir(env.userDataDir);

    const options = {
        headless,
        args,
        dumpio: env.dumpio,
    };

    if (env.userDataDir) options.userDataDir = env.userDataDir;
    if (env.executablePath) options.executablePath = env.executablePath;
    if (env.channel) options.channel = env.channel;

    return options;
}

function buildLaunchHint({ purpose, options }) {
    const lines = [];
    lines.push(`[提示] 运行环境: platform=${process.platform} arch=${process.arch} node=${process.version}`);
    lines.push(`[提示] 目标: ${purpose}`);
    if (options?.executablePath) lines.push(`[提示] executablePath: ${options.executablePath}`);
    if (options?.channel) lines.push(`[提示] channel: ${options.channel}`);
    lines.push('[排查] 1) 重新构建依赖: pnpm rebuild puppeteer');
    lines.push('[排查] 2) 清理浏览器缓存后重试: rm -rf ~/.cache/puppeteer ~/Library/Caches/puppeteer');
    lines.push('[排查] 3) macOS 优先用系统 Chrome: 设置 CHART_PUPPETEER_CHANNEL=chrome');
    lines.push('[排查] 4) Apple Silicon 尽量使用 arm64 Node（避免下载 x64 Chrome 走 Rosetta）');
    return lines.join('\n');
}

export async function launchPuppeteerBrowser({
    logger = null,
    purpose = 'generic',
    headless = 'new',
    extraArgs = [],
    puppeteerImpl = puppeteer,
} = {}) {
    const log = logger ?? console;
    const options = buildPuppeteerLaunchOptions({ headless, extraArgs });
    const sanitizedOptions = { ...options };

    try {
        return await puppeteerImpl.launch(sanitizedOptions);
    } catch (err) {
        const hasOverride = Boolean(sanitizedOptions.executablePath) || Boolean(sanitizedOptions.channel);

        // macOS：优先试系统 Chrome，少踩 Chrome for Testing/Crashpad 坑
        if (process.platform === 'darwin' && !hasOverride) {
            try {
                log?.warn?.(`[Puppeteer] 启动失败(${purpose})，尝试使用系统 Chrome(channel=chrome) 作为回退...`);
                return await puppeteerImpl.launch({ ...sanitizedOptions, channel: 'chrome' });
            } catch (fallbackErr) {
                const hint = buildLaunchHint({ purpose, options: sanitizedOptions });
                const wrapped = new Error(
                    `Puppeteer 启动浏览器失败（已尝试回退到系统 Chrome）: ${fallbackErr?.message || String(fallbackErr)}\n${hint}`,
                );
                wrapped.cause = fallbackErr;
                throw wrapped;
            }
        }

        const hint = buildLaunchHint({ purpose, options: sanitizedOptions });
        const wrapped = new Error(`Puppeteer 启动浏览器失败: ${err?.message || String(err)}\n${hint}`);
        wrapped.cause = err;
        throw wrapped;
    }
}
