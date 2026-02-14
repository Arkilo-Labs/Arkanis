import { useMemo, useState } from 'react';
import { setToken } from '../composables/useAuth.js';

const USERNAME_REGEX = /^[a-zA-Z0-9_-]{3,64}$/;

export default function SetupPage({ setupToken }) {
    const [username, setUsername] = useState('');
    const [password, setPassword] = useState('');
    const [confirmPassword, setConfirmPassword] = useState('');
    const [isSubmitting, setIsSubmitting] = useState(false);
    const [error, setError] = useState('');

    const validationMessage = useMemo(() => {
        const trimmedUsername = username.trim();
        if (!trimmedUsername) return '请输入用户名（3-64 位，字母/数字/_/-）';
        if (!USERNAME_REGEX.test(trimmedUsername)) return '用户名需为 3-64 位字母/数字/_/-';
        if (!password) return '请输入密码（至少 8 位）';
        if (password.length < 8) return '密码至少 8 位';
        if (!confirmPassword) return '请再次输入密码';
        if (password !== confirmPassword) return '两次密码不一致';
        return '';
    }, [confirmPassword, password, username]);

    const canSubmit = validationMessage === '';

    async function submit(e) {
        e.preventDefault();
        setError('');

        if (!canSubmit) {
            setError(validationMessage);
            return;
        }

        setIsSubmitting(true);
        try {
            const res = await fetch(`/_setup/${setupToken}/api/setup/init`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    username: username.trim(),
                    password,
                }),
            });

            const payload = await res.json().catch(() => null);
            if (!res.ok) {
                const message =
                    payload && typeof payload === 'object' && payload.error
                        ? String(payload.error)
                        : `请求失败: ${res.status}`;
                throw new Error(message);
            }

            setToken(payload.token);
            window.location.assign('/');
        } catch (caught) {
            setError(caught?.message || String(caught));
        } finally {
            setIsSubmitting(false);
        }
    }

    return (
        <div className="auth-card">
            <div className="mb-6">
                <div className="text-xs tracking-wide text-text-muted">First time setup</div>
                <h1 className="text-3xl font-bold mt-2">初始化管理员</h1>
                <p className="text-sm text-text-muted mt-2">
                    首次部署需要创建管理员账号，用于后续登录。
                </p>
            </div>

            <form className="space-y-4" onSubmit={submit}>
                <div>
                    <label className="form-label">用户名</label>
                    <input
                        value={username}
                        onChange={(e) => setUsername(e.target.value)}
                        className="form-input"
                        type="text"
                        placeholder="admin"
                        autoComplete="username"
                    />
                    <p className="form-hint">仅允许字母/数字/_/-，长度 3-64。</p>
                </div>

                <div>
                    <label className="form-label">密码</label>
                    <input
                        value={password}
                        onChange={(e) => setPassword(e.target.value)}
                        className="form-input"
                        type="password"
                        placeholder="至少 8 位"
                        autoComplete="new-password"
                    />
                </div>

                <div>
                    <label className="form-label">确认密码</label>
                    <input
                        value={confirmPassword}
                        onChange={(e) => setConfirmPassword(e.target.value)}
                        className="form-input"
                        type="password"
                        placeholder="再输入一次"
                        autoComplete="new-password"
                    />
                </div>

                {!error && !canSubmit ? (
                    <p className="form-hint">{validationMessage}</p>
                ) : null}

                {error ? (
                    <div className="rounded-xl border border-error/25 bg-error/10 p-4 text-error text-sm">
                        {error}
                    </div>
                ) : null}

                <button
                    className="btn btn-primary btn-full"
                    disabled={isSubmitting}
                    type="submit"
                >
                    <i
                        className={
                            isSubmitting ? 'fas fa-spinner fa-spin' : 'fas fa-wrench'
                        }
                    ></i>
                    完成初始化
                </button>
            </form>
        </div>
    );
}
