import PageShell from '../components/PageShell';
import CodeBlock from '../components/CodeBlock';
import Notice from '../components/Notice';

export default function Configuration() {
  return (
    <PageShell title="配置" subtitle="环境变量、profile、dsh Web 可视化设置与出站通知渠道。">
      <h2>环境变量</h2>
      <p>运行时读取 <code>DSH_LARK_*</code> 变量并与 <code>~/.dsh-lark/config.json</code> 合并。完整模板见仓库 <code>.env.example</code>。常用项：</p>
      <CodeBlock title="核心配置" code={`# 应用凭据（优先首次扫码绑定，以下为自动化部署的覆盖项）
# DSH_LARK_APP_ID=
# DSH_LARK_APP_SECRET=
DSH_LARK_TENANT=feishu

# agent 后端模式：sdk（默认）| acp | headless | web
DSH_LARK_ADAPTER=sdk

# provider/model 路由
# DSH_LARK_PROVIDER=provider-id
# DSH_LARK_MODEL=model-id

# 默认主动提醒：off | completed(完成+失败) | all(+审批)
DSH_LARK_NOTIFICATION_DEFAULT=off

# 安全网守护心跳间隔（ms）
DSH_LARK_HEARTBEAT_MS=5000`} />
      <Notice variant="info">出站通知渠道（Telegram / wecom）<strong>不需要环境变量</strong>——在聊天里用管理员 <code>/channels</code> 配置，scope 用 <code>/notifications … sinks=&lt;id&gt;</code> 开启。凭据存于 0600 文件，永不回显。</Notice>

      <h2>Profile 与安装</h2>
      <CodeBlock title="安装与启动" code={`# 安装并注册为 dsh profile
npx dsh-lark-bot@latest setup --profile dsh-lark

# 启动并按 profile 管理
dsh --profile dsh-lark
dsh-lark-bot service install|start|status|logs|restart|stop|uninstall --profile dsh-lark`} />

      <h2>dsh Web 可视化设置</h2>
      <p>在官方 Settings → Plugins 页面（dsh Web）用浏览器卡片集中呈现应用、workspace、模型、并行数、adapter 与提醒默认值，并逐项标注「重连 / 下一任务生效」；诊断区直接检查脱敏 settings 快照。<code>/status</code> 与 <code>/doctor</code> 保留为运行态降级路径。</p>
      <p>密钥永不进入 Host → Web 响应；配置提交由官方 revision fence / 持久 provider 负责。</p>

      <h2>Scope 级覆盖</h2>
      <ul>
        <li><code>/concurrency</code>、<code>/notifications</code>、<code>/mode</code>、<code>/density</code>、<code>/replies</code> 等 scope 覆盖优先于 Web 默认。</li>
        <li>模型优先级：每会话 <code>/model use</code> &gt; 角色 &gt; profile &gt; dsh 默认 &gt; 环境。</li>
        <li>通知默认：无 override 时继承 profile 的 <code>notificationDefault</code>；<code>/notifications default</code> 删除 override 恢复继承。</li>
      </ul>

      <h2>目录与状态文件</h2>
      <p>默认根目录 <code>~/.dsh-lark/</code>，按 profile 存放：<code>sessions.json</code>、<code>jobs.json</code>、<code>scopes.json</code>、<code>roles.json</code>、<code>permission-policies.json</code>、<code>notification-preferences.json</code>、<code>notification-channels.json</code>（0600）、<code>archives/</code>、<code>logs/</code> 等。</p>
    </PageShell>
  );
}
