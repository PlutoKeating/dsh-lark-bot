import PageShell from '../components/PageShell';
import CodeBlock from '../components/CodeBlock';
import Notice from '../components/Notice';

export default function QuickStart() {
  return (
    <PageShell title="快速开始" subtitle="3 步把 DeepSeek Harness 接入飞书 / Lark，扫码即用。">
      <h2>前置要求</h2>
      <ul>
        <li>Node.js ≥ 22</li>
        <li>已安装 DeepSeek Harness（<code>dsh</code>）并配置 <code>DEEPSEEK_API_KEY</code></li>
        <li>飞书 / Lark 手机 App（用于扫码绑定）</li>
      </ul>

      <h2>第 1 步：安装桥接插件</h2>
      <CodeBlock title="一条命令安装" code="npx dsh-lark-bot@latest setup --profile dsh-lark" />
      <p><code>setup</code> 会自动处理 pnpm 构建、注册为 dsh profile，并（默认）安装安全网守护。</p>

      <h2>第 2 步：启动并扫码绑定</h2>
      <CodeBlock title="启动" code="dsh --profile dsh-lark" />
      <p>终端会打印二维码，用飞书 / Lark App 扫码创建或选择 PersonalAgent 应用并绑定。</p>
      <Notice variant="info">
        交互卡片的按钮（计划门禁 / 审批 / 问答）需在飞书开放平台启用 <code>card.action.trigger</code> 回调并重新发布应用。
      </Notice>

      <h2>第 3 步：开始使用</h2>
      <ul>
        <li><strong>私聊</strong>：直接发消息，bot 会响应。</li>
        <li><strong>群聊 / 话题</strong>：默认需要 <code>@bot</code> 才会触发。</li>
        <li>可发送 <code>/help</code> 查看权威命令清单。</li>
      </ul>

      <h2>网络要求</h2>
      <p>不需要公网 IP、域名、服务器或内网穿透。飞书通道使用 WebSocket 长连接（出站），本机在 NAT 后面也能用，代码始终只在本机运行。</p>

      <h2>接下来</h2>
      <ul>
        <li>把通知转发到 Telegram / 企业微信等 IM：见 <a href="/docs/notification-sinks">通知转发到其他 IM</a>。</li>
        <li>常用命令：见 <a href="/docs/commands">命令速览</a>。</li>
        <li>环境变量与 profile 配置：见 <a href="/docs/configuration">配置</a>。</li>
      </ul>
    </PageShell>
  );
}
