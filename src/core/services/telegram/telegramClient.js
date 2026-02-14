/**
 * Telegram 发送封装
 */

import TelegramBot from 'node-telegram-bot-api';

export class TelegramClient {
    #bot;
    #chatId;

    constructor({ token, chatId }) {
        const normalizedToken = String(token || '').trim();
        const normalizedChatId = String(chatId || '').trim();
        if (!normalizedToken) throw new Error('缺少 TG_BOT_TOKEN');
        if (!normalizedChatId) throw new Error('缺少 TG_CHAT_ID');

        this.#bot = new TelegramBot(normalizedToken, { polling: false });
        this.#chatId = normalizedChatId;
    }

    async sendHtmlMessage(html, { replyMarkup, disableWebPagePreview = true } = {}) {
        return this.#bot.sendMessage(this.#chatId, html, {
            parse_mode: 'HTML',
            reply_markup: replyMarkup,
            disable_web_page_preview: disableWebPagePreview,
        });
    }
}

