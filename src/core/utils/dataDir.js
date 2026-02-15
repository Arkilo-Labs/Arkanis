import { isAbsolute, join } from 'path';

export function resolveDataDir({ projectRoot }) {
    const raw = String(process.env.ARKANIS_DATA_DIR || '').trim();
    const configured = raw !== '' ? raw : '/data';
    if (isAbsolute(configured)) return configured;
    if (!projectRoot) throw new Error('resolveDataDir: 缺少 projectRoot');
    return join(projectRoot, configured);
}

