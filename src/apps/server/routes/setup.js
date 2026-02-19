const USERNAME_REGEX = /^[a-zA-Z0-9][a-zA-Z0-9._@-]{1,62}[a-zA-Z0-9]$/;

export function registerSetupRoutes({ app, authService }) {
  app.post('/_setup/:token/api/setup/init', async (req, res) => {
    try {
      if (authService.allowNoAuth) {
        return res.status(400).json({ error: 'ALLOW_NO_AUTH 已开启' });
      }

      if (!authService.isSetupMode()) {
        return res.status(409).json({ error: 'Already initialized' });
      }

      const token = String(req.params.token || '').trim();
      if (!authService.validateSetupToken(token)) {
        return res.status(403).json({ error: 'Invalid setup token' });
      }

      const username = String(req.body?.username || '').trim();
      const password = String(req.body?.password || '');

      if (!USERNAME_REGEX.test(username)) {
        return res
          .status(400)
          .json({ error: 'username 须 3-64 位，支持字母/数字/._@-，首尾须为字母或数字' });
      }
      if (password.length < 8) {
        return res.status(400).json({ error: 'password 长度至少 8 位' });
      }

      const result = await authService.initAdmin({ username, password });
      return res.json({ success: true, token: result.token, user: result.user });
    } catch (error) {
      const message = error?.message || String(error);
      if (message === '已初始化') return res.status(409).json({ error: 'Already initialized' });
      return res.status(500).json({ error: message });
    }
  });
}
