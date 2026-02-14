import cors from 'cors';
import bodyParser from 'body-parser';
import express from 'express';
import { join } from 'path';

export function registerHttpMiddleware({ app }) {
    app.use(cors());
    app.use(bodyParser.json());
}

export function registerStaticMiddleware({ app, projectRoot }) {
    app.use('/outputs', express.static(join(projectRoot, 'outputs')));
    app.use('/verify-test', express.static(join(projectRoot, 'web_verify_test')));
}
