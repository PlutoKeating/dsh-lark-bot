import type { Block, FooterStatus, RunState, ToolEntry } from './run-state.js';

function markdown(content: string): object {
  return { tag: 'markdown', content };
}

function noteMd(content: string): object {
  return { tag: 'markdown', content, text_size: 'notation' };
}

function footerStatus(status: Exclude<FooterStatus, null>): object {
  const text =
    status === 'thinking'
      ? '🧠 正在思考'
      : status === 'tool_running'
        ? '🧰 正在调用工具'
        : '✍️ 正在输出';
  return noteMd(text);
}

function summaryText(state: RunState): string {
  if (state.terminal === 'interrupted') return '已中断';
  if (state.terminal === 'idle_timeout') return '已超时';
  if (state.terminal === 'error') return '出错';
  if (state.terminal === 'done') return '已完成';
  if (state.footer === 'tool_running') return '正在调用工具';
  if (state.footer === 'streaming') return '正在输出';
  return '思考中';
}

function stopButton(): object {
  return {
    tag: 'button',
    text: { tag: 'plain_text', content: '⏹ 终止' },
    type: 'danger',
    value: { cmd: 'stop' },
  };
}

function textBlock(block: Extract<Block, { kind: 'text' }>): object {
  return markdown(block.content);
}

function toolBlock(tool: ToolEntry): object {
  const icon = tool.status === 'error' ? '⚠️' : tool.status === 'done' ? '✅' : '⏳';
  return markdown(`${icon} **${tool.name}**`);
}

export function renderCard(state: RunState): object {
  const elements: object[] = [];

  if (state.reasoning.content) {
    elements.push(
      noteMd(
        state.reasoning.active
          ? '🧠 正在思考…'
          : `🧠 思考完成：${state.reasoning.content.slice(0, 300)}`,
      ),
    );
  }

  for (const block of state.blocks) {
    elements.push(block.kind === 'text' ? textBlock(block) : toolBlock(block.tool));
  }

  if (state.terminal === 'interrupted') {
    elements.push(noteMd('_⏹ 已被中断_'));
  } else if (state.terminal === 'idle_timeout') {
    elements.push(noteMd(`_⏱ ${state.idleTimeoutMinutes ?? 0} 分钟无响应，已自动终止_`));
  } else if (state.terminal === 'error' && state.errorMsg) {
    elements.push(noteMd(`⚠️ agent 失败：${state.errorMsg}`));
  } else if (state.terminal === 'done' && elements.length === 0) {
    elements.push(noteMd('_（未返回内容）_'));
  }

  if (state.terminal === 'running') {
    if (state.footer) elements.push(footerStatus(state.footer));
    elements.push(stopButton());
  }

  return {
    schema: '2.0',
    config: {
      streaming_mode: state.terminal === 'running',
      summary: { content: summaryText(state) },
    },
    body: { elements },
  };
}
