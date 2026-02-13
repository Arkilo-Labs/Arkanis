import { spawn } from 'child_process';
import { join } from 'path';

function resolveScriptPath({ projectRoot, script }) {
    return join(projectRoot, 'src', 'cli', 'vlm', `${script}.js`);
}

function parseArgs(value) {
    if (!Array.isArray(value)) return [];
    return value.filter((arg) => typeof arg === 'string');
}

export function registerScriptRoutes({ app, io, projectRoot, activeProcesses }) {
    app.post('/api/run-script', (req, res) => {
        const script = String(req.body?.script || '').trim();
        const args = parseArgs(req.body?.args);

        if (!['main', 'backtest'].includes(script)) {
            return res.status(400).json({ error: 'Invalid script name' });
        }

        const scriptPath = resolveScriptPath({ projectRoot, script });
        const cmdArgs = [scriptPath, ...args];

        console.log(`Spawning: node ${cmdArgs.join(' ')}`);

        try {
            const child = spawn(process.execPath, cmdArgs, {
                cwd: projectRoot,
                env: { ...process.env, FORCE_COLOR: '1' },
                stdio: ['ignore', 'pipe', 'pipe'],
            });

            const pid = child.pid;
            if (pid) activeProcesses.set(pid, child);

            child.stdout.on('data', (data) => {
                io.emit('log', { type: 'stdout', data: data.toString() });
            });

            child.stderr.on('data', (data) => {
                io.emit('log', { type: 'stderr', data: data.toString() });
            });

            child.on('close', (code) => {
                io.emit('process-exit', { code, pid });
                if (pid) activeProcesses.delete(pid);
            });

            child.on('error', (err) => {
                io.emit('log', { type: 'error', data: `Failed to start process: ${err.message}` });
            });

            return res.json({ pid });
        } catch (error) {
            return res.status(500).json({ error: error?.message || String(error) });
        }
    });
}

