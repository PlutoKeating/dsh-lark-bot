export interface NavItem {
  to: string;
  title: string;
  en: string;
}

export const NAV_ITEMS: NavItem[] = [
  { to: '/', title: '首页', en: 'Home' },
  { to: '/docs/quickstart', title: '快速开始', en: 'Quick Start' },
  { to: '/docs/features', title: '核心功能', en: 'Features' },
  { to: '/docs/commands', title: '命令速览', en: 'Commands' },
  { to: '/docs/notification-sinks', title: '通知转发到其他 IM', en: 'Forward to other IMs' },
  { to: '/docs/configuration', title: '配置', en: 'Configuration' },
  { to: '/docs/security', title: '安全与权限', en: 'Security' },
  { to: '/docs/troubleshooting', title: '排障与 FAQ', en: 'Troubleshooting' },
];

export const BRAND = {
  name: 'dsh-lark-bot',
  zh: '把 DeepSeek Harness 装进飞书 / Lark',
  en: 'Bridge DeepSeek Harness into Feishu / Lark',
  npm: 'dsh-lark-bot / dsh-feishu-bot',
  repo: 'https://github.com/PlutoKeating/dsh-lark-bot',
  site: 'https://dsh-lark-bot.arr2018.dpdns.org',
};
