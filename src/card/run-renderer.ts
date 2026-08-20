import type { FooterStatus, RunState, ToolEntry } from './run-state.js';
import type { CardDensity } from './density.js';
import { localizedCard, type CardLocale } from './i18n.js';

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
  locale: CardLocale,
): object {
  const zh = locale === 'zh_cn';
  let text =
    status === 'thinking'
      ? zh ? '🧠 正在思考' : '🧠 Thinking'
      : status === 'tool_running'
        ? zh ? '🧰 正在调用工具' : '🧰 Running tools'
        : zh ? '✍️ 正在输出' : '✍️ Responding';
  if (state.startedAtMs !== undefined) {
    const elapsed = Math.max(0, Math.round((now - state.startedAtMs) / 1000));
    text += ` ⏱ ${elapsed}s`;
  }
  if (state.lastActivityMs !== undefined) {
    const idle = Math.max(0, Math.round((now - state.lastActivityMs) / 1000));
    if (idle >= 60) text += zh ? ` · ⏸ 无响应 ${idle}s` : ` · ⏸ No activity for ${idle}s`;
  }
  return noteMd(text);
}

function summaryText(state: RunState, locale: CardLocale): string {
  const zh = locale === 'zh_cn';
  if (state.terminal === 'interrupted') return zh ? '已中断' : 'Interrupted';
  if (state.terminal === 'idle_timeout') return zh ? '已超时' : 'Timed out';
  if (state.terminal === 'error') return zh ? '出错' : 'Failed';
  if (state.terminal === 'done') return zh ? '已完成' : 'Completed';
  if (state.footer === 'tool_running') return zh ? '正在调用工具' : 'Running tools';
  if (state.footer === 'streaming') return zh ? '正在输出' : 'Responding';
  return zh ? '思考中' : 'Thinking';
}

function fallbackSummaryText(state: RunState, locale: CardLocale): string {
  const zh = locale === 'zh_cn';
  const parts = [summaryText(state, locale)];
  if (state.reasoning.content) parts.push(`${zh ? '思考' : 'Reasoning'}：${state.reasoning.content.slice(-240)}`);
  const tools = state.blocks.filter((block) => block.kind === 'tool').slice(-4);
  if (tools.length > 0) {
    parts.push(
      `${zh ? '工具' : 'Tools'}：${tools
        .map((block) => {
          const output = block.tool.output?.trim();
          return `${block.tool.name}(${block.tool.status})${output ? `=${output.slice(0, 80)}` : ''}`;
        })
        .join('、')}`,
    );
  }
  if (state.errorMsg) parts.push(`${zh ? '错误' : 'Error'}：${state.errorMsg}`);
  if (state.finalDeliveryError) parts.push(`${zh ? '最终回答发送失败' : 'Final answer delivery failed'}：${state.finalDeliveryError}`);
  return parts.join(' · ').slice(0, 500);
}

function stopButton(scope: string | undefined, locale: CardLocale): object {
  return {
    tag: 'button',
    text: { tag: 'plain_text', content: locale === 'zh_cn' ? '⏹ 终止' : '⏹ Stop' },
    type: 'danger',
    value: { cmd: 'stop', ...(scope ? { scope } : {}) },
  };
}

function toolBlock(tool: ToolEntry): object {
  const icon = tool.status === 'error' ? '⚠️' : tool.status === 'done' ? '✅' : '⏳';
  return markdown(`${icon} **${tool.name}**`);
}

function reasoningPreview(content: string, limit: number, locale: CardLocale): string {
  if (content.length <= limit) return content;
  const headLength = Math.floor(limit / 2);
  const tailLength = limit - headLength;
  return `${content.slice(0, headLength)}\n\n…\n\n_${locale === 'zh_cn' ? '最新进展' : 'Latest progress'}_\n${content.slice(-tailLength)}`;
}

function hasAnswer(state: RunState): boolean {
  return state.blocks.some((block) => block.kind === 'text' && block.content.trim() !== '');
}

