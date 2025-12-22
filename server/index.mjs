import express from 'express';
import { createServer } from 'http';
import { Server } from 'socket.io';
import cors from 'cors';
import { spawn } from 'child_process';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';
import { readFile, writeFile } from 'fs/promises';
import { existsSync } from 'fs';
import bodyParser from 'body-parser';
import chokidar from 'chokidar';
import { config as dotenvConfig } from 'dotenv';
import PromptManager from '../src/vlm/promptManager.js';
import { z } from 'zod';
import { queryCore, withCoreConnection } from '../src/data/index.js';
import { hashPassword, verifyPassword } from '../src/services/auth/password.js';
import { generateSessionToken, tokenToHash } from '../src/services/auth/session.js';
import { sendEmailVerification, verifyEmailByToken } from '../src/services/auth/emailVerificationService.js';
import { getPrimaryOrganizationForUserId } from '../src/data/orgRepository.js';
import { listActivationCodes, revokeActivationCodeById } from '../src/data/activationCodeRepository.js';
import {
    createActivationCodes,
    getCurrentSubscriptionForOrganizationId,
    redeemActivationCode,
} from '../src/services/billing/activationCodeService.js';
import {
    getOrganizationProviderSecretEncrypted,
    getOrganizationSelectedProviderId,
    getProviderDefinitionById,
    insertProviderDefinition,
    listActiveProviderDefinitions,
    listAllProviderDefinitions,
    updateProviderDefinitionById,
    upsertOrganizationProviderSecretEncrypted,
    upsertOrganizationSelectedProvider,
    hasOrganizationProviderSecret,
} from '../src/data/aiProviderRepository.js';
import { getCreditStatus, chargeCredits } from '../src/services/billing/aiCreditService.js';
import { unitsToCredits } from '../src/services/billing/credits.js';
import {
    createEmbeddedStripeSubscription,
    createStripeCheckoutSession,
    completeStripeCheckoutSession,
    getStripePublicConfig,
    handleStripeWebhook,
    syncStripeSubscriptionForOrganization,
} from '../src/services/billing/stripe/stripeService.js';
import {
    buildBinanceUrl,
    buildDecisionMessageHtml,
    buildTradingViewUrl,
    TelegramClient,
} from '../src/services/telegram/index.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const PROJECT_ROOT = join(__dirname, '..');

dotenvConfig({ path: join(PROJECT_ROOT, '.env') });

const app = express();
const httpServer = createServer(app);
const io = new Server(httpServer, {
    cors: {
        origin: "*",
        methods: ["GET", "POST"]
    }
});

app.use(cors());

// Stripe webhook 必须在 json parser 之前注册，否则签名校验会失败
app.post('/api/stripe/webhook', bodyParser.raw({ type: 'application/json' }), async (req, res) => {
    try {
        const sig = String(req.headers['stripe-signature'] || '').trim();
        await handleStripeWebhook({ rawBody: req.body, signature: sig, env: process.env });
        res.json({ received: true });
    } catch (e) {
        const msg = e?.message || String(e);
        console.error('[stripe:webhook] error:', msg);
        res.status(400).send(`Webhook Error: ${msg}`);
    }
});

app.use(bodyParser.json());

// Serve static files from 'outputs' directory
app.use('/outputs', express.static(join(PROJECT_ROOT, 'outputs')));
app.use('/verify-test', express.static(join(PROJECT_ROOT, 'web_verify_test')));

// Store active processes and session data
const activeProcesses = new Map();
const sessionChartData = new Map();
const sessionOwners = new Map(); // sessionId -> { userId, createdAt }
const sessionWriteTokens = new Map(); // sessionId -> writeToken
const saasProcesses = new Map(); // pid -> { userId, sessionId }

function getBearerToken(req) {
    const header = String(req.headers.authorization || '').trim();
    if (header.toLowerCase().startsWith('bearer ')) return header.slice(7).trim();
    const fromHeader = String(req.headers['x-session-token'] || '').trim();
    return fromHeader || '';
}

async function getAuthedUser(req) {
    const token = getBearerToken(req);
    if (!token) return null;

    const tokenHash = tokenToHash(token);
    const sql = `
      SELECT u.id, u.email, u.display_name, u.status, u.email_verified_at
      FROM user_sessions s
      JOIN users u ON u.id = s.user_id
      WHERE s.refresh_token_hash = $1
        AND s.revoked_at IS NULL
        AND s.expires_at > now()
      LIMIT 1
    `;
    const res = await queryCore(sql, [tokenHash]);
    if (!res.rowCount) return null;
    return res.rows[0];
}

async function getAuthedUserFromToken(token) {
    const value = String(token || '').trim();
    if (!value) return null;

    const tokenHash = tokenToHash(value);
    const sql = `
      SELECT u.id, u.email, u.display_name, u.status, u.email_verified_at
      FROM user_sessions s
      JOIN users u ON u.id = s.user_id
      WHERE s.refresh_token_hash = $1
        AND s.revoked_at IS NULL
        AND s.expires_at > now()
      LIMIT 1
    `;
    const res = await queryCore(sql, [tokenHash]);
    if (!res.rowCount) return null;
    return res.rows[0];
}

function getClientIp(req) {
    const forwarded = String(req.headers['x-forwarded-for'] || '').split(',')[0].trim();
    if (forwarded) return forwarded;
    return req.socket?.remoteAddress || null;
}

function parseAdminEmailSet() {
    const raw = String(process.env.ARKILO_ADMIN_EMAILS || '')
        .split(',')
        .map((s) => s.trim().toLowerCase())
        .filter(Boolean);
    return new Set(raw);
}

function isAdminUser(user) {
    if (!user?.email) return false;
    const admins = parseAdminEmailSet();
    if (!admins.size) return false;
    return admins.has(String(user.email).trim().toLowerCase());
}

async function requireAuth(req, res) {
    const user = await getAuthedUser(req);
    if (!user) {
        res.status(401).json({ error: '未登录' });
        return null;
    }
    return user;
}

async function requireAdmin(req, res) {
    const user = await requireAuth(req, res);
    if (!user) return null;
    if (!isAdminUser(user)) {
        res.status(403).json({ error: '无权限' });
        return null;
    }
    return user;
}

function isSubscriptionActive(subscription) {
    if (!subscription) return false;
    if (subscription.status !== 'active') return false;
    if (!subscription.current_period_end) return false;
    const end = new Date(subscription.current_period_end).getTime();
    return Number.isFinite(end) && end > Date.now();
}

