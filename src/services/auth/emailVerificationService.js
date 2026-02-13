import { withCoreConnection } from '../../data/pgClient.js';
import {
    getEmailVerificationByTokenHashForUpdate,
    getLatestEmailVerificationForUserId,
    getUserById,
    insertEmailVerification,
    markEmailVerificationUsed,
    markUserEmailVerified,
} from '../../data/emailVerificationRepository.js';
import { createMailer } from '../email/mailer.js';
import { generateSessionToken, tokenToHash } from './session.js';

function nowMs() {
    return Date.now();
}

function minutesToMs(min) {
    return min * 60 * 1000;
}

function buildVerifyUrl({ publicUrl, token }) {
    const base = String(publicUrl || '').trim().replace(/\/+$/, '');
    if (!base) throw new Error('缺少 APP_PUBLIC_URL，无法生成验证链接');
    const t = encodeURIComponent(token);
    return `${base}/verify-email?token=${t}`;
}

export async function sendEmailVerification({ userId, publicUrl, env = process.env, logger = console }) {
    const ttlMinutes = Number(env.EMAIL_VERIFY_TTL_MINUTES || 60);
    const resendCooldownSeconds = Number(env.EMAIL_VERIFY_RESEND_COOLDOWN_SECONDS || 60);
    const hasSmtp = !!String(env.SMTP_HOST || '').trim();

    return withCoreConnection(async (client) => {
        const user = await getUserById(client, userId);
        if (!user) throw new Error('用户不存在');
        if (user.email_verified_at) return { alreadyVerified: true };

        const last = await getLatestEmailVerificationForUserId(client, userId);
        if (!hasSmtp && last?.created_at && !last?.used_at) {
            const expMs = last?.expires_at ? new Date(last.expires_at).getTime() : Number.NaN;
            const isExpired = Number.isFinite(expMs) ? expMs <= nowMs() : false;
            if (!isExpired) {
                const lastMs = new Date(last.created_at).getTime();
                if (Number.isFinite(lastMs)) {
                    const elapsedMs = nowMs() - lastMs;
                    const remainMs = resendCooldownSeconds * 1000 - elapsedMs;
                    if (remainMs > 0) {
                        const remainSec = Math.ceil(remainMs / 1000);
                        throw new Error(`发送太频繁，请 ${remainSec}s 后再试`);
                    }
                }
            }
        }

        const token = generateSessionToken();
        const tokenHash = tokenToHash(token);
        const expiresAt = new Date(nowMs() + minutesToMs(ttlMinutes)).toISOString();

        const row = await insertEmailVerification(client, {
            userId,
            email: user.email,
            tokenHash,
            expiresAt,
        });

        const url = buildVerifyUrl({ publicUrl, token });
        const mailer = createMailer({ env, logger });

        await mailer.send({
            to: user.email,
            subject: 'Arkanis 邮箱验证',
            text: `请打开链接完成邮箱验证：${url}`,
            html: `<p>请打开链接完成邮箱验证：</p><p><a href="${url}">${url}</a></p>`,
        });

        const debugLink = mailer.kind === 'stream' ? url : null;
        return { sent: true, expiresAt: row.expires_at, debugLink };
    });
}

export async function verifyEmailByToken({ token }) {
    const tokenHash = tokenToHash(token);

    return withCoreConnection(async (client) => {
        await client.query('BEGIN');
        try {
            const row = await getEmailVerificationByTokenHashForUpdate(client, tokenHash);
            if (!row) throw new Error('验证链接无效');
            if (row.used_at) throw new Error('验证链接已使用');
            const exp = new Date(row.expires_at).getTime();
            if (!Number.isFinite(exp) || exp <= nowMs()) throw new Error('验证链接已过期');

            const user = await getUserById(client, row.user_id);
            if (!user) throw new Error('用户不存在');
            if (String(user.email).toLowerCase() !== String(row.email).toLowerCase()) {
                throw new Error('邮箱已变更，请重新发送验证邮件');
            }

            await markEmailVerificationUsed(client, row.id);
            const updated = await markUserEmailVerified(client, row.user_id);

            await client.query('COMMIT');
            return { success: true, user: updated };
        } catch (e) {
            await client.query('ROLLBACK');
            throw e;
        }
    });
}