function processElements(state: RunState, detailed: boolean, compact: boolean, locale: CardLocale): object[] {
  const zh = locale === 'zh_cn';
  const elements: object[] = [];
  if (state.reasoning.content) {
    elements.push(
      markdown(
        `🧠 **${zh ? '推理' : 'Reasoning'}**\n${reasoningPreview(state.reasoning.content, detailed ? 2000 : compact ? 240 : 500, locale)}`,
      ),
    );
  }
  for (const block of state.blocks) {
    if (block.kind !== 'tool') continue;
    const tool = block.tool;
    if (compact) {
      elements.push(toolBlock(tool));
      continue;
    }
    const icon = tool.status === 'error' ? '⚠️' : tool.status === 'done' ? '✅' : '⏳';
    const lines = [`${icon} **${tool.name}**`];
    if (detailed && tool.input !== undefined && tool.input !== '') {
      lines.push(`${zh ? '输入' : 'Input'}：\`\`\`\n${safeJsonPreview(tool.input)}\n\`\`\``);
    }
    if (tool.output) lines.push(`${zh ? '输出' : 'Output'}：${tool.output.slice(0, detailed ? 500 : 200)}`);
    elements.push(markdown(lines.join('\n')));
  }
  if (elements.length === 0) {
    elements.push(
      noteMd(state.terminal === 'running'
        ? zh ? '_等待推理或工具事件…_' : '_Waiting for reasoning or tool events…_'
        : zh ? '_没有可展示的推理或工具事件_' : '_No reasoning or tool events to display_'),
    );
  }
  return elements;
}

function thinkingPanel(state: RunState, detailed: boolean, compact: boolean, locale: CardLocale): object {
  return {
    tag: 'collapsible_panel',
    expanded: state.terminal === 'running',
    header: {
      title: { tag: 'plain_text', content: `🧠 ${locale === 'zh_cn' ? '思考过程' : 'Process'} · ${summaryText(state, locale)}` },
      icon: { tag: 'standard_icon', token: 'down-small-ccm_outlined' },
      icon_position: 'right',
      icon_expanded_angle: -180,
    },
    border: { color: 'grey', corner_radius: '6px' },
    elements: processElements(state, detailed, compact, locale),
  };
}

function compatibilityProcessSnapshot(state: RunState, locale: CardLocale): object {
  const zh = locale === 'zh_cn';
  const lines = [zh ? '_过程快照（兼容显示）_' : '_Process snapshot (compatibility view)_'];
  if (state.reasoning.content) {
    lines.push(`🧠 ${state.reasoning.content.slice(-300)}`);
  }
  const tools = state.blocks.filter((block) => block.kind === 'tool').slice(-3);
  for (const block of tools) {
    const output = block.tool.output?.trim();
    lines.push(
      `🧰 ${block.tool.name} · ${block.tool.status}${output ? `：${output.slice(-160)}` : ''}`,
    );
  }
  if (lines.length === 1) lines.push(state.terminal === 'running'
    ? zh ? '正在等待过程事件…' : 'Waiting for process events…'
    : zh ? '无过程事件' : 'No process events');
  return noteMd(lines.join('\n'));
}

function finalDeliveryFallback(state: RunState, locale: CardLocale): object | undefined {
  if (!state.finalDeliveryError || !state.finalDeliveryFallback) return undefined;
  return markdown(
    `⚠️ **${locale === 'zh_cn' ? '最终回答独立发送失败，已降级显示在此卡片' : 'Final answer delivery failed; showing it in this card'}**\n\n${state.finalDeliveryFallback}`,
  );
}

function usageLine(state: RunState): string {
  if (!state.usage) return '';
  const parts: string[] = [];
  if (state.usage.inputTokens !== undefined) parts.push(`in ${state.usage.inputTokens}`);
  if (state.usage.outputTokens !== undefined) parts.push(`out ${state.usage.outputTokens}`);
  return parts.length ? `（tokens ${parts.join(' · ')}）` : '';
}

function ownerLine(state: RunState, locale: CardLocale): object | undefined {
  return state.scopeOwner ? noteMd(`👤 ${locale === 'zh_cn' ? '成员隔离会话' : 'Member-isolated session'}：${state.scopeOwner}`) : undefined;
}

