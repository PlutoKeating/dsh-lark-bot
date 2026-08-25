import PageShell from '../components/PageShell';

export default function Troubleshooting() {
  return (
    <PageShell title="排障与 FAQ" subtitle="诊断命令、常用问题与快速定位。">
      <h2>诊断与状态</h2>
      <ul>
        <li><code>/status</code> — 可刷新状态卡，查看工作区、模型、run、token 用量、任务账本与「出站渠道」。</li>
        <li><code>/doctor</code>（管理员）— 生成脱敏诊断包并作为文件发送，内容排除消息正文 / transcript / 凭据。</li>
        <li><code>dsh-lark-bot doctor</code> / <code>service status</code> / <code>guardian status</code> — 终端侧区分「引擎进程活着」与「飞书通道可用」。</li>
      </ul>

      <h2>常见问题</h2>
      <h3>DeepSeek Harness 怎么接入飞书？</h3>
      <p>见<a href="/docs/quickstart">快速开始</a>：一条命令安装 + 扫码绑定，全程不需要公网服务器、域名或内网穿透。</p>

      <h3>需要公网 IP 或服务器吗？</h3>
      <p>不需要。飞书通道使用 WebSocket 长连接（出站），NAT 后面也能用，代码始终只在本机运行，飞书只传输消息。</p>

      <h3>dsh 崩溃了怎么办？</h3>
      <p>默认安装的安全网守护会接管飞书通道，发 <code>/safemode</code> 进入仅核心安全模式自愈，<code>/safemode exit</code> 恢复完整 profile。任务账本会在出站通道就绪后安全标为 <code>interrupted</code>，用 <code>/jobs</code> 对账并显式重试。</p>

      <h3>收不到转发到 Telegram / 企业微信的通知？</h3>
      <p>先 <code>/channels list</code> 确认渠道已 <code>enable</code>；再用 <code>/notifications show</code> 确认 scope 的 <code>sinks=</code> 与渠道 id 一致。渠道发送失败只记结构化日志，不阻塞其他渠道。</p>

      <h3>怎么确认下载的是正版？</h3>
      <p>只从 github.com/PlutoKeating/dsh-lark-bot 与 npm（dsh-lark-bot / dsh-feishu-bot）获取；凡提供 exe 的渠道均为假冒。</p>

      <h3>为什么说功能最全？</h3>
      <p>十二项组合为一：安全网守护、多角色、多机器人可信交接、并行任务、崩溃任务对账、会话归档、跨会话通知、通知转发到其他 IM、dsh Web 可视化设置、对话内模型 / 密钥管理、执行模式、计划门禁与飞书内自更新。</p>

      <h2>更多资料</h2>
      <ul>
        <li>完整文档：仓库 <code>docs/</code>（README / MANUAL / FEATURES / API / ARCHITECTURE）。</li>
        <li>用户手册：<code>docs/MANUAL.md</code>。</li>
        <li>架构决策：<code>docs/ARCHITECTURE.md</code>（含关键决策 18：出站通知渠道）。</li>
      </ul>
    </PageShell>
  );
}
