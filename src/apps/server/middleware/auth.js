import { rateLimit } from 'express-rate-limit';
import { isValidChartWriteToken } from '../services/chartWriteToken.js';

const loginRateLimiter = rateLimit({
    windowMs: 60_000,
    max: 5,
    standardHeaders: 'draft-7',
    legacyHeaders: false,
    message: { error: 'Too many login attempts, please try again later' },
});

function isAllowedSetupPath({ path, setupToken }) {
  if (!setupToken) return false;
  const prefix = `/_setup/${setupToken}`;
  return path === prefix || path.startsWith(`${prefix}/`);
}

function isPublicAuthRoute({ method, path }) {
  if (method === 'GET' && path === '/api/auth/status') return true;
  if (method === 'POST' && path === '/api/auth/login') return true;
  return false;
}

function isChartWriteRoute({ method, path }) {
  const normalizedPath = typeof path === 'string' && path !== '/' ? path.replace(/\/+$/, '') : path;
  return method === 'POST' && normalizedPath === '/api/chart-data';
}

export function registerAuthMiddleware({ app, io, authService }) {
  app.post('/api/auth/login', loginRateLimiter);

  app.use((req, res, next) => {
    // Frontend assets and SPA HTML are public — auth only guards /api/* and /outputs/*
    if (!req.path.startsWith('/api/') && !req.path.startsWith('/outputs/')) return next();
    if (authService.allowNoAuth) return next();

    if (authService.isSetupMode()) {
      const setupToken = authService.getSetupToken();
      if (isAllowedSetupPath({ path: req.path, setupToken })) return next();

      return res.status(403).json({ error: 'Setup required' });
    }

    if (isPublicAuthRoute({ method: req.method, path: req.path })) return next();

    if (isChartWriteRoute({ method: req.method, path: req.path })) {
      const token = req.headers?.['x-chart-write-token'];
      if (isValidChartWriteToken(token)) return next();
    }

    const token = authService.extractRequestToken(req);
    const session = authService.requireSession(token);
    if (!session) return res.status(401).json({ error: 'Unauthorized' });

    req.auth = session.user;
    req.sessionToken = session.token;
    return next();
  });

  io.use((socket, next) => {
    if (authService.allowNoAuth) return next();
    if (authService.isSetupMode()) return next(new Error('setup_required'));

    const token = socket.handshake?.auth?.token;
    const session = authService.requireSession(token);
    if (!session) return next(new Error('unauthorized'));

    socket.data.auth = session.user;
    return next();
  });
}
