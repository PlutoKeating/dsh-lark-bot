import PageShell from '../components/PageShell';
import Notice from '../components/Notice';

export default function Security() {
  return (
    <PageShell title="安全与权限" subtitle="访问白名单、工具权限、密钥处理与官方渠道 / 假冒警示。">
      <h2>官方渠道声明</h2>
      <Notice variant="danger">
        <strong>仅认准官方渠道：</strong>唯一官方仓库 <a href="https://github.com/PlutoKeating/dsh-lark-bot">github.com/PlutoKeating/dsh-lark-bot</a>；唯一官方 npm 包 <code>dsh-lark-bot</code> / <code>dsh-feishu-bot</code>（维护者 <code>plutokeating</code>）。本项目<strong>从不提供 .exe 或“下载即运行”的安装包</strong>，任何以项目名义分发 exe 的页面 / 仓库均为假冒 / 恶意来源。安装唯一命令：<code>npx dsh-lark-bot@latest setup --profile dsh-lark</code>。
      </Notice>

      <h2>访问白名单</h2>
      <p><code>DSH_LARK_ACCESS_DEFAULT_DENY=1</code> 会在未配置 allowlist 时拒绝 DM 流量（fail closed）；管理员用 <code>/invite user|admin|group &lt;id&gt;</code> 管理白名单。群聊 / 话题默认只处理 <code>@</code> 消息。</p>

      <h2>工具权限与审批</h2>
      <p>每个 scope 的 <code>/permission</code> 策略（如 <code>ask|allow|deny</code>）统一执行；默认 <code>ask</code> 时低风险自省静默放行，高风险弹「允许执行一次 / 拒绝」卡。写入成功后才回执，失败回滚。</p>

      <h2>密钥与凭据</h2>
      <ul>
        <li>dsh 凭据（provider/模型）与飞书 app-secret 走现有安全收集流程（owner-only 表单），原始值不经过 prompt/session/jobs/archive/logger/diagnostics。</li>
        <li>出站通知渠道（Telegram / WeCom）凭据存于 <code>&lt;profile&gt;/notification-channels.json</code>（0600），<strong>从不回显</strong>，不进入日志 / 诊断包。</li>
        <li>本地 callback（<code>lark_notify</code> 等）走 127.0.0.1 + 每启动随机 token，不暴露公网。</li>
      </ul>

      <h2>计划门禁</h2>
      <p>较大或高风险动作先在批准前出完整计划；<code>deny</code> 优先于计划门禁，<code>allow</code> 不替代关键任务计划确认。</p>

      <h2>最小权限与安全网</h2>
      <p>安全网守护独立于 dsh 进程，只在「观察过 dsh 在线 且 心跳过期 / 无 dsh 进程」时接管飞书长连接（同 app 单长连接约束，dsh 在线时守护必须静默）。</p>
    </PageShell>
  );
}