function renderStandard(state: RunState, now: number, locale: CardLocale): object {
  const zh = locale === 'zh_cn';
  const elements: object[] = [];
  const owner = ownerLine(state, locale);
  if (owner) elements.push(owner);

  elements.push(thinkingPanel(state, false, false, locale));
  elements.push(compatibilityProcessSnapshot(state, locale));

  if (state.terminal === 'interrupted') {
    elements.push(noteMd(zh ? '_⏹ 已被中断_' : '_⏹ Interrupted_'));
  } else if (state.terminal === 'idle_timeout') {
    elements.push(noteMd(zh ? `_⏱ ${state.idleTimeoutMinutes ?? 0} 分钟无响应，已自动终止_` : `_⏱ No response for ${state.idleTimeoutMinutes ?? 0} minutes; stopped automatically_`));
  } else if (state.terminal === 'error' && state.errorMsg) {
    elements.push(noteMd(`⚠️ ${zh ? 'agent 失败' : 'Agent failed'}：${state.errorMsg}`));
  } else if (
    state.terminal === 'done' &&
    !hasAnswer(state)
  ) {
    elements.push(noteMd(zh ? '_（未返回内容）_' : '_(No content returned)_'));
  } else if (state.terminal === 'done') {
    const usage = usageLine(state);
    if (usage) elements.push(noteMd(usage));
  }
  if (state.finalDeliveryError) {
    elements.push(noteMd(`⚠️ ${zh ? '最终回答发送失败' : 'Final answer delivery failed'}：${state.finalDeliveryError}`));
  }
  const fallback = finalDeliveryFallback(state, locale);
  if (fallback) elements.push(fallback);

  if (state.terminal === 'running') {
    if (state.footer) elements.push(footerStatus(state.footer, state, now, locale));
    elements.push(stopButton(state.actionScope, locale));
  }

  return {
    schema: '2.0',
    config: {
      streaming_mode: state.terminal === 'running',
      summary: { content: fallbackSummaryText(state, locale) },
    },
    body: { elements },
  };
}

function renderCompact(state: RunState, now: number, locale: CardLocale): object {
  const zh = locale === 'zh_cn';
  const elements: object[] = [];
  const owner = ownerLine(state, locale);
  if (owner) elements.push(owner);
  elements.push(noteMd(summaryText(state, locale)));
  elements.push(thinkingPanel(state, false, true, locale));
  elements.push(compatibilityProcessSnapshot(state, locale));
  if (state.finalDeliveryError) {
    elements.push(noteMd(`⚠️ ${zh ? '最终回答发送失败' : 'Final answer delivery failed'}：${state.finalDeliveryError}`));
  }
  const fallback = finalDeliveryFallback(state, locale);
  if (fallback) elements.push(fallback);
  if (state.terminal === 'done' && !hasAnswer(state)) elements.push(noteMd(zh ? '_（未返回内容）_' : '_(No content returned)_'));
  if (state.terminal === 'running' && state.footer) {
    elements.push(footerStatus(state.footer, state, now, locale));
  }
  if (state.terminal === 'running') {
    elements.push(stopButton(state.actionScope, locale));
  }
  return {
    schema: '2.0',
    config: {
      streaming_mode: state.terminal === 'running',
      summary: { content: fallbackSummaryText(state, locale) },
    },
    body: { elements },
  };
}

