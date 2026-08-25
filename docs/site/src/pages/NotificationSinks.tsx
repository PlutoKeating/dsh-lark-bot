import PageShell from '../components/PageShell';
import CodeBlock from '../components/CodeBlock';
import Notice from '../components/Notice';

export default function NotificationSinks() {
  return (
    <PageShell title="通知转发到其他 IM（纯通知）" subtitle="把完成 / 失败 / 审批与突发故障通知，单向转发到 Telegram / 企业微信等常用 IM。飞书仍为唯一完整交互平台。">
      <h2>这是什么</h2>
      <p>
        有些用户不习惯使用飞书，日常更多用微信 / QQ / WhatsApp / Telegram 等自己的 IM。本项目<strong>不改变</strong>「飞书是唯一一等交互平台」的定位——这些用户不会在这些 IM 上指挥 agent，也不想把项目变成多平台 bot 框架；他们需要的只是：任务完成 / 失败 / 等待审批，或 agent 崩溃 / 突发状态时，能接到一条<strong>纯通知提醒</strong>。
      </p>
      <ul>
        <li><strong>转发事件与飞书内一致</strong>：任务完成、执行失败、等待审批，以及「突发 / 故障」类信息（安全网守护心跳异常、渠道断开重连、异常退出等）。</li>
        <li><strong>每个渠道只做推送、不做接收</strong>：不在这些 IM 上建立完整交互机器人（无命令、卡片、问答、会话管理、文件上传）。</li>
        <li><strong>飞书仍是唯一完整交互平台</strong>；其他 IM 只是通知接收端（notification sink）。</li>
      </ul>

      <h2>支持的平台</h2>
      <p>首期落地两个「官方、无状态、推送型」渠道（均为一条 HTTPS 出站 POST，几乎零成本接入）：</p>
      <table className="w-full text-sm border-collapse my-4">
        <thead>
          <tr>
            <th className="text-left font-medium text-slate-500 pb-2">渠道类型 <code>type</code></th>
            <th className="text-left font-medium text-slate-500 pb-2">接口</th>
            <th className="text-left font-medium text-slate-500 pb-2">destination / secret</th>
          </tr>
        </thead>
        <tbody>
          <tr className="border-t border-slate-100">
            <td className="py-2 pr-4"><code>telegram</code></td>
            <td className="py-2 pr-4">官方 Bot API <code>POST /bot&lt;token&gt;/sendMessage</code></td>
            <td className="py-2">destination = 目标 chat_id / @handle；secret = Bot token</td>
          </tr>
          <tr className="border-t border-slate-100">
            <td className="py-2 pr-4"><code>wecom</code></td>
            <td className="py-2 pr-4">企业微信 群机器人 webhook <code>POST …/webhook/send?key=&lt;key&gt;</code></td>
            <td className="py-2">destination = webhook key（与 secret 相同）</td>
          </tr>
        </tbody>
      </table>

      <h2>配置渠道</h2>
      <p>只有管理员可管理出站通知渠道（<code>/channels</code> 命令）。凭据写入 <code>&lt;profile&gt;/notification-channels.json</code>（0600），只被 bridge 读取，命令回显与 <code>/status</code> 一律只显示打码值。</p>
      <CodeBlock title="Telegram 渠道" code={`# telegram 的 --destination 是目标 chat_id/@handle，--secret 是 Bot token
/channels add telegram Ops --id tg-main --destination @my_ops_chat --secret 123456:ABCdef...`} />
      <CodeBlock title="企业微信（WeCom）群机器人" code={`# wecom 的 --destination 是群机器人 webhook key（与 --secret 相同，作为唯一凭据）
/channels add wecom Ops --id wecom-main --destination 1234-abcd-5678 --secret 1234-abcd-5678`} />
      <ul>
        <li><code>/channels list</code> — 查看已配置渠道（不显示凭据）。</li>
        <li><code>/channels show &lt;id&gt;</code> — 查看单个渠道（打码显示目标 / 密钥）。</li>
        <li><code>/channels enable &lt;id&gt;</code> / <code>/channels disable &lt;id&gt;</code> — 启用或停用。</li>
        <li><code>/channels remove &lt;id&gt;</code> — 删除。</li>
      </ul>
      <Notice variant="info">
        你也可以直接在 <code>&lt;profile&gt;/notification-channels.json</code> 中维护渠道（建议由管理员安全提供凭据，避免在群聊中明文输入）；只要文件保持 0600 且不进日志/诊断包即可。
      </Notice>

      <h2>让某个 scope 使用这些渠道</h2>
      <p>在 <code>/notifications on</code> 里用 <code>sinks=</code> 列出要一并转发的渠道 id（可为多个，用逗号分隔）；事件默认全选，也可用 <code>events=</code> 精确指定（含 <code>urgent</code>）。</p>
      <CodeBlock title="scope 开启并转发" code={`# 当前 scope：完成/失败/审批 提醒，转发到 tg-main 与 wecom-main，@ 自己，审批等待 10 分钟提醒
/notifications on current events=completed,failed,approval mentions=self sinks=tg-main,wecom-main remind=10

# 也接收突发/故障级飞书提醒（urgent 事件）
/notifications on current events=completed,failed,approval,urgent sinks=tg-main,wecom-main`} />
      <p><code>/notifications show</code> 查看当前配置；<code>/notifications off</code> 关闭；<code>/notifications default</code> 恢复 Web 默认值。</p>

      <h2>突发 / 故障通知</h2>
      <p>除了完成 / 失败 / 审批，本项目新增 <code>urgent</code> 事件。像「渠道重连、心跳异常、异常退出」这类突发 / 故障，会<strong>不管 scope 是否 opt-in</strong> 都广播到<strong>全部已启用渠道</strong>（安全网守护 / 重连 / 心跳异常的天然来源），保证你在任何 IM 上第一时间知道出事了。scope 显式开启 <code>urgent</code> 事件时，也会在飞书收到提醒。</p>

      <h2>安全与边界</h2>
      <ul>
        <li><strong>凭据不回显</strong>：只存于 0600 文件，从不出现在日志、卡片、<code>/channels</code>、<code>/status</code> 或诊断包。</li>
        <li><strong>纯通知</strong>：这些渠道<strong>不做任何入站</strong>——不实现命令、卡片 action、问答、审批或文件上传。</li>
        <li><strong>未配置时行为不变</strong>：不配置任何额外渠道、或偏好未列出 <code>sinks</code> 时，行为与现状完全一致。</li>
        <li><strong>飞书默认一等</strong>：飞书通知逻辑保持默认路径；其他 IM 只是同一通知事件的<strong>额外投递目标</strong>。</li>
        <li>回环回调 token 机制（<code>lark_notify</code>）不因新增渠道而弱化。</li>
      </ul>

      <h2>查看状态</h2>
      <p><code>/status</code> 状态卡会显示「出站渠道」一行，列出当前已启用的渠道 id（不含凭据）。</p>

      <h2>故障排查</h2>
      <ul>
        <li>收不到通知：先 <code>/channels list</code> 确认渠道已 <code>enable</code>；再用 <code>/notifications show</code> 确认 scope 的 <code>sinks=</code> 与该渠道 id 一致。</li>
        <li>channel 发送失败只记结构化日志（<code>sink:telegram</code> / <code>sink:wecom</code>），不会阻塞其他渠道，也不会污染飞书终态。</li>
        <li>单渠道 HTTP 有 10 秒超时；超时 / 非 2xx / 非 0 errcode 视为失败，但不会抛错中断。</li>
      </ul>
    </PageShell>
  );
}
