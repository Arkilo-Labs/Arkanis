import { readFileSync } from 'fs';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';

import { resolveDataDir } from '../utils/dataDir.js';
import { readSecrets } from '../services/secretsStore.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

export const PROJECT_ROOT = join(__dirname, '..', '..', '..');
export const DATA_DIR = resolveDataDir({ projectRoot: PROJECT_ROOT });

let secretsCache = null;
let secretsCacheTime = 0;

export async function readSecretsCached() {
    const now = Date.now();
    if (secretsCache && now - secretsCacheTime < 3000) return secretsCache;
    const secrets = await readSecrets({ dataDir: DATA_DIR, encKey: process.env.SECRETS_ENC_KEY || '' });
    secretsCache = secrets;
    secretsCacheTime = now;
    return secrets;
}

export function normalizeBaseUrl(baseUrl) {
    let base = String(baseUrl || '').trim();
    base = base.replace(/\/+$/, '');
    if (base.toLowerCase().endsWith('/v1')) base = base.slice(0, -3);
    return base.replace(/\/+$/, '');
}

export function getApiKeyFromEnv(envName) {
    const name = String(envName || '').trim();
    if (!name) return null;
    const value = String(process.env[name] || '').trim();
    return value || null;
}

/**
 * 按优先级（ENV > secrets）解析 API Key，未配置则抛错
 */
export async function resolveApiKey({ providerId, apiKeyEnv }) {
    const envKey = getApiKeyFromEnv(apiKeyEnv);
    const secrets = envKey ? null : await readSecretsCached();
    const secretKey = secrets?.providers?.[providerId]?.apiKey;
    const apiKey = envKey || (typeof secretKey === 'string' ? secretKey.trim() : '');
    if (!apiKey) {
        if (apiKeyEnv) {
            throw new Error(
                `Provider 未配置密钥: ${providerId}（请在 Web 控制台「模型」页设置密钥，或设置环境变量 ${apiKeyEnv}）`,
            );
        }
        throw new Error(`Provider 未配置密钥: ${providerId}（请在 Web 控制台「模型」页设置密钥）`);
    }
    return apiKey;
}

const SUPPORTED_MIMES = ['image/png', 'image/jpeg', 'image/webp', 'image/gif'];

function detectMimeFromBuffer(buf) {
    if (buf[0] === 0x89 && buf[1] === 0x50 && buf[2] === 0x4e && buf[3] === 0x47) return 'image/png';
    if (buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) return 'image/jpeg';
    if (buf.length > 11 &&
        buf[0] === 0x52 && buf[1] === 0x49 && buf[2] === 0x46 && buf[3] === 0x46 &&
        buf[8] === 0x57 && buf[9] === 0x45 && buf[10] === 0x42 && buf[11] === 0x50) return 'image/webp';
    if (buf[0] === 0x47 && buf[1] === 0x49 && buf[2] === 0x46) return 'image/gif';
    throw new Error(
        `不支持的图片格式（magic bytes: ${buf.slice(0, 4).toString('hex')}）；支持格式：${SUPPORTED_MIMES.join(', ')}`,
    );
}

export function imageToDataUrl(imagePath) {
    const buf = readFileSync(imagePath);
    return `data:${detectMimeFromBuffer(buf)};base64,${buf.toString('base64')}`;
}

/**
 * 返回 { base64, mimeType }，供需要分开传的协议（如 Anthropic）使用
 */
export function imageToBase64WithMime(imagePath) {
    const buf = readFileSync(imagePath);
    return { base64: buf.toString('base64'), mimeType: detectMimeFromBuffer(buf) };
}
