import { Link } from 'react-router-dom';
import CodeBlock from '../components/CodeBlock';
import FeatureCard from '../components/FeatureCard';
import Notice from '../components/Notice';
import { BRAND } from '../nav';

const FEATURES = [
  { icon: '🛡️', title: '安全网守护', en: 'Safety-net guardian', body: 'dsh 进程崩溃后飞书仍会回复你，可进入仅核心安全模式自助重启；重启后自动恢复排队任务。' },
  { icon: '🧑‍💻', title: '多角色 Agent', en: 'Multi-role agents', body: '一个机器人绑定 PM / 开发 / 文档等角色，每个角色有持久化人设、模型偏好与规则。' },
  { icon: '🤝', title: '多机器人可信交接', en: 'Trusted multi-bot handoff', body: '每实例独立身份、服务、凭据与上下文；同群只接受登记 peer 的真实 @ 交接。' },
  { icon: '⚡', title: '并行多任务', en: 'Parallel tasks', body: '同一群里同时跑多个任务、会话隔离，不等号；每会话自动创建独立 git worktree。' },
  { icon: '🧾', title: '崩溃后任务对账', en: 'Crash-safe job ledger', body: '消息先持久落盘再入队，重启恢复排队项；/jobs 查看 checkpoint 并显式重试。' },
  { icon: '🗂️', title: '会话归档与保留', en: 'Archive & retention', body: '/archive、/retention 管理旧任务与自动保留策略，会话列表不越积越多。' },
  { icon: '📣', title: '跨会话通知 + @人', en: 'Cross-session notify', body: '任务完成主动推送到其他群 / 私聊并 @ 你。' },
  { icon: '📤', title: '通知转发到其他 IM', en: 'Forward to other IMs', body: '把完成 / 失败 / 审批 / 突发故障通知单向转发到 Telegram、企业微信等（纯通知，无入站交互）。' },
  { icon: '🎛️', title: 'dsh Web 可视化设置', en: 'Visual settings', body: '在官方 Settings → Plugins 查看与修改应用、workspace、模型、并行数与提醒。' },
  { icon: '🔑', title: '对话内模型 / 密钥管理', en: 'In-chat model & keys', body: '/model、/providers、/key 直接在聊天里查看、切换供应商、热更新密钥。' },
  { icon: '🎚️', title: '执行模式', en: 'Execution modes', body: '/mode 用双语卡片按会话选择快速 / 平衡 / 深度，下一轮生效且不打断当前任务。' },
  { icon: '📋', title: '关键任务计划门禁', en: 'Plan gate', body: '先发送完整计划，由卡片批准执行或带意见继续规划，原任务自动续跑。' },
];

export default function Home() {
  return (
    <div>
      <section className="bg-gradient-to-b from-white to-slate-50 border-b border-slate-200">
        <div className="max-w-6xl mx-auto px-4 sm:px-6 py-16">
          <div className="flex flex-wrap gap-2 mb-6">
            {['安全网守护', '扫码即用', '并行任务', '多角色 Agent', '通知转发到其他 IM', 'AGPL-3.0 可自托管'].map((b) => (
              <span key={b} className="rounded-full border border-brand-200 bg-brand-50 px-3 py-1 text-xs font-medium text-brand-700">{b}</span>
            ))}
          </div>
          <h1 className="text-4xl sm:text-5xl font-extrabold text-slate-900 leading-tight">
            把 DeepSeek Harness 装进飞书 / Lark<br className="hidden sm:block" /> <span className="text-brand-600">扫码即用</span>
          </h1>
          <p className="mt-4 max-w-2xl text-lg text-slate-600">
            在手机飞书里指挥本机 coding agent：发消息就收流式卡片与工具调用过程；bot 卡片按每位读者语言显示中文 / English。任务完成、失败、审批等待与突发故障，还能一键转发到 Telegram / 企业微信等常用 IM（纯通知）。
          </p>
          <div className="mt-6 flex flex-wrap gap-3">
            <Link to="/docs/quickstart" className="rounded-lg bg-brand-600 px-5 py-2.5 text-white font-medium hover:bg-brand-700 transition-colors">快速开始</Link>
            <a href={BRAND.repo} className="rounded-lg border border-slate-300 bg-white px-5 py-2.5 text-slate-800 font-medium hover:bg-slate-100 transition-colors">GitHub 仓库</a>
          </div>
          <div className="mt-8 max-w-xl">
            <CodeBlock title="一键安装" code="npx dsh-lark-bot@latest setup --profile dsh-lark" />
            <p className="mt-2 text-sm text-slate-500">然后 <code className="text-pink-600">dsh --profile dsh-lark</code> 启动，用飞书 App 扫码绑定。</p>
          </div>
        </div>
      </section>

      <section className="max-w-6xl mx-auto px-4 sm:px-6 py-12">
        <h2 className="text-2xl font-bold text-slate-900 mb-6">核心能力</h2>
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {FEATURES.map((f) => (
            <FeatureCard key={f.title} icon={f.icon} title={f.title} en={f.en}>{f.body}</FeatureCard>
          ))}
        </div>
      </section>

      <section className="max-w-3xl mx-auto px-4 sm:px-6 pb-16">
        <Notice variant="warn">
          <strong>官方渠道声明：</strong>唯一官方仓库是 <a href={BRAND.repo}>github.com/PlutoKeating/dsh-lark-bot</a>；唯一官方 npm 包是 <code>dsh-lark-bot</code> / <code>dsh-feishu-bot</code>（维护者 <code>plutokeating</code>）。本项目从不提供 .exe 或“下载即运行”的安装包，任何以此名义分发的页面 / 仓库均为假冒来源。
        </Notice>
        <div className="mt-8">
          <h2 className="text-xl font-bold text-slate-900 mb-3">浏览文档</h2>
          <ul className="space-y-1.5">
            <li><Link className="text-brand-600" to="/docs/quickstart">快速开始</Link> — 安装、扫码绑定、群聊 @bot</li>
            <li><Link className="text-brand-600" to="/docs/features">核心功能</Link> — 十二项能力详解</li>
            <li><Link className="text-brand-600" to="/docs/commands">命令速览</Link> — 全部 / 命令</li>
            <li><Link className="text-brand-600" to="/docs/notification-sinks">通知转发到其他 IM</Link> — Telegram / 企业微信纯通知配置</li>
            <li><Link className="text-brand-600" to="/docs/configuration">配置</Link> — 环境变量 / profile / Web 设置</li>
            <li><Link className="text-brand-600" to="/docs/security">安全与权限</Link> — 白名单、密钥、假冒警示</li>
            <li><Link className="text-brand-600" to="/docs/troubleshooting">排障与 FAQ</Link> — 诊断 / 常见问题</li>
          </ul>
        </div>
      </section>
    </div>
  );
}
