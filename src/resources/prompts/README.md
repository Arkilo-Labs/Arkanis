# Prompts 目录约定

本项目的提示词（prompt）统一放在 `src/resources/prompts/` 下，按领域分子目录，避免散落在仓库根目录。

## Lens

- 目录：`src/resources/prompts/lens/`
- 选择：`.env` 里的 `PROMPT_NAME=<name>` → 加载 `src/resources/prompts/lens/<name>.md`
- 入口：`src/core/lens/promptManager.js`

## Agents Round（Roundtable）

- 目录：`src/resources/prompts/agents-round/`
- 选择：`src/agents/agents-round/config/agents.json` 中的 `prompt` 字段（文件名）
- 入口：`src/cli/roundtable/main.js`

## 命名建议

- 文件名即 prompt 名称（不含 `.md`）
- 保持简短、可读，避免空格
