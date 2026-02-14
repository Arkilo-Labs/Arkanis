import { useMemo, useState } from 'react';
import { login } from '../composables/useAuth.js';

export default function LoginPage() {
    const [username, setUsername] = useState('');
    const [password, setPassword] = useState('');
    const [isSubmitting, setIsSubmitting] = useState(false);
    const [error, setError] = useState('');

    const canSubmit = useMemo(() => username.trim() && password, [password, username]);

    async function submit(e) {
        e.preventDefault();
        setError('');
        if (!canSubmit) return;

        setIsSubmitting(true);
        try {
            await login({ username: username.trim(), password });
        } catch (caught) {
            setError(caught?.message || String(caught));
        } finally {
            setIsSubmitting(false);
        }
    }

    return (
        <div className="auth-card">
            <div className="mb-6">
                <div className="text-xs tracking-wide text-text-muted">Admin sign in</div>
                <h1 className="text-3xl font-bold mt-2">登录</h1>
                <p className="text-sm text-text-muted mt-2">请输入管理员账号密码。</p>
            </div>

            <form className="space-y-4" onSubmit={submit}>
                <div>
                    <label className="form-label">用户名</label>
                    <input
                        value={username}
                        onChange={(e) => setUsername(e.target.value)}
                        className="form-input"
                        type="text"
                        autoComplete="username"
                    />
                </div>

                <div>
                    <label className="form-label">密码</label>
                    <input
                        value={password}
                        onChange={(e) => setPassword(e.target.value)}
                        className="form-input"
                        type="password"
                        autoComplete="current-password"
                    />
                </div>

                {error ? (
                    <div className="rounded-xl border border-error/25 bg-error/10 p-4 text-error text-sm">
                        {error}
                    </div>
                ) : null}

                <button
                    className="btn btn-primary btn-full"
                    disabled={!canSubmit || isSubmitting}
                    type="submit"
                >
                    <i
                        className={
                            isSubmitting
                                ? 'fas fa-spinner fa-spin'
                                : 'fas fa-right-to-bracket'
                        }
                    ></i>
                    登录
                </button>
            </form>
        </div>
    );
}
