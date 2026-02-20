import cors from 'cors';
import express from 'express';
import helmet from 'helmet';
import { existsSync } from 'fs';
import { join } from 'path';

export function registerHttpMiddleware({ app, corsOrigin }) {
    // Security headers first (CSP disabled for SPA inline scripts)
    app.use(helmet({ contentSecurityPolicy: false }));

    app.use(cors({
        origin: corsOrigin,
        methods: ['GET', 'POST', 'PUT', 'DELETE', 'PATCH', 'OPTIONS'],
        allowedHeaders: ['Content-Type', 'Authorization', 'X-Chart-Write-Token'],
    }));

    app.use(express.json({ limit: '1mb' }));
}

export function registerStaticMiddleware({ app, projectRoot }) {
    app.use('/outputs', express.static(join(projectRoot, 'outputs')));

    const webDistPath = join(projectRoot, 'src', 'apps', 'web', 'dist');
    if (existsSync(webDistPath)) {
        app.use(express.static(webDistPath));
    }
}

export function registerSpaFallback({ app, projectRoot }) {
    const indexPath = join(projectRoot, 'src', 'apps', 'web', 'dist', 'index.html');
    if (!existsSync(indexPath)) return;

    app.get('/{*path}', (_req, res) => {
        res.sendFile(indexPath);
    });
}
