# runoob 投稿与反馈邮件模板（可直接发送）

> 背景：runoob 投稿页 `https://www.runoob.com/tougao` 当前不可用（Simditor 编辑器 CDN 404、
> `post_url` 为空），故改用邮件投稿。收件人：`admin@runoob.com`（官方联系邮箱）与
> `429240967@qq.com`（后台管理员邮箱，用于邀请码/反馈沟通）。

---

## 1. 投稿邮件（主要通道）

**主题：**【DeepSeek Harness 栏目投稿】DeepSeek Harness 连接飞书（dsh-lark-bot 桥接插件）

**正文：**

> 管理员您好：
>
> 我是一位开源项目作者，希望向贵站「DeepSeek Harness 教程」栏目投稿一篇原创教程：
> 《DeepSeek Harness 连接飞书（dsh-lark-bot 桥接插件）》。
>
> 文章内容：把 DeepSeek Harness（dsh）接入飞书 / Lark 的完整教程，包含前置条件、
> 一条命令安装、扫码绑定、常用命令表、六大核心能力（安全网守护 / 多角色 Agent / 并行任务 /
> 会话归档 / 跨会话通知 / 对话内模型密钥管理）、安全性说明、升级卸载与常见问题。
> 教程对应开源项目：https://github.com/PlutoKeating/dsh-lark-bot
>
> 投稿信息：
> - 昵称：dsh-lark-bot
> - E-Mail：<你的邮箱>
> - 引用地址：https://www.runoob.com/deepseek-harness/
>
> 全文已附上（Markdown 与 HTML 两个版本）。另外说明：贵站投稿页
> https://www.runoob.com/tougao 当前无法正常使用——富文本编辑器依赖的 CDN 资源返回 404，
> 且页面提交地址为空，点击「提交」无响应，详情见随附的 Bug 反馈。
>
> 期待回复，谢谢！

**附件：** `runoob-deepseek-harness-feishu-tutorial.md` 与
`runoob-deepseek-harness-feishu-tutorial.html`

---

## 2. Bug 反馈邮件（可单独发送，用于争取邀请码）

**主题：**【Bug 反馈】投稿页 /tougao 富文本编辑器无法加载、提交按钮无响应

**正文：**

> 管理员您好：
>
> 投稿页 https://www.runoob.com/tougao 存在两个问题，导致无法正常投稿，建议修复：
>
> 1. 富文本编辑器（Simditor）加载失败：页面引用的两个 CDN 资源返回 404——
>    - https://lf3-cdn-tos.bytecdntp.com/cdn/expire-1-M/simditor/2.3.6/lib/simditor.min.js
>    - https://lf9-cdn-tos.bytecdntp.com/cdn/expire-1-M/simditor/2.3.6/styles/simditor.min.css
>    结果是编辑器区域空白、无法输入正文（文章页使用的
>    https://static.char123.com/assets/simditor/2.3.6/scripts/simditor.min.js 可正常访问，
>    建议统一资源地址）。
> 2. 提交按钮无响应：页面脚本中 `var post_url = ""` 为空，点击「提交」后 AJAX 请求没有
>    目标地址，表单无法提交。
>
> 以上已实测复现（2026-08-17）。若修复需要协助复测，我可配合验证。谢谢！

---

## 3. 邀请码申请邮件（完成投稿或反馈被采纳后发送）

**主题：**【邀请码申请】已完成文章投稿 / 问题反馈

**正文：**

> 管理员您好：
>
> 按贵站「注册邀请码获取方式」说明，我已完成任务，申请内测邀请码：
>
> - 已完成：向贵站投稿原创文章《DeepSeek Harness 连接飞书（dsh-lark-bot 桥接插件）》
>   （2026-08-17 邮件发送）；并提交了 /tougao 投稿页无法使用的 Bug 反馈；
> - 昵称：dsh-lark-bot
> - E-Mail：<你的邮箱>
>
> 麻烦发我一个邀请码，谢谢！
