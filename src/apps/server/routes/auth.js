export function registerAuthRoutes({ app, authService }) {
    app.get('/api/auth/status', (req, res) => {
        try {
            if (authService.allowNoAuth) {
                return res.json({ allowNoAuth: true, initialized: true, authed: true, user: null });
            }

            if (authService.isSetupMode()) {
                return res.status(403).json({ error: 'Setup required' });
            }

            const token = authService.extractRequestToken(req);
            return res.json(authService.getStatus({ token }));
        } catch (error) {
            return res.status(500).json({ error: error?.message || String(error) });
        }
    });

    app.post('/api/auth/login', async (req, res) => {
        try {
            if (authService.allowNoAuth) {
                return res.status(400).json({ error: 'ALLOW_NO_AUTH 已开启' });
            }

            if (authService.isSetupMode()) {
                return res.status(403).json({ error: 'Setup required' });
            }

            const username = String(req.body?.username || '').trim();
            const password = String(req.body?.password || '');
            if (!username || !password) {
                return res.status(400).json({ error: 'Missing username or password' });
            }

            const result = await authService.login({ username, password });
            if (!result) return res.status(401).json({ error: 'Invalid credentials' });
            return res.json(result);
        } catch (error) {
            return res.status(500).json({ error: error?.message || String(error) });
        }
    });

    app.post('/api/auth/logout', (req, res) => {
        try {
            if (authService.allowNoAuth) {
                return res.json({ success: true });
            }

            const token = req.sessionToken || authService.extractRequestToken(req);
            if (token) authService.logout(token);
            return res.json({ success: true });
        } catch (error) {
            return res.status(500).json({ error: error?.message || String(error) });
        }
    });
}

