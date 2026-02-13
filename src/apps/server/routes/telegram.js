function buildReplyMarkup({ tvUrl, binanceUrl }) {
    return {
        inline_keyboard: [[{ text: '查看TradingView图表', url: tvUrl }, { text: '打开币安行情', url: binanceUrl }]],
    };
}

export function registerTelegramRoutes({
    app,
    TelegramClient,
    buildTradingViewUrl,
    buildBinanceUrl,
    buildDecisionMessageHtml,
}) {
    let telegramClient = null;

    function getTelegramClient() {
        if (telegramClient) return telegramClient;
        telegramClient = new TelegramClient({
            token: process.env.TG_BOT_TOKEN,
            chatId: process.env.TG_CHAT_ID,
        });
        return telegramClient;
    }

    app.post('/api/send-telegram', async (req, res) => {
        try {
            const decision = req.body?.decision;
            if (!decision || typeof decision !== 'object') {
                return res.status(400).json({ error: '无效的 decision 数据' });
            }

            const telegram = getTelegramClient();

            const binanceMarket = String(process.env.BINANCE_MARKET || '').trim().toLowerCase();
            const market = binanceMarket === 'spot' ? 'spot' : 'futures';

            const tvUrl = buildTradingViewUrl(decision.symbol, decision.timeframe);
            const binanceUrl = buildBinanceUrl(decision.symbol, { market });

            const reply_markup = buildReplyMarkup({ tvUrl, binanceUrl });

            const text = buildDecisionMessageHtml(decision, { source: 'web_auto_run' });
            await telegram.sendHtmlMessage(text, { replyMarkup: reply_markup });

            return res.json({ success: true });
        } catch (error) {
            console.error('发送 Telegram 消息失败:', error);
            return res.status(500).json({ error: error?.message || String(error) });
        }
    });
}

