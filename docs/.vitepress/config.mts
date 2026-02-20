import { defineConfig } from 'vitepress';

const base = process.env.VITEPRESS_BASE ?? (process.env.GITHUB_ACTIONS ? '/Arkanis/' : '/');

export default defineConfig({
    base,
    lang: 'zh-CN',
    title: 'Arkanis',
    description: 'AI 驱动的交易决策实验系统',
    themeConfig: {
        nav: [
            { text: '指南', link: '/guide/getting-started' },
        ],
        sidebar: [
            {
                text: '指南',
                items: [
                    { text: '快速开始', link: '/guide/getting-started' },
                ],
            },
            {
                text: '开发者',
                collapsed: true,
                items: [
                    { text: '本地安装（非 Docker）', link: '/guide/local-install' },
                    { text: '本地源码部署（Docker）', link: '/guide/local-deploy' },
                ],
            },
        ],
    },
});
