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
        <div className="glass-card w-full max-w-xl p-8">
            <div className="mb-6">
                <span className="text-subtitle-en mb-2 block">Admin sign in</span>
                <h1 className="text-hero-cn text-apple-gradient">登录</h1>
                <p className="text-sm text-white/50 mt-2">请输入管理员账号密码。</p>
            </div>

            <form className="space-y-4" onSubmit={submit}>
                <div>
                    <label className="text-label block mb-2">用户名</label>
                    <input
                        value={username}
                        onChange={(e) => setUsername(e.target.value)}
                        className="input-glass"
                        type="text"
                        autoComplete="username"
                    />
                </div>

                <div>
                    <label className="text-label block mb-2">密码</label>
                    <input
                        value={password}
                        onChange={(e) => setPassword(e.target.value)}
                        className="input-glass"
                        type="password"
                        autoComplete="current-password"
                    />
                </div>

                {error ? (
                    <div className="p-4 rounded-xl bg-red-500/10 border border-red-500/20 text-red-200 text-sm">
                        {error}
                    </div>
                ) : null}

                <button
                    className="btn-glass w-full h-14 justify-center"
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
                    <span className="font-bold">登录</span>
                </button>
            </form>
        </div>
    );
}
