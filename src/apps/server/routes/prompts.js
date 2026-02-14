export function registerPromptRoutes({ app, PromptManager }) {
    app.get('/api/prompts', (_req, res) => {
        try {
            return res.json(PromptManager.listPrompts());
        } catch (error) {
            return res.status(500).json({ error: error?.message || String(error) });
        }
    });
}

