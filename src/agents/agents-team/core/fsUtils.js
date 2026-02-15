import { mkdirSync, readFileSync, writeFileSync, existsSync } from 'fs';
import { dirname } from 'path';

export function ensureDir(path) {
    mkdirSync(path, { recursive: true });
}

export function readText(path) {
    return readFileSync(path, 'utf-8');
}

export function writeText(path, content) {
    ensureDir(dirname(path));
    writeFileSync(path, content, 'utf-8');
}

export function fileExists(path) {
    return existsSync(path);
}

