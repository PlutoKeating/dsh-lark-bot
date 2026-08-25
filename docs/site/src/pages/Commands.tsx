import PageShell from '../components/PageShell';

interface Row { cmd: string; zh: string; }

const GROUPS: { title: string; rows: Row[] }[] = [
  {
    title: '会话与工作区',
    rows: [
      { cmd: '`/new` `/reset`', zh: '开始新会话（当前 workspace）' },
      { cmd: '`/cd <path>`', zh: '切换到该目录的独立会话' },
      { cmd: '`/ws list|save|use|remove`', zh: '管理命名工作空间' },
      { cmd: '`/session [current|bind]`', zh: '浏览 / 显式绑定 DSH session' },
      { cmd: '`/resume`', zh: '查看当前会话最近上下文' },
      { cmd: '`/newg <群名>`', zh: '自动新建群聊并开新会话' },
    ],
  },
  {
    title: '任务与运行',
    rows: [
      { cmd: '`/status`', zh: '可刷新状态卡（工作区 / 模型 / run / token / 账本）' },
      { cmd: '`/jobs [list|show|retry]`', zh: '对账并重试排队 / 运行 / 失败 / 中断任务' },
      { cmd: '`/stop`', zh: '终止当前任务' },
      { cmd: '`/timeout [N|off|default]`', zh: '查看或设置空闲超时' },
      { cmd: '`/concurrency [N|default]`', zh: '查看或设置 scope 并行数' },
      { cmd: '`/mode`（`/effort`）', zh: '选择快速 / 平衡 / 深度执行强度' },
      { cmd: '`/density [compact|standard|detailed]`', zh: '卡片密度' },
    ],
  },
  {
    title: '通知与通讯',
    rows: [
      { cmd: '`/notify <scope|chatId> <text>`', zh: '跨会话发送通知（管理员）' },
      { cmd: '`/notify list`', zh: '查看已注册 scope' },
      { cmd: '`/notifications [show|off|default|on …]`', zh: '配置完成 / 失败 / 审批（含 urgent）提醒，支持 `sinks=` 转发到其他 IM' },
      { cmd: '`/channels [list|show|add|remove|enable|disable …]`', zh: '管理出站通知渠道（管理员，Telegram / wecom 等）' },
      { cmd: '`/replies [show|default|set …]`', zh: '回复合并、频率与近似去重' },
      { cmd: '`/ask <问题>`', zh: '发送结构化问答卡' },
    ],
  },
  {
    title: '模型 / Provider / 凭据',
    rows: [
      { cmd: '`/config`', zh: '模型 / Provider / 凭据管理卡片' },
      { cmd: '`/model [use|default|add|remove|list]`', zh: '查询与管理模型' },
      { cmd: '`/providers` `/provider [add|update|remove]`', zh: '查询与管理 provider' },
      { cmd: '`/key [list|set|remove]`', zh: '管理 dsh 凭据引用' },
      { cmd: '`/secret [status|set|remove]`', zh: '安全采集或删除密钥（管理员）' },
    ],
  },
  {
    title: '策略 / 隔离 / 角色',
    rows: [
      { cmd: '`/permission [ask|allow|deny] [scope]`', zh: '工具权限策略' },
      { cmd: '`/isolation [group|topic|member]`', zh: '群会话隔离（设置需管理员）' },
      { cmd: '`/role list|show|set|save|remove|clear`', zh: '查看 / 管理角色' },
      { cmd: '`/invite user|admin|group <id>`', zh: '管理访问白名单' },
      { cmd: '`/language [show|set|reset]`', zh: '默认语言策略' },
    ],
  },
  {
    title: '维护 / 诊断 / 更新',
    rows: [
      { cmd: '`/archive [note|send|list|clean]`', zh: '管理归档并上传 / 转发 / 清理' },
      { cmd: '`/retention [N|default]`', zh: '会话保留条数' },
      { cmd: '`/doctor`', zh: '生成脱敏诊断包（管理员）' },
      { cmd: '`/version`', zh: '当前版本与最新版本' },
      { cmd: '`/upgrade`', zh: '检查并确认自更新（管理员）' },
      { cmd: '`/help`', zh: '查看命令清单' },
    ],
  },
];

export default function Commands() {
  return (
    <PageShell title="命令速览" subtitle="命令帮助、状态与卡片均中英文；/help 为全量权威清单，全部详见 docs/MANUAL.md。">
      {GROUPS.map((group) => (
        <section key={group.title}>
          <h2>{group.title}</h2>
          <table className="w-full text-sm border-collapse my-4">
            <thead>
              <tr>
                <th className="text-left font-medium text-slate-500 pb-2 pr-4 w-64">命令</th>
                <th className="text-left font-medium text-slate-500 pb-2">作用</th>
              </tr>
            </thead>
            <tbody>
              {group.rows.map((row) => (
                <tr key={row.cmd} className="border-t border-slate-100">
                  <td className="py-2 pr-4 align-top"><span dangerouslySetInnerHTML={{ __html: row.cmd }} /></td>
                  <td className="py-2 text-slate-600">{row.zh}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>
      ))}
    </PageShell>
  );
}
