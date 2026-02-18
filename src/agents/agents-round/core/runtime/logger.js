import { writeText } from './fsUtils.js';

export class SessionLogger {
    constructor({ logPath }) {
        this.logPath = logPath;
        this._lines = [];
    }

    _push(level, message) {
        const line = `[${new Date().toISOString()}] [${level}] ${message}`;
        this._lines.push(line);
        // 运行时也打印到控制台，便于追踪
        console.log(line);
        writeText(this.logPath, `${this._lines.join('\n')}\n`);
    }

    info(message) {
        this._push('INFO', message);
    }

    warn(message) {
        this._push('WARN', message);
    }

    error(message) {
        this._push('ERROR', message);
    }
}

