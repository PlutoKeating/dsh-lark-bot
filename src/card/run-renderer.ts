import type { Block, FooterStatus, RunState, ToolEntry } from './run-state.js';
import type { CardDensity } from './density.js';

function markdown(content: string): object {
  return { tag: 'markdown', content };
}

function noteMd(content: string): object {
  return { tag: 'markdown', content, text_size: 'notation' };
}

function footerStatus(
  status: Exclude<FooterStatus, null>,
  state: RunState,
  now: number,
): object {
  let text =
    status === 'thinking'
      ? '🧠 正在思考'
      : status === 'tool_running'
        ? '🧰 正在调用工具'
        : '✍️ 正在输出';
  if (state.startedAtMs !== undefined) {
    const elapsed = Math.max(0, Math.round((now - state.startedAtMs) / 1000));
    text += ` ⏱ ${elapsed}s`;
  }
  if (state.lastActivityMs !== undefined) {
    const idle = Math.max(0, Math.round((now - state.lastActivityMs) / 1000));
    if (idle >= 60) text += ` · ⏸ 无响应 ${idle}s`;
  }
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

function stopButton(scope: string | undefined): object {
  return {
    tag: 'button',
    text: { tag: 'plain_text', content: '⏹ 终止' },
    type: 'danger',
    value: { cmd: 'stop', ...(scope ? { scope } : {}) },
  };
}

function textBlock(block: Extract<Block, { kind: 'text' }>): object {
  return markdown(block.content);
}

function toolBlock(tool: ToolEntry): object {
  const icon = tool.status === 'error' ? '⚠️' : tool.status === 'done' ? '✅' : '⏳';
  return markdown(`${icon} **${tool.name}**`);
}

function usageLine(state: RunState): string {
  if (!state.usage) return '';
  const parts: string[] = [];
  if (state.usage.inputTokens !== undefined) parts.push(`in ${state.usage.inputTokens}`);
  if (state.usage.outputTokens !== undefined) parts.push(`out ${state.usage.outputTokens}`);
  return parts.length ? `（tokens ${parts.join(' · ')}）` : '';
}

function ownerLine(state: RunState): object | undefined {
  return state.scopeOwner ? noteMd(`👤 成员隔离会话：${state.scopeOwner}`) : undefined;
}

function renderStandard(state: RunState, now: number): object {
  const elements: object[] = [];
  const owner = ownerLine(state);
  if (owner) elements.push(owner);

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
    if (block.kind === 'text') {
      elements.push(textBlock(block));
    } else if (block.tool.status !== 'done') {
      elements.push(toolBlock(block.tool));
    }
  }

  if (state.terminal === 'interrupted') {
    elements.push(noteMd('_⏹ 已被中断_'));
  } else if (state.terminal === 'idle_timeout') {
    elements.push(noteMd(`_⏱ ${state.idleTimeoutMinutes ?? 0} 分钟无响应，已自动终止_`));
  } else if (state.terminal === 'error' && state.errorMsg) {
    elements.push(noteMd(`⚠️ agent 失败：${state.errorMsg}`));
  } else if (state.terminal === 'done' && elements.length === 0) {
    elements.push(noteMd('_（未返回内容）_'));
  } else if (state.terminal === 'done') {
    const usage = usageLine(state);
    if (usage) elements.push(noteMd(usage));
  }

  if (state.terminal === 'running') {
    if (state.footer) elements.push(footerStatus(state.footer, state, now));
    elements.push(stopButton(state.actionScope));
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

function renderCompact(state: RunState, now: number): object {
  const elements: object[] = [];
  const owner = ownerLine(state);
  if (owner) elements.push(owner);
  elements.push(noteMd(summaryText(state)));
  if (state.terminal === 'running' && state.footer) {
    elements.push(footerStatus(state.footer, state, now));
  }
  if (state.terminal === 'running') {
    elements.push(stopButton(state.actionScope));
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

function renderDetailed(state: RunState, now: number): object {
  const elements: object[] = [];
  const owner = ownerLine(state);
  if (owner) elements.push(owner);

  if (state.reasoning.content) {
    elements.push(
      noteMd(
        state.reasoning.active
          ? '🧠 正在思考…'
          : `🧠 **思考过程**\n${state.reasoning.content.slice(0, 2000)}`,
      ),
    );
  }

  for (const block of state.blocks) {
    if (block.kind === 'text') {
      elements.push(textBlock(block));
      continue;
    }
    const tool = block.tool;
    const icon = tool.status === 'error' ? '⚠️' : tool.status === 'done' ? '✅' : '⏳';
    const lines = [`${icon} **${tool.name}**`];
    if (tool.input !== undefined && tool.input !== '') {
      lines.push(`输入：\`\`\`\n${safeJsonPreview(tool.input)}\n\`\`\``);
    }
    if (tool.output) {
      lines.push(`输出：${tool.output.slice(0, 500)}`);
    }
    elements.push(markdown(lines.join('\n')));
  }

  if (state.terminal === 'interrupted') {
    elements.push(noteMd('_⏹ 已被中断_'));
  } else if (state.terminal === 'idle_timeout') {
    elements.push(noteMd(`_⏱ ${state.idleTimeoutMinutes ?? 0} 分钟无响应，已自动终止_`));
  } else if (state.terminal === 'error' && state.errorMsg) {
    elements.push(noteMd(`⚠️ agent 失败：${state.errorMsg}`));
  } else if (state.terminal === 'done') {
    const usage = usageLine(state);
    if (usage) elements.push(noteMd(usage));
  }

  if (state.terminal === 'running') {
    if (state.footer) elements.push(footerStatus(state.footer, state, now));
    elements.push(stopButton(state.actionScope));
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

function safeJsonPreview(value: unknown): string {
  if (typeof value === 'string') return value.slice(0, 300);
  try {
    return JSON.stringify(value).slice(0, 300);
  } catch {
    return String(value).slice(0, 300);
  }
}

/** Render the run card at the requested density (compact / standard / detailed). */
export function renderCard(
  state: RunState,
  density: CardDensity = 'standard',
  now: number = Date.now(),
): object {
  if (density === 'compact') return renderCompact(state, now);
  if (density === 'detailed') return renderDetailed(state, now);
  return renderStandard(state, now);
}
