import cors from 'cors';
import express from 'express';
import { join } from 'path';

export function registerHttpMiddleware({ app }) {
    app.use(cors());
    app.use(express.json());
}

export function registerStaticMiddleware({ app, projectRoot }) {
    app.use('/outputs', express.static(join(projectRoot, 'outputs')));
}
