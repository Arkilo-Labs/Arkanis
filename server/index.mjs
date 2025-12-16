import express from 'express';
import { createServer } from 'http';
import { Server } from 'socket.io';
import cors from 'cors';
import { spawn } from 'child_process';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';
import bodyParser from 'body-parser';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const PROJECT_ROOT = join(__dirname, '..');

const app = express();
const httpServer = createServer(app);
const io = new Server(httpServer, {
    cors: {
        origin: "*",
        methods: ["GET", "POST"]
    }
});

app.use(cors());
app.use(bodyParser.json());

// Serve static files from 'outputs' directory
app.use('/outputs', express.static(join(PROJECT_ROOT, 'outputs')));

// Store active processes
const activeProcesses = new Map();

io.on('connection', (socket) => {
    console.log('Client connected:', socket.id);

    socket.on('disconnect', () => {
        console.log('Client disconnected:', socket.id);
    });

    socket.on('kill-process', (pid) => {
        if (activeProcesses.has(pid)) {
            const child = activeProcesses.get(pid);
            child.kill();
            activeProcesses.delete(pid);
            socket.emit('process-killed', pid);
            console.log(`Killed process ${pid}`);
        }
    });
});

app.post('/api/run-script', (req, res) => {
    const { script, args } = req.body;
    if (!['main', 'backtest'].includes(script)) {
        return res.status(400).json({ error: 'Invalid script name' });
    }

    const scriptPath = join(PROJECT_ROOT, 'scripts', `${script}.js`);
    const cmdArgs = [scriptPath, ...(args || [])];

    console.log(`Spawning: node ${cmdArgs.join(' ')}`);

    try {
        const child = spawn(process.execPath, cmdArgs, {
            cwd: PROJECT_ROOT,
            env: { ...process.env, FORCE_COLOR: '1' },
            stdio: ['ignore', 'pipe', 'pipe']
        });

        const pid = child.pid;
        if (pid) {
            activeProcesses.set(pid, child);
        }

        // Stream logs
        child.stdout.on('data', (data) => {
            const str = data.toString();
            console.log(`[STDOUT] ${str.substring(0, 100)}`);
            io.emit('log', { type: 'stdout', data: str });
        });

        child.stderr.on('data', (data) => {
            const str = data.toString();
            console.log(`[STDERR] ${str}`);
            io.emit('log', { type: 'stderr', data: str });
        });

        child.on('close', (code) => {
            console.log(`Process exited with code ${code}`);
            io.emit('process-exit', { code });
            if (pid) activeProcesses.delete(pid);
        });

        child.on('error', (err) => {
            console.error('Failed to start process.', err);
            io.emit('log', { type: 'error', data: `Failed to start process: ${err.message}` });
        });

        res.json({ pid });
    } catch (error) {
        console.error('Spawn error:', error);
        res.status(500).json({ error: error.message });
    }
});

const PORT = process.env.PORT || 3000;
httpServer.listen(PORT, () => {
    console.log(`Server running on http://localhost:${PORT}`);
});