function renderDetailed(state: RunState, now: number, locale: CardLocale): object {
  const zh = locale === 'zh_cn';
  const elements: object[] = [];
  const owner = ownerLine(state, locale);
  if (owner) elements.push(owner);

  elements.push(thinkingPanel(state, true, false, locale));
  elements.push(compatibilityProcessSnapshot(state, locale));

  if (state.terminal === 'interrupted') {
    elements.push(noteMd(zh ? '_⏹ 已被中断_' : '_⏹ Interrupted_'));
  } else if (state.terminal === 'idle_timeout') {
    elements.push(noteMd(zh ? `_⏱ ${state.idleTimeoutMinutes ?? 0} 分钟无响应，已自动终止_` : `_⏱ No response for ${state.idleTimeoutMinutes ?? 0} minutes; stopped automatically_`));
  } else if (state.terminal === 'error' && state.errorMsg) {
    elements.push(noteMd(`⚠️ ${zh ? 'agent 失败' : 'Agent failed'}：${state.errorMsg}`));
  } else if (state.terminal === 'done') {
    const usage = usageLine(state);
    if (usage) elements.push(noteMd(usage));
    if (!hasAnswer(state)) elements.push(noteMd(zh ? '_（未返回内容）_' : '_(No content returned)_'));
  }
  if (state.finalDeliveryError) {
    elements.push(noteMd(`⚠️ ${zh ? '最终回答发送失败' : 'Final answer delivery failed'}：${state.finalDeliveryError}`));
  }
  const fallback = finalDeliveryFallback(state, locale);
  if (fallback) elements.push(fallback);

  if (state.terminal === 'running') {
    if (state.footer) elements.push(footerStatus(state.footer, state, now, locale));
    elements.push(stopButton(state.actionScope, locale));
  }

  return {
    schema: '2.0',
    config: {
      streaming_mode: state.terminal === 'running',
      summary: { content: fallbackSummaryText(state, locale) },
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
  const render = (locale: CardLocale): object => {
    if (density === 'compact') return renderCompact(state, now, locale);
    if (density === 'detailed') return renderDetailed(state, now, locale);
    return renderStandard(state, now, locale);
  };
  return localizeRenderedCard(render('zh_cn'), render('en_us'));
}

/** Plain schema-2.0 card used when the native collapsible component is rejected. */
export function renderLegacyCard(
  state: RunState,
  _density: CardDensity = 'standard',
  now: number = Date.now(),
): object {
  return localizeRenderedCard(
    renderLegacyVariant(state, now, 'zh_cn'),
    renderLegacyVariant(state, now, 'en_us'),
    true,
  );
}

function renderLegacyVariant(state: RunState, now: number, locale: CardLocale): object {
  const zh = locale === 'zh_cn';
  const elements: object[] = [];
  const owner = ownerLine(state, locale);
  if (owner) elements.push(owner);
  elements.push(compatibilityProcessSnapshot(state, locale));
  if (state.terminal === 'running') {
    const liveText = state.blocks
      .filter((block) => block.kind === 'text')
      .map((block) => block.content)
      .join('')
      .slice(-1000);
    if (liveText) elements.push(markdown(liveText));
    if (state.footer) elements.push(footerStatus(state.footer, state, now, locale));
    elements.push(stopButton(state.actionScope, locale));
  } else if (state.terminal === 'interrupted') {
    elements.push(noteMd(zh ? '_⏹ 已被中断_' : '_⏹ Interrupted_'));
  } else if (state.terminal === 'idle_timeout') {
    elements.push(noteMd(zh ? `_⏱ ${state.idleTimeoutMinutes ?? 0} 分钟无响应，已自动终止_` : `_⏱ No response for ${state.idleTimeoutMinutes ?? 0} minutes; stopped automatically_`));
  } else if (state.terminal === 'error' && state.errorMsg) {
    elements.push(noteMd(`⚠️ ${zh ? 'agent 失败' : 'Agent failed'}：${state.errorMsg}`));
  }
  if (state.finalDeliveryError) {
    elements.push(noteMd(`⚠️ ${zh ? '最终回答发送失败' : 'Final answer delivery failed'}：${state.finalDeliveryError}`));
  }
  const fallback = finalDeliveryFallback(state, locale);
  if (fallback) elements.push(fallback);
  return {
    schema: '2.0',
    config: {
      streaming_mode: state.terminal === 'running',
      summary: { content: fallbackSummaryText(state, locale) },
    },
    body: { elements },
  };
}

function localizeRenderedCard(
  zhCard: object,
  enCard: object,
  bilingualFallback = false,
): object {
  const zh = zhCard as { config: Record<string, unknown> & { summary: { content: string } }; body: Record<string, unknown> };
  const en = enCard as { config: Record<string, unknown> & { summary: { content: string } }; body: Record<string, unknown> };
  const { summary: _summary, ...config } = zh.config;
  return localizedCard({
    config,
    bilingualFallback,
    zhCn: { summary: zh.config.summary.content, body: zh.body },
    enUs: { summary: en.config.summary.content, body: en.body },
  });
}
