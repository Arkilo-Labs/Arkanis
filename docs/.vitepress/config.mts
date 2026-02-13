import { defineConfig } from 'vitepress';

export default defineConfig({
    lang: 'zh-CN',
    title: 'Arkanis',
    description: 'Arkanis 文档站',
    themeConfig: {
        nav: [{ text: '首页', link: '/' }],
        sidebar: [
            {
                text: '开始',
                items: [{ text: '简介', link: '/' }],
            },
        ],
    },
});

