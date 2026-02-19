import { defineConfig } from 'vitepress';

export default defineConfig({
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
                    { text: '本地部署', link: '/guide/local-deploy' },
                ],
            },
        ],
    },
});

