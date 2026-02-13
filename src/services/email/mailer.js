import nodemailer from 'nodemailer';

function parsePort(value, fallback) {
    const n = Number.parseInt(String(value ?? ''), 10);
    if (!Number.isFinite(n) || n <= 0) return fallback;
    return n;
}

function buildTransportFromEnv(env) {
    const host = String(env.SMTP_HOST || '').trim();
    const user = String(env.SMTP_USER || '').trim();
    const pass = String(env.SMTP_PASS || env.SMTP_API_KEY || '').trim();
    const port = parsePort(env.SMTP_PORT, 587);
    const secure = String(env.SMTP_SECURE || '').trim() === 'true';

    if (!host) {
        return { kind: 'stream', transport: nodemailer.createTransport({ streamTransport: true, newline: 'unix' }) };
    }

    return {
        kind: 'smtp',
        transport: nodemailer.createTransport({
            host,
            port,
            secure,
            auth: user ? { user, pass } : undefined,
        }),
    };
}

export function createMailer({ env = process.env, logger = console } = {}) {
    const from = String(env.SMTP_FROM || 'no-reply@arkanis.dev').trim();
    const { kind, transport } = buildTransportFromEnv(env);

    async function send({ to, subject, html, text }) {
        const info = await transport.sendMail({
            from,
            to,
            subject,
            text: text || undefined,
            html: html || undefined,
        });

        if (kind === 'stream') {
            const preview = info?.message?.toString?.() || '';
            logger.log('[mail:dev] 未配置 SMTP，邮件内容如下：\n' + preview);
        }

        return info;
    }

    return { send, kind, from };
}
