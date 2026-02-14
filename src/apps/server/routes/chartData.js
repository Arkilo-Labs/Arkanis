const CHART_DATA_TTL_MS = 5 * 60 * 1000;

export function registerChartDataRoutes({ app, sessionChartData }) {
    app.get('/api/chart-data/:sessionId', (req, res) => {
        try {
            const sessionId = String(req.params.sessionId || '').trim();
            const data = sessionChartData.get(sessionId);
            if (!data) return res.status(404).json({ error: 'Chart data not found' });
            return res.json(data);
        } catch (error) {
            return res.status(500).json({ error: error?.message || String(error) });
        }
    });

    app.post('/api/chart-data', (req, res) => {
        try {
            const sessionId = String(req.body?.sessionId || '').trim();
            const data = req.body?.data;

            if (!sessionId || data === undefined) {
                return res.status(400).json({ error: 'Missing sessionId or data' });
            }

            sessionChartData.set(sessionId, data);

            setTimeout(() => {
                sessionChartData.delete(sessionId);
            }, CHART_DATA_TTL_MS);

            return res.json({ success: true });
        } catch (error) {
            return res.status(500).json({ error: error?.message || String(error) });
        }
    });
}

