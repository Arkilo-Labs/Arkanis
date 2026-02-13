/**
 * Prompt Manager
 * 负责加载和管理 VLM 系统提示词
 */

import { readFileSync, existsSync, readdirSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import logger from '../utils/logger.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// prompts 目录路径（src/resources/prompts/vlm）
const PROMPTS_DIR = join(__dirname, '..', '..', 'resources', 'prompts', 'vlm');

export class PromptManager {
    /**
     * 获取指定名称的提示词
     * @param {string} promptName 提示词名称 (不含 .md 后缀)
     * @returns {string} 提示词内容
     */
    static getPrompt(promptName = 'default') {
        try {
            const fileName = `${promptName}.md`;
            const filePath = join(PROMPTS_DIR, fileName);

            if (!existsSync(filePath)) {
                logger.warn(`Prompt file not found: ${filePath}, falling back to default`);
                if (promptName !== 'default') {
                    return this.getPrompt('default');
                }
                throw new Error(`Default prompt file not found at ${filePath}`);
            }

            return readFileSync(filePath, 'utf-8');
        } catch (error) {
            logger.error(`Failed to load prompt: ${promptName}`, error);
            throw error;
        }
    }

    /**
     * 获取所有可用提示词列表
     * @returns {string[]} 提示词名称列表
     */
    static listPrompts() {
        try {
            if (!existsSync(PROMPTS_DIR)) {
                return [];
            }
            return readdirSync(PROMPTS_DIR)
                .filter(file => file.endsWith('.md'))
                .map(file => file.replace('.md', ''));
        } catch (error) {
            logger.error('Failed to list prompts', error);
            return [];
        }
    }
}

export default PromptManager;
