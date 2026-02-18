import cors from 'cors';
import express from 'express';
import { existsSync } from 'fs';
import { join } from 'path';

export function registerHttpMiddleware({ app }) {
    app.use(cors());
    app.use(express.json());
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
