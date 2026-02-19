<div align="right">
  <span>[<a href="./README_EN.md">English</a>]</span>
  <span>[<b>简体中文</b>]</span>
</div>

<div align="center">
  <img src="./src/apps/web/public/logo.png" alt="Arkanis" width="100">
  <h1>Arkanis</h1>
  <p>由 AI 驱动的交易决策实验系统 —— Lens 视觉分析 × 圆桌多智能体协作。</p>
  <div align="center">
    <img src="https://img.shields.io/badge/version-1.0.0-orange" alt="Version" />
    <img src="https://img.shields.io/badge/license-PolyForm--Noncommercial-blue" alt="License" />
    <img src="https://img.shields.io/badge/node-%3E%3D18-green" alt="Node" />
  </div>
  <hr>
</div>

Arkanis 是一个面向量化研究者的本地 AI 交易决策实验环境。核心能力分为两块：  
* **Lens**，通过视觉分析 K 线图直接输出结构化交易决策；  
* **圆桌**，通过 Leader+Agents 架构，协同讨论，形成多视角的综合判断。

## 快速开始

确保已安装 [Docker](https://docs.docker.com/get-docker/)，然后执行：

**Linux / macOS**

```bash
bash <(curl -fsSL https://raw.githubusercontent.com/your-org/arkanis/main/install.sh)
```

<details>
<summary>Windows (PowerShell)</summary>

```powershell
irm https://raw.githubusercontent.com/your-org/arkanis/main/install.ps1 -OutFile install.ps1
powershell -ExecutionPolicy Bypass -File install.ps1
```

</details>

安装脚本会自动完成：克隆仓库、生成 `.env`、选择搜索栈、构建并启动容器。
启动后访问 `http://localhost:8082` 即可开始配置。

> 开发者本地部署请参考 [本地部署指南](./docs/guide/local-deploy.md)。

## 功能

- **Lens 视觉决策**：将 K 线图渲染为图像后交给大模型分析，输出方向、强度、止损止盈区间等结构化结果，支持主副周期联合分析。
- **圆桌多智能体**：多个 AI 角色（分析师、空头、多头、主席等）依次发言，经质量审计后输出最终决策与会议纪要，避免单一模型的偏见。
- **新闻管线**：通过 SearXNG + Firecrawl 抓取实时新闻，作为圆桌讨论的上下文补充。
- **Web 控制台**：图形化配置 Provider / 模型 / 密钥 / Prompt，实时查看运行日志，无需手动编辑配置文件。

## 截图

### 圆桌

![圆桌截图](https://cdn.nodeimage.com/i/sNvDVABqsDgvSpnS31QdHsYSewpVNVix.webp)

### Lens

![Lens 截图](https://cdn.nodeimage.com/i/yu26mIGoxWeZxyJ5XBqxQYMj4eZMY2Lf.webp)

## License

PolyForm Noncommercial 1.0.0 — 仅限非商业用途。
