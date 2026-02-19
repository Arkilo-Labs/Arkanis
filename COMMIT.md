# docs: 重构文档站并补充用户向内容

## 变更概要

### README.md
- 快速开始部分：在第一个 bash 安装命令前增加 **Linux / macOS** 平台标签

### docs/index.md
- 从占位符骨架重写为 VitePress `home` 布局
- 包含 hero 区域（项目名、描述、行动按钮）和 4 个功能特性卡片

### docs/guide/getting-started.md（新增）
- 面向普通用户的快速开始指南
- 包含：前置条件、双平台安装命令、初始化流程、AI 模型配置、搜索栈选项、常用 Docker 操作

### docs/guide/local-deploy.md
- 顶部开发者说明改为 VitePress `info` 提示框，引导普通用户到「快速开始」

### docs/.vitepress/config.mts
- description 改为 "AI 驱动的交易决策实验系统"
- 侧边栏分为「指南」和「开发者」两组，开发者部分默认折叠

### .github/workflows/docs.yml（新增）
- GitHub Actions CI：在 docs/ 目录变更时自动构建并部署 VitePress 到 GitHub Pages
