import process from 'node:process';

import { defineConfig } from 'vitepress';

// GitHub Pages project site: https://<user>.github.io/vben-nest-kit/
// Enable Pages after the repo is Public (Settings → Pages → GitHub Actions).
const base = process.env.QINGZHAN_DOCS_BASE || '/vben-nest-kit/';

export default defineConfig({
  title: '青栈 Qingzhan',
  description: 'NestJS backend kit for Vue Vben Admin — 青栈',
  base,
  cleanUrls: true,
  lastUpdated: true,
  ignoreDeadLinks: true,
  srcExclude: ['**/README.md'],
  head: [
    [
      'link',
      { rel: 'icon', href: `${base}favicon.svg`, type: 'image/svg+xml' },
    ],
    ['meta', { name: 'theme-color', content: '#0f766e' }],
  ],
  themeConfig: {
    logo: '/logo.svg',
    socialLinks: [
      { icon: 'github', link: 'https://github.com/xlhwkx/vben-nest-kit' },
    ],
    search: { provider: 'local' },
  },
  locales: {
    root: {
      label: '简体中文',
      lang: 'zh-CN',
      link: '/',
      themeConfig: {
        nav: [
          { text: '首页', link: '/' },
          { text: '架构', link: '/architecture' },
          { text: '部署', link: '/deploy' },
          { text: '智能体 Skill', link: '/skill' },
          { text: 'GitHub', link: 'https://github.com/xlhwkx/vben-nest-kit' },
        ],
        sidebar: [
          {
            text: '青栈',
            items: [
              { text: '首页', link: '/' },
              { text: '架构', link: '/architecture' },
              { text: '部署', link: '/deploy' },
              { text: '智能体 Skill', link: '/skill' },
              { text: '开源清单', link: '/open-source' },
            ],
          },
        ],
        footer: {
          message: 'MIT Licensed · 基于 Vue Vben Admin',
          copyright: '青栈 Qingzhan',
        },
      },
    },
    en: {
      label: 'English',
      lang: 'en-US',
      link: '/en/',
      themeConfig: {
        nav: [
          { text: 'Home', link: '/en/' },
          { text: 'Architecture', link: '/en/architecture' },
          { text: 'Deploy', link: '/en/deploy' },
          { text: 'Agent Skill', link: '/en/skill' },
          { text: 'GitHub', link: 'https://github.com/xlhwkx/vben-nest-kit' },
        ],
        sidebar: [
          {
            text: 'Qingzhan',
            items: [
              { text: 'Home', link: '/en/' },
              { text: 'Architecture', link: '/en/architecture' },
              { text: 'Deploy', link: '/en/deploy' },
              { text: 'Agent Skill', link: '/en/skill' },
              { text: 'Open-source checklist', link: '/en/open-source' },
            ],
          },
        ],
        footer: {
          message: 'MIT Licensed · Built on Vue Vben Admin',
          copyright: 'Qingzhan',
        },
      },
    },
  },
});