function getPublicAppUrl(req) {
    const fromEnv = String(process.env.APP_PUBLIC_URL || '').trim();
    if (fromEnv) return fromEnv;

    const origin = String(req.headers.origin || '').trim();
    if (/^https?:\/\//i.test(origin)) return origin;
    return '';
}

async function requireActiveSubscription(req, res) {
    const user = await requireAuth(req, res);
    if (!user) return null;

    if (!user.email_verified_at) {
        res.status(403).json({ error: '请先验证邮箱' });
        return null;
    }

    const organization = await getPrimaryOrganizationForUserId(user.id);
    if (!organization) {
        res.status(404).json({ error: '未找到组织' });
        return null;
    }

    const subscription = await getCurrentSubscriptionForOrganizationId(organization.id);
    if (!isSubscriptionActive(subscription)) {
        res.status(402).json({ error: '订阅未激活' });
        return null;
    }

    return { user, organization, subscription };
}

function getProviderSecretKey() {
    return String(process.env.PROVIDER_SECRET || '').trim();
}

async function decryptApiKeyFromDb(client, encrypted) {
    const secret = getProviderSecretKey();
    if (!secret) throw new Error('缺少 PROVIDER_SECRET，无法解密 apiKey');
    const res = await client.query('SELECT pgp_sym_decrypt($1::bytea, $2)::text AS api_key', [encrypted, secret]);
    return String(res.rows?.[0]?.api_key || '');
}

async function encryptApiKeyForDb(client, apiKey) {
    const secret = getProviderSecretKey();
    if (!secret) throw new Error('缺少 PROVIDER_SECRET，无法保存 apiKey');
    const res = await client.query('SELECT pgp_sym_encrypt($1::text, $2)::bytea AS api_key_enc', [apiKey, secret]);
    return res.rows?.[0]?.api_key_enc;
}

io.on('connection', (socket) => {
    console.log('Client connected:', socket.id);

    socket.on('disconnect', () => {
        console.log('Client disconnected:', socket.id);
    });

    socket.on('kill-process', (pid) => {
        if (activeProcesses.has(pid)) {
            const child = activeProcesses.get(pid);
            child.kill();
            activeProcesses.delete(pid);
            socket.emit('process-killed', pid);
            console.log(`Killed process ${pid}`);
        }
    });
});

const saasIo = io.of('/saas');

saasIo.use(async (socket, next) => {
    try {
        const token =
            socket.handshake.auth?.token ||
            String(socket.handshake.headers?.authorization || '').replace(/^bearer\s+/i, '') ||
            '';
        const user = await getAuthedUserFromToken(token);
        if (!user) return next(new Error('未登录'));
        socket.data.user = user;
        return next();
    } catch (e) {
        return next(new Error(e?.message || '鉴权失败'));
    }
});

saasIo.on('connection', (socket) => {
    const user = socket.data.user;
    socket.join(`user:${user.id}`);

    socket.on('disconnect', () => { });

    socket.on('kill-process', (pid) => {
        const meta = saasProcesses.get(pid);
        if (!meta || meta.userId !== user.id) return;
        const child = activeProcesses.get(pid);
        if (child) child.kill();
        activeProcesses.delete(pid);
        saasProcesses.delete(pid);
        socket.emit('process-killed', pid);
    });
});

app.post('/api/run-script', (req, res) => {
    const { script, args } = req.body;
    if (!['main', 'backtest'].includes(script)) {
        return res.status(400).json({ error: 'Invalid script name' });
    }

    const scriptPath = join(PROJECT_ROOT, 'scripts', `${script}.js`);
    const cmdArgs = [scriptPath, ...(args || [])];

    console.log(`Spawning: node ${cmdArgs.join(' ')}`);

    try {
        const child = spawn(process.execPath, cmdArgs, {
            cwd: PROJECT_ROOT,
            env: { ...process.env, FORCE_COLOR: '1' },
            stdio: ['ignore', 'pipe', 'pipe']
        });

        const pid = child.pid;
        if (pid) {
            activeProcesses.set(pid, child);
        }

        // Stream logs
        child.stdout.on('data', (data) => {
            const str = data.toString();
            console.log(`[STDOUT] ${str.substring(0, 100)}`);
            io.emit('log', { type: 'stdout', data: str });
        });

        child.stderr.on('data', (data) => {
            const str = data.toString();
            console.log(`[STDERR] ${str}`);
            io.emit('log', { type: 'stderr', data: str });
        });

        child.on('close', (code) => {
            console.log(`Process exited with code ${code}`);
            io.emit('process-exit', { code, pid });
            if (pid) activeProcesses.delete(pid);
        });

        child.on('error', (err) => {
            console.error('Failed to start process.', err);
            io.emit('log', { type: 'error', data: `Failed to start process: ${err.message}` });
        });

        res.json({ pid });
    } catch (error) {
        console.error('Spawn error:', error);
        res.status(500).json({ error: error.message });
    }
});

// SaaS: 受控执行（需要登录 + 订阅）
app.post('/api/saas/run-script', async (req, res) => {
    const schema = z.object({
        script: z.enum(['main', 'backtest']),
        args: z.array(z.string()).max(200).default([]),
        sessionId: z.string().trim().min(8).max(200),
    });

    try {
        const ctx = await requireActiveSubscription(req, res);
        if (!ctx) return;

        const input = schema.parse(req.body || {});

        const organizationId = ctx.organization.id;
        const userId = ctx.user.id;

        const selectedProviderId = await withCoreConnection((client) =>
            getOrganizationSelectedProviderId(client, organizationId)
        );
        if (!selectedProviderId) return res.status(400).json({ error: '未选择 AI Provider' });

        const providerDefinition = await withCoreConnection((client) =>
            getProviderDefinitionById(client, selectedProviderId)
        );
        if (!providerDefinition || !providerDefinition.is_active) {
            return res.status(400).json({ error: 'AI Provider 不可用' });
        }

        const hasKey = await withCoreConnection((client) =>
            hasOrganizationProviderSecret(client, { organizationId, providerDefinitionId: selectedProviderId })
        );
        if (!hasKey) return res.status(400).json({ error: '未设置该 Provider 的 apiKey' });

        // 预扣费：每次策略分析按 1.00 credit 计，再乘以倍率
        const creditCharge = await chargeCredits({
            subscription: ctx.subscription,
            organizationId,
            userId,
            providerDefinitionId: selectedProviderId,
            multiplierX100: Number(providerDefinition.multiplier_x100) || 100,
            baseUnits: 100,
            reason: `run:${input.script}`,
            meta: { sessionId: input.sessionId, script: input.script },
        });

        const scriptPath = join(PROJECT_ROOT, 'scripts', `${input.script}.js`);
        const cmdArgs = [scriptPath, ...(input.args || [])];

        // 强制使用服务端 sessionId，避免前端乱传导致越权取图
        if (!cmdArgs.includes('--session-id')) {
            cmdArgs.push('--session-id', input.sessionId);
        }

        const writeToken = generateSessionToken();
        sessionOwners.set(input.sessionId, { userId: ctx.user.id, createdAt: Date.now() });
        sessionWriteTokens.set(input.sessionId, writeToken);

        const encrypted = await withCoreConnection((client) =>
            getOrganizationProviderSecretEncrypted(client, { organizationId, providerDefinitionId: selectedProviderId })
        );
        const apiKey = await withCoreConnection((client) => decryptApiKeyFromDb(client, encrypted));

        const providerOverride = {
            providers: [
                {
                    id: providerDefinition.id,
                    isActive: true,
                    apiKey,
                    baseUrl: providerDefinition.base_url,
                    modelName: providerDefinition.model_name,
                    thinkingMode: providerDefinition.thinking_mode,
                    maxTokens: providerDefinition.max_tokens,
                    temperature: Number(providerDefinition.temperature_x100 || 20) / 100,
                },
            ],
            version: 1,
        };

        const child = spawn(process.execPath, cmdArgs, {
            cwd: PROJECT_ROOT,
            env: {
                ...process.env,
                FORCE_COLOR: '1',
                CHART_WRITE_TOKEN: writeToken,
                ARKILO_PROVIDER_OVERRIDE_JSON: JSON.stringify(providerOverride),
            },
            stdio: ['ignore', 'pipe', 'pipe'],
        });

        const pid = child.pid;
        if (pid) {
            activeProcesses.set(pid, child);
            saasProcesses.set(pid, { userId: ctx.user.id, sessionId: input.sessionId });
        }

        const room = `user:${ctx.user.id}`;
        child.stdout.on('data', (data) => {
            saasIo.to(room).emit('log', { type: 'stdout', data: data.toString(), sessionId: input.sessionId });
        });
        child.stderr.on('data', (data) => {
            saasIo.to(room).emit('log', { type: 'stderr', data: data.toString(), sessionId: input.sessionId });
        });
        child.on('close', (code) => {
            saasIo.to(room).emit('process-exit', { code, pid, sessionId: input.sessionId });
            if (pid) {
                activeProcesses.delete(pid);
                saasProcesses.delete(pid);
            }
        });
        child.on('error', (err) => {
            saasIo.to(room).emit('log', { type: 'error', data: `Failed to start process: ${err.message}` });
        });

        res.json({
            pid,
            charged: {
                credits: unitsToCredits(creditCharge.chargedUnits),
                remainingCredits: unitsToCredits(creditCharge.remainingUnits),
                nextResetAt: creditCharge.periodEnd,
            },
        });
    } catch (error) {
        if (error?.code === 'INSUFFICIENT_CREDIT') {
            const d = error.details || {};
            return res.status(402).json({
                error: 'credit 不足',
                details: {
                    remainingCredits: unitsToCredits(d.remainingUnits),
                    chargeCredits: unitsToCredits(d.chargeUnits),
                    nextResetAt: d.periodEnd,
                },
            });
        }
        res.status(400).json({ error: error?.message || String(error) });
    }
});

app.get('/api/prompts', (req, res) => {
    try {
        const prompts = PromptManager.listPrompts();
        res.json(prompts);
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// Auth: 注册
app.post('/api/auth/register', async (req, res) => {
    const schema = z.object({
        email: z.string().email().max(320),
        password: z.string().min(8).max(200),
        displayName: z.string().trim().min(1).max(80).optional(),
    });

    try {
        const input = schema.parse(req.body || {});
        const email = input.email.trim();
        const passwordHash = await hashPassword(input.password);

        const token = generateSessionToken();
        const tokenHash = tokenToHash(token);
        const expiresAt = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000);

        const user = await withCoreConnection(async (client) => {
            await client.query('BEGIN');
            try {
                const insertUserSql = `
                  INSERT INTO users (email, password_hash, display_name)
                  VALUES ($1, $2, $3)
                  RETURNING id, email, display_name, status, email_verified_at
                `;
                const u = await client.query(insertUserSql, [email, passwordHash, input.displayName || null]);

                const createOrgSql = `
                  INSERT INTO organizations (name, slug)
                  VALUES ($1, $2)
                  RETURNING id
                `;
                const slugBase = email.split('@')[0].replace(/[^a-zA-Z0-9_-]/g, '').slice(0, 24) || 'user';
                const slug = `${slugBase}-${Date.now().toString(36)}`;
                const org = await client.query(createOrgSql, [`${slugBase} workspace`, slug]);

                const memberSql = `
                  INSERT INTO organization_members (organization_id, user_id, role)
                  VALUES ($1, $2, 'owner')
                `;
                await client.query(memberSql, [org.rows[0].id, u.rows[0].id]);

                const sessionSql = `
                  INSERT INTO user_sessions (user_id, refresh_token_hash, expires_at)
                  VALUES ($1, $2, $3)
                `;
                await client.query(sessionSql, [u.rows[0].id, tokenHash, expiresAt.toISOString()]);

                await client.query('COMMIT');
                return u.rows[0];
            } catch (e) {
                await client.query('ROLLBACK');
                throw e;
            }
        });

        let emailVerification = null;
        try {
            emailVerification = await sendEmailVerification({
                userId: user.id,
                publicUrl: getPublicAppUrl(req),
                logger: console,
            });
        } catch (e) {
            emailVerification = { sent: false, error: e?.message || String(e) };
        }

        res.json({ token, user, emailVerification });
    } catch (error) {
        const msg = error?.message || String(error);
        if (msg.toLowerCase().includes('duplicate key') || msg.toLowerCase().includes('unique')) {
            return res.status(409).json({ error: '该邮箱已注册' });
        }
        res.status(400).json({ error: msg });
    }
});

// Auth: 登录
app.post('/api/auth/login', async (req, res) => {
    const schema = z.object({
        email: z.string().email().max(320),
        password: z.string().min(1).max(200),
    });

    try {
        const input = schema.parse(req.body || {});
        const email = input.email.trim();

        const found = await queryCore(
            'SELECT id, email, password_hash, display_name, status, email_verified_at FROM users WHERE email = $1 LIMIT 1',
            [email]
        );
        if (!found.rowCount) return res.status(401).json({ error: '邮箱或密码错误' });

        const userRow = found.rows[0];
        const ok = await verifyPassword(input.password, userRow.password_hash);
        if (!ok) return res.status(401).json({ error: '邮箱或密码错误' });

        const token = generateSessionToken();
        const tokenHash = tokenToHash(token);
        const expiresAt = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000);

        await queryCore(
            'INSERT INTO user_sessions (user_id, refresh_token_hash, expires_at) VALUES ($1, $2, $3)',
            [userRow.id, tokenHash, expiresAt.toISOString()]
        );

        const user = {
            id: userRow.id,
            email: userRow.email,
            display_name: userRow.display_name,
            status: userRow.status,
            email_verified_at: userRow.email_verified_at,
        };
        res.json({ token, user });
    } catch (error) {
        res.status(400).json({ error: error?.message || String(error) });
    }
});

// Auth: 当前用户
app.get('/api/auth/me', async (req, res) => {
    try {
        const user = await getAuthedUser(req);
        if (!user) return res.status(401).json({ error: '未登录' });
        res.json({ user });
    } catch (error) {
        res.status(500).json({ error: error?.message || String(error) });
    }
});

// Auth: 登出（撤销会话）
app.post('/api/auth/logout', async (req, res) => {
    try {
        const token = getBearerToken(req);
        if (!token) return res.json({ success: true });

        const tokenHash = tokenToHash(token);
        await queryCore('UPDATE user_sessions SET revoked_at = now() WHERE refresh_token_hash = $1', [tokenHash]);
        res.json({ success: true });
    } catch (error) {
        res.status(400).json({ error: error?.message || String(error) });
    }
});

// Auth: 发送邮箱验证邮件
app.post('/api/auth/email-verifications/send', async (req, res) => {
    try {
        const user = await requireAuth(req, res);
        if (!user) return;

        const out = await sendEmailVerification({
            userId: user.id,
            publicUrl: getPublicAppUrl(req),
            logger: console,
        });
        res.json(out);
    } catch (error) {
        res.status(400).json({ error: error?.message || String(error) });
    }
});

// Auth: 校验邮箱验证 token（不要求登录）
app.post('/api/auth/email-verifications/verify', async (req, res) => {
    const schema = z.object({ token: z.string().trim().min(20).max(500) });
    try {
        const input = schema.parse(req.body || {});
        const out = await verifyEmailByToken({ token: input.token });
        res.json(out);
    } catch (error) {
        res.status(400).json({ error: error?.message || String(error) });
    }
});

// Console: 当前用户 + 主组织 + 订阅（用于 SaaS Console）
app.get('/api/console/overview', async (req, res) => {
    try {
        const user = await requireAuth(req, res);
        if (!user) return;

        const organization = await getPrimaryOrganizationForUserId(user.id);
        if (!organization) return res.status(404).json({ error: '未找到组织' });

        const subscription = await getCurrentSubscriptionForOrganizationId(organization.id);
        res.json({ user, organization, subscription });
    } catch (error) {
        res.status(500).json({ error: error?.message || String(error) });
    }
});

// Billing: 当前订阅
app.get('/api/billing/subscription', async (req, res) => {
    try {
        const user = await requireAuth(req, res);
        if (!user) return;

        const organization = await getPrimaryOrganizationForUserId(user.id);
        if (!organization) return res.status(404).json({ error: '未找到组织' });

        const subscription = await getCurrentSubscriptionForOrganizationId(organization.id);
        res.json({ organization, subscription });
    } catch (error) {
        res.status(500).json({ error: error?.message || String(error) });
    }
});

// Stripe: 前端配置（publishableKey + 套餐）
app.get('/api/stripe/config', async (req, res) => {
    try {
        const user = await requireAuth(req, res);
        if (!user) return;
        const cfg = getStripePublicConfig({ env: process.env });
        res.json(cfg);
    } catch (error) {
        res.status(400).json({ error: error?.message || String(error) });
    }
});

// Stripe: 创建订阅（返回 Payment Element 的 client_secret）
app.post('/api/stripe/subscriptions/create', async (req, res) => {
    const schema = z.object({ planCode: z.enum(['monthly', 'quarterly', 'yearly']) });
    try {
        const user = await requireAuth(req, res);
        if (!user) return;
        if (!user.email_verified_at) return res.status(403).json({ error: '请先验证邮箱' });

        const organization = await getPrimaryOrganizationForUserId(user.id);
        if (!organization) return res.status(404).json({ error: '未找到组织' });

        const current = await getCurrentSubscriptionForOrganizationId(organization.id);
        if (isSubscriptionActive(current)) {
            return res.status(409).json({ error: '当前已有有效订阅' });
        }

        const input = schema.parse(req.body || {});
        const out = await createEmbeddedStripeSubscription({
            organizationId: organization.id,
            userId: user.id,
            email: user.email,
            planCode: input.planCode,
            env: process.env,
        });
        res.json(out);
    } catch (error) {
        res.status(400).json({ error: error?.message || String(error) });
    }
});

// Stripe: 创建 Checkout Session（跳转到 Stripe 托管页面）
app.post('/api/stripe/checkout/create', async (req, res) => {
    const schema = z.object({ planCode: z.enum(['monthly', 'quarterly', 'yearly']) });
    try {
        const user = await requireAuth(req, res);
        if (!user) return;
        if (!user.email_verified_at) return res.status(403).json({ error: '请先验证邮箱' });

        const organization = await getPrimaryOrganizationForUserId(user.id);
        if (!organization) return res.status(404).json({ error: '未找到组织' });

        const current = await getCurrentSubscriptionForOrganizationId(organization.id);
        if (isSubscriptionActive(current)) return res.status(409).json({ error: '当前已有有效订阅' });

        const input = schema.parse(req.body || {});
        const url = getPublicAppUrl(req);
        const out = await createStripeCheckoutSession({
            organizationId: organization.id,
            email: user.email,
            planCode: input.planCode,
            publicUrl: url,
            env: process.env,
        });
        res.json(out);
    } catch (error) {
        res.status(400).json({ error: error?.message || String(error) });
    }
});

// Stripe: 回跳后用 session_id 完成订阅落库（无需等 webhook）
app.post('/api/stripe/checkout/complete', async (req, res) => {
    const schema = z.object({ sessionId: z.string().trim().min(10).max(200) });
    try {
        const user = await requireAuth(req, res);
        if (!user) return;

        const organization = await getPrimaryOrganizationForUserId(user.id);
        if (!organization) return res.status(404).json({ error: '未找到组织' });

        const input = schema.parse(req.body || {});
        const out = await completeStripeCheckoutSession({
            organizationId: organization.id,
            sessionId: input.sessionId,
            env: process.env,
        });
        res.json(out);
    } catch (error) {
        res.status(400).json({ error: error?.message || String(error) });
    }
});

// Stripe: 同步订阅状态（用于前端支付后刷新）
app.post('/api/stripe/subscriptions/sync', async (req, res) => {
    try {
        const user = await requireAuth(req, res);
        if (!user) return;

        const organization = await getPrimaryOrganizationForUserId(user.id);
        if (!organization) return res.status(404).json({ error: '未找到组织' });

        const out = await syncStripeSubscriptionForOrganization({ organizationId: organization.id, env: process.env });
        res.json(out);
    } catch (error) {
        res.status(400).json({ error: error?.message || String(error) });
    }
});

// Billing: 兑换激活码（落库 + 审计）
app.post('/api/billing/redeem-activation-code', async (req, res) => {
    const schema = z.object({ code: z.string().trim().min(8).max(200) });
    try {
        const user = await requireAuth(req, res);
        if (!user) return;

        const input = schema.parse(req.body || {});
        const result = await redeemActivationCode({
            userId: user.id,
            code: input.code,
            ip: getClientIp(req),
            userAgent: String(req.headers['user-agent'] || '').slice(0, 500) || null,
        });
        res.json(result);
    } catch (error) {
        res.status(400).json({ error: error?.message || String(error) });
    }
});

// Admin: 创建激活码（只返回一次明文）
app.post('/api/admin/activation-codes', async (req, res) => {
    const schema = z.object({
        planCode: z.string().trim().min(1).max(64),
        durationDays: z.number().int().positive().max(3650),
        count: z.number().int().positive().max(100).optional(),
        maxRedemptions: z.number().int().positive().max(1000).optional(),
        expiresAt: z.string().datetime().optional(),
        note: z.string().trim().max(2000).optional(),
    });

    try {
        const admin = await requireAdmin(req, res);
        if (!admin) return;

        const input = schema.parse(req.body || {});
        const expiresAt = input.expiresAt ? new Date(input.expiresAt) : null;
        const codes = await createActivationCodes({
            createdByUserId: admin.id,
            planCode: input.planCode,
            durationDays: input.durationDays,
            count: input.count ?? 1,
            maxRedemptions: input.maxRedemptions ?? 1,
            expiresAt: expiresAt ? expiresAt.toISOString() : null,
            note: input.note ?? null,
        });
        res.json({ codes });
    } catch (error) {
        res.status(400).json({ error: error?.message || String(error) });
    }
});

// Admin: 激活码列表（不返回明文）
app.get('/api/admin/activation-codes', async (req, res) => {
    const schema = z.object({
        limit: z.coerce.number().int().min(1).max(200).optional(),
        offset: z.coerce.number().int().min(0).optional(),
    });

    try {
        const admin = await requireAdmin(req, res);
        if (!admin) return;

        const input = schema.parse(req.query || {});
        const rows = await withCoreConnection(async (client) =>
            listActivationCodes(client, { limit: input.limit ?? 50, offset: input.offset ?? 0 })
        );
        res.json({ items: rows });
    } catch (error) {
        res.status(400).json({ error: error?.message || String(error) });
    }
});

// Admin: 撤销激活码
app.post('/api/admin/activation-codes/:id/revoke', async (req, res) => {
    try {
        const admin = await requireAdmin(req, res);
        if (!admin) return;

        const id = String(req.params.id || '').trim();
        if (!id) return res.status(400).json({ error: '缺少 id' });

        const row = await withCoreConnection(async (client) => revokeActivationCodeById(client, id));
        if (!row) return res.status(404).json({ error: '激活码不存在或已撤销' });
        res.json({ activationCode: row });
    } catch (error) {
        res.status(400).json({ error: error?.message || String(error) });
    }
});

// 获取图表数据
app.get('/api/chart-data/:sessionId', async (req, res) => {
    try {
        const { sessionId } = req.params;
        const data = sessionChartData.get(sessionId);

        if (!data) {
            return res.status(404).json({ error: 'Chart data not found' });
        }

        res.json(data);
    } catch (error) {
        console.error('Get chart data error:', error);
        res.status(500).json({ error: error.message });
    }
});

// 保存图表数据（由脚本调用）
app.post('/api/chart-data', async (req, res) => {
    try {
        const { sessionId, data } = req.body;

        if (!sessionId || !data) {
            return res.status(400).json({ error: 'Missing sessionId or data' });
        }

        const expected = sessionWriteTokens.get(sessionId);
        if (expected) {
            const provided = String(req.headers['x-chart-write-token'] || '').trim();
            if (!provided || provided !== expected) {
                return res.status(401).json({ error: 'Chart write token invalid' });
            }
        }

        sessionChartData.set(sessionId, data);

        // 5分钟后清理数据
        setTimeout(() => {
            sessionChartData.delete(sessionId);
            sessionOwners.delete(sessionId);
            sessionWriteTokens.delete(sessionId);
        }, 5 * 60 * 1000);

        res.json({ success: true });
    } catch (error) {
        console.error('Save chart data error:', error);
        res.status(500).json({ error: error.message });
    }
});

// SaaS: 获取图表数据（需要登录且属于当前用户）
app.get('/api/saas/chart-data/:sessionId', async (req, res) => {
    try {
        const user = await requireAuth(req, res);
        if (!user) return;

        const { sessionId } = req.params;
        const owner = sessionOwners.get(sessionId);
        if (!owner || owner.userId !== user.id) return res.status(404).json({ error: 'Chart data not found' });

        const data = sessionChartData.get(sessionId);
        if (!data) return res.status(404).json({ error: 'Chart data not found' });
        res.json(data);
    } catch (error) {
        res.status(500).json({ error: error?.message || String(error) });
    }
});

// SaaS: AI 状态（订阅 + credit + Provider）
app.get('/api/saas/ai/state', async (req, res) => {
    try {
        const user = await requireAuth(req, res);
        if (!user) return;

        const organization = await getPrimaryOrganizationForUserId(user.id);
        if (!organization) return res.status(404).json({ error: '未找到组织' });

        const subscription = await getCurrentSubscriptionForOrganizationId(organization.id);
        const subscriptionActive = isSubscriptionActive(subscription);

        const organizationId = organization.id;
        const defs = await withCoreConnection((client) => listActiveProviderDefinitions(client));
        const selectedId = await withCoreConnection((client) => getOrganizationSelectedProviderId(client, organizationId));

        const items = await withCoreConnection(async (client) => {
            const out = [];
            for (const d of defs) {
                const hasKey = await hasOrganizationProviderSecret(client, {
                    organizationId,
                    providerDefinitionId: d.id,
                });
                out.push({ ...d, hasKey });
            }
            return out;
        });

        const credit = subscriptionActive
            ? await getCreditStatus({ subscription, organizationId })
            : null;

        res.json({
            organization,
            subscription,
            subscriptionActive,
            credit: credit
                ? {
                    periodStart: credit.periodStart,
                    periodEnd: credit.periodEnd,
                    allowanceCredits: unitsToCredits(credit.allowanceUnits),
                    usedCredits: unitsToCredits(credit.usedUnits),
                    remainingCredits: unitsToCredits(Math.max(0, credit.allowanceUnits - credit.usedUnits)),
                }
                : null,
            providers: {
                selectedId,
                items,
            },
        });
    } catch (error) {
        res.status(500).json({ error: error?.message || String(error) });
    }
});

// SaaS: 选择 Provider
app.post('/api/saas/ai/providers/select', async (req, res) => {
    const schema = z.object({ providerId: z.string().uuid() });
    try {
        const user = await requireAuth(req, res);
        if (!user) return;

        const organization = await getPrimaryOrganizationForUserId(user.id);
        if (!organization) return res.status(404).json({ error: '未找到组织' });

        const input = schema.parse(req.body || {});
        const provider = await withCoreConnection((client) => getProviderDefinitionById(client, input.providerId));
        if (!provider || !provider.is_active) return res.status(400).json({ error: 'Provider 不可用' });

        await withCoreConnection((client) =>
            upsertOrganizationSelectedProvider(client, { organizationId: organization.id, providerDefinitionId: input.providerId })
        );
        res.json({ success: true });
    } catch (error) {
        res.status(400).json({ error: error?.message || String(error) });
    }
});

// SaaS: 设置当前组织的 apiKey（加密存储）
app.post('/api/saas/ai/providers/set-key', async (req, res) => {
    const schema = z.object({ providerId: z.string().uuid(), apiKey: z.string().trim().min(10).max(500) });
    try {
        const admin = await requireAdmin(req, res);
        if (!admin) return;

        const organization = await getPrimaryOrganizationForUserId(admin.id);
        if (!organization) return res.status(404).json({ error: '未找到组织' });

        const input = schema.parse(req.body || {});
        const provider = await withCoreConnection((client) => getProviderDefinitionById(client, input.providerId));
        if (!provider || !provider.is_active) return res.status(400).json({ error: 'Provider 不可用' });

        const encrypted = await withCoreConnection((client) => encryptApiKeyForDb(client, input.apiKey));
        await withCoreConnection((client) =>
            upsertOrganizationProviderSecretEncrypted(client, {
                organizationId: organization.id,
                providerDefinitionId: input.providerId,
                apiKeyEnc: encrypted,
            })
        );
        res.json({ success: true });
    } catch (error) {
        res.status(400).json({ error: error?.message || String(error) });
    }
});

// Admin: Provider 定义列表
app.get('/api/admin/ai-providers', async (req, res) => {
    const schema = z.object({
        limit: z.coerce.number().int().min(1).max(200).optional(),
        offset: z.coerce.number().int().min(0).optional(),
    });
    try {
        const admin = await requireAdmin(req, res);
        if (!admin) return;

        const input = schema.parse(req.query || {});
        const rows = await withCoreConnection((client) => listAllProviderDefinitions(client, { limit: input.limit ?? 100, offset: input.offset ?? 0 }));
        res.json({ items: rows });
    } catch (error) {
        res.status(400).json({ error: error?.message || String(error) });
    }
});

// Admin: 创建 Provider 定义
app.post('/api/admin/ai-providers', async (req, res) => {
    const schema = z.object({
        code: z.string().trim().min(2).max(64),
        displayName: z.string().trim().min(1).max(120),
        baseUrl: z.string().trim().url().optional(),
        modelName: z.string().trim().min(1).max(120),
        thinkingMode: z.enum(['enabled', 'disabled', 'none']).optional(),
        maxTokens: z.number().int().min(256).max(200000).optional(),
        temperature: z.number().min(0).max(2).optional(),
        multiplier: z.number().min(0.01).max(1000).optional(),
        isActive: z.boolean().optional(),
    });
    try {
        const admin = await requireAdmin(req, res);
        if (!admin) return;

        const input = schema.parse(req.body || {});
        const row = await withCoreConnection((client) =>
            insertProviderDefinition(client, {
                code: input.code,
                displayName: input.displayName,
                baseUrl: input.baseUrl || null,
                modelName: input.modelName,
                thinkingMode: input.thinkingMode || 'none',
                maxTokens: input.maxTokens ?? 8192,
                temperatureX100: Math.round((input.temperature ?? 0.2) * 100),
                multiplierX100: Math.round((input.multiplier ?? 1) * 100),
                isActive: input.isActive ?? true,
            })
        );
        res.json({ provider: row });
    } catch (error) {
        const msg = error?.message || String(error);
        if (msg.toLowerCase().includes('duplicate key') || msg.toLowerCase().includes('unique')) {
            return res.status(409).json({ error: 'code 已存在' });
        }
        res.status(400).json({ error: msg });
    }
});

// Admin: 更新 Provider 定义
app.put('/api/admin/ai-providers/:id', async (req, res) => {
    const schema = z.object({
        displayName: z.string().trim().min(1).max(120),
        baseUrl: z.string().trim().url().optional().nullable(),
        modelName: z.string().trim().min(1).max(120),
        thinkingMode: z.enum(['enabled', 'disabled', 'none']).optional(),
        maxTokens: z.number().int().min(256).max(200000).optional(),
        temperature: z.number().min(0).max(2).optional(),
        multiplier: z.number().min(0.01).max(1000).optional(),
        isActive: z.boolean().optional(),
    });
    try {
        const admin = await requireAdmin(req, res);
        if (!admin) return;

        const id = String(req.params.id || '').trim();
        const input = schema.parse(req.body || {});

        const row = await withCoreConnection((client) =>
            updateProviderDefinitionById(client, {
                id,
                displayName: input.displayName,
                baseUrl: input.baseUrl ?? null,
                modelName: input.modelName,
                thinkingMode: input.thinkingMode || 'none',
                maxTokens: input.maxTokens ?? 8192,
                temperatureX100: Math.round((input.temperature ?? 0.2) * 100),
                multiplierX100: Math.round((input.multiplier ?? 1) * 100),
                isActive: input.isActive ?? true,
            })
        );
        if (!row) return res.status(404).json({ error: 'Provider 不存在' });
        res.json({ provider: row });
    } catch (error) {
        res.status(400).json({ error: error?.message || String(error) });
    }
});

// 允许修改的配置项白名单
const ALLOWED_CONFIG_KEYS = [
    'DB_HOST',
    'DB_PORT',
    'DB_USER',
    'DB_PASSWORD',
    'DB_ADMIN_DATABASE',
    'DB_CORE_DATABASE',
    'DB_MARKET_DATABASE',
    'DB_DATABASE',
    'DB_POOL_MIN',
    'DB_POOL_MAX',
    'PROMPT_NAME',
    'CHART_WIDTH', 'CHART_HEIGHT', 'CHART_VOLUME_PANE_HEIGHT',
    'CHART_MACD_PANE_HEIGHT', 'CHART_TREND_STRENGTH_PANE_HEIGHT',
    'LOG_LEVEL',
    'DEFAULT_SYMBOL', 'DEFAULT_TIMEFRAME', 'DEFAULT_BARS',
    'MARKET_EXCHANGE',
    'BINANCE_MARKET'
];

// 配置项分组和描述
const CONFIG_SCHEMA = {
    database: {
        label: 'PostgreSQL 数据库',
        items: [
            'DB_HOST',
            'DB_PORT',
            'DB_USER',
            'DB_PASSWORD',
            'DB_ADMIN_DATABASE',
            'DB_CORE_DATABASE',
            'DB_MARKET_DATABASE',
            'DB_DATABASE',
            'DB_POOL_MIN',
            'DB_POOL_MAX',
        ]
    },
    vlm: {
        label: 'VLM 配置',
        items: ['PROMPT_NAME']
    },
    chart: {
        label: '图表配置',
        items: ['CHART_WIDTH', 'CHART_HEIGHT', 'CHART_VOLUME_PANE_HEIGHT']
    },
    log: {
        label: '日志配置',
        items: ['LOG_LEVEL']
    },
    defaults: {
        label: '默认参数',
        items: ['DEFAULT_SYMBOL', 'DEFAULT_TIMEFRAME', 'DEFAULT_BARS', 'MARKET_EXCHANGE', 'BINANCE_MARKET']
    }
};

// 解析 .env 文件
function parseEnvFile(content) {
    const config = {};
    const lines = content.split('\n');
    for (const line of lines) {
        const trimmed = line.trim();
        // 跳过注释和空行
        if (!trimmed || trimmed.startsWith('//') || trimmed.startsWith('#')) continue;
        const eqIndex = trimmed.indexOf('=');
        if (eqIndex > 0) {
            const key = trimmed.substring(0, eqIndex).trim();
            const value = trimmed.substring(eqIndex + 1).trim();
            if (ALLOWED_CONFIG_KEYS.includes(key)) {
                config[key] = value;
            }
        }
    }
    return config;
}

// 生成 .env 文件内容
function generateEnvContent(config) {
    const lines = ['// VLM Trade JS 环境变量配置', ''];

    for (const [groupKey, group] of Object.entries(CONFIG_SCHEMA)) {
        lines.push(`// ${group.label}`);
        for (const key of group.items) {
            if (config[key] !== undefined) {
                lines.push(`${key}=${config[key]}`);
            }
        }
        lines.push('');
    }

    return lines.join('\n');
}

// 读取配置
app.get('/api/config', async (req, res) => {
    try {
        const envPath = join(PROJECT_ROOT, '.env');
        const content = await readFile(envPath, 'utf-8');
        const config = parseEnvFile(content);
        res.json({ config, schema: CONFIG_SCHEMA });
    } catch (error) {
        console.error('Read config error:', error);
        res.status(500).json({ error: error.message });
    }
});

// 保存配置
app.post('/api/config', async (req, res) => {
    try {
        const { config } = req.body;
        if (!config || typeof config !== 'object') {
            return res.status(400).json({ error: 'Invalid config' });
        }

        // 过滤只保留允许的配置项
        const filteredConfig = {};
        for (const key of ALLOWED_CONFIG_KEYS) {
            if (config[key] !== undefined) {
                filteredConfig[key] = config[key];
            }
        }

        const envPath = join(PROJECT_ROOT, '.env');
        const content = generateEnvContent(filteredConfig);
        await writeFile(envPath, content, 'utf-8');

        res.json({ success: true });
    } catch (error) {
        console.error('Save config error:', error);
        res.status(500).json({ error: error.message });
    }
});

// AI Provider 管理
const PROVIDERS_FILE = join(PROJECT_ROOT, 'ai-providers.json');

function generateProviderId() {
    return `provider_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
}

async function readProviders() {
    try {
        if (!existsSync(PROVIDERS_FILE)) {
            return await initDefaultProvider();
        }
        const content = await readFile(PROVIDERS_FILE, 'utf-8');
        return JSON.parse(content);
    } catch (error) {
        console.error('读取 Provider 文件失败:', error);
        return { providers: [], version: 1 };
    }
}

async function writeProviders(data) {
    try {
        await writeFile(PROVIDERS_FILE, JSON.stringify(data, null, 2), 'utf-8');
        return true;
    } catch (error) {
        console.error('写入 Provider 文件失败:', error);
        return false;
    }
}

async function initDefaultProvider() {
    const data = {
        providers: [],
        version: 1
    };

    await writeProviders(data);
    return data;
}

function validateProvider(provider) {
    const required = ['name', 'baseUrl', 'modelName', 'apiKey'];
    for (const field of required) {
        if (!provider[field] || provider[field].trim() === '') {
            return { valid: false, error: `字段 ${field} 为必填项` };
        }
    }

    if (provider.thinkingMode && !['enabled', 'disabled', 'none'].includes(provider.thinkingMode)) {
        return { valid: false, error: 'thinkingMode 必须是 enabled/disabled/none' };
    }

    return { valid: true };
}

// API: 获取所有 Provider
app.get('/api/ai-providers', async (req, res) => {
    try {
        const data = await readProviders();
        res.json(data.providers);
    } catch (error) {
        console.error('获取 Provider 列表失败:', error);
        res.status(500).json({ error: error.message });
    }
});

// API: 新增 Provider
app.post('/api/ai-providers', async (req, res) => {
    try {
        const provider = req.body;

        const validation = validateProvider(provider);
        if (!validation.valid) {
            return res.status(400).json({ error: validation.error });
        }

        const data = await readProviders();

        provider.id = generateProviderId();
        provider.isActive = provider.isActive || false;

        if (provider.isActive) {
            data.providers.forEach(p => p.isActive = false);
        }

        data.providers.push(provider);

        const success = await writeProviders(data);
        if (success) {
            io.emit('providers-updated');
            res.json(provider);
        } else {
            res.status(500).json({ error: '保存失败' });
        }
    } catch (error) {
        console.error('创建 Provider 失败:', error);
        res.status(500).json({ error: error.message });
    }
});

// API: 更新 Provider
app.put('/api/ai-providers/:id', async (req, res) => {
    try {
        const { id } = req.params;
        const updates = req.body;

        const validation = validateProvider(updates);
        if (!validation.valid) {
            return res.status(400).json({ error: validation.error });
        }

        const data = await readProviders();
        const index = data.providers.findIndex(p => p.id === id);

        if (index === -1) {
            return res.status(404).json({ error: 'Provider 不存在' });
        }

        if (updates.isActive) {
            data.providers.forEach(p => p.isActive = false);
        }

        data.providers[index] = { ...data.providers[index], ...updates, id };

        const success = await writeProviders(data);
        if (success) {
            io.emit('providers-updated');
            res.json(data.providers[index]);
        } else {
            res.status(500).json({ error: '保存失败' });
        }
    } catch (error) {
        console.error('更新 Provider 失败:', error);
        res.status(500).json({ error: error.message });
    }
});

// API: 删除 Provider
app.delete('/api/ai-providers/:id', async (req, res) => {
    try {
        const { id } = req.params;
        const data = await readProviders();

        const index = data.providers.findIndex(p => p.id === id);
        if (index === -1) {
            return res.status(404).json({ error: 'Provider 不存在' });
        }

        const isActive = data.providers[index].isActive;
        data.providers.splice(index, 1);

        if (isActive && data.providers.length > 0) {
            data.providers[0].isActive = true;
        }

        const success = await writeProviders(data);
        if (success) {
            io.emit('providers-updated');
            res.json({ success: true });
        } else {
            res.status(500).json({ error: '保存失败' });
        }
    } catch (error) {
        console.error('删除 Provider 失败:', error);
        res.status(500).json({ error: error.message });
    }
});

// API: 激活 Provider
app.post('/api/ai-providers/:id/activate', async (req, res) => {
    try {
        const { id } = req.params;
        const data = await readProviders();

        const provider = data.providers.find(p => p.id === id);
        if (!provider) {
            return res.status(404).json({ error: 'Provider 不存在' });
        }

        data.providers.forEach(p => p.isActive = false);
        provider.isActive = true;

        const success = await writeProviders(data);
        if (success) {
            io.emit('providers-updated');
            res.json(provider);
        } else {
            res.status(500).json({ error: '保存失败' });
        }
    } catch (error) {
        console.error('激活 Provider 失败:', error);
        res.status(500).json({ error: error.message });
    }
});

// 配置文件热重载
function setupConfigWatcher() {
    const envPath = join(PROJECT_ROOT, '.env');
    const bridgeConfigPath = join(PROJECT_ROOT, 'bridge.config.json');
    const providersPath = PROVIDERS_FILE;

    const watcher = chokidar.watch([envPath, bridgeConfigPath, providersPath], {
        persistent: true,
        ignoreInitial: true,
        awaitWriteFinish: {
            stabilityThreshold: 300,
            pollInterval: 100
        }
    });

    watcher.on('change', (path) => {
        const filename = path.split(/[/\\]/).pop();
        console.log(`[Config Hot Reload] 检测到配置文件变更: ${filename}`);

        io.emit('config-reload', {
            file: filename,
            timestamp: Date.now()
        });
    });

    watcher.on('error', (error) => {
        console.error(`[Config Watcher] Error: ${error.message}`);
    });

    return watcher;
}

let telegramClient = null;

function getTelegramClient() {
    if (telegramClient) return telegramClient;
    telegramClient = new TelegramClient({
        token: process.env.TG_BOT_TOKEN,
        chatId: process.env.TG_CHAT_ID,
    });
    return telegramClient;
}

app.post('/api/send-telegram', async (req, res) => {
    try {
        const { decision } = req.body;

        if (!decision || typeof decision !== 'object') {
            return res.status(400).json({ error: '无效的 decision 数据' });
        }

        const telegram = getTelegramClient();

        const binanceMarket = (process.env.BINANCE_MARKET || '').trim().toLowerCase();
        const market = binanceMarket === 'spot' ? 'spot' : 'futures';

        const tvUrl = buildTradingViewUrl(decision.symbol, decision.timeframe);
        const binanceUrl = buildBinanceUrl(decision.symbol, { market });

        const reply_markup = {
            inline_keyboard: [[
                { text: '查看TradingView图表', url: tvUrl },
                { text: '打开币安行情', url: binanceUrl },
            ]],
        };

        const text = buildDecisionMessageHtml(decision, { source: 'web_auto_run' });
        await telegram.sendHtmlMessage(text, { replyMarkup: reply_markup });

        res.json({ success: true });
    } catch (error) {
        console.error('发送 Telegram 消息失败:', error);
        res.status(500).json({ error: error.message });
    }
});

const PORT = process.env.PORT || 3000;
httpServer.listen(PORT, () => {
    console.log(`Server running on http://localhost:${PORT}`);
    setupConfigWatcher();
    console.log('[Config Hot Reload] 配置文件监听已启动');
});
