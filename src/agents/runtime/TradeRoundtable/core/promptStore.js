import { join } from 'path';
import { readText } from './fsUtils.js';

export class PromptStore {
    constructor({ promptsDir }) {
        this.promptsDir = promptsDir;
    }

    getPrompt(promptFileName) {
        return readText(join(this.promptsDir, promptFileName));
    }
}

