import type { FooterStatus, RunState, ToolEntry } from './run-state.js';
import type { CardDensity } from './density.js';
import { localizedCard, type CardLocale } from './i18n.js';

// @larksuite/channel rolls over markdown at 30,000 characters to avoid
// Feishu 230099. Trim tool history against a smaller full-card budget.
const RUN_CARD_JSON_BUDGET = 28_000;
const MAX_VISIBLE_TOOL_CALLS = 40;

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
  const tools = state.blocks.filter((block) => block.kind === 'tool').slice(-4);
  if (tools.length > 0) {
    parts.push(
      `${zh ? '工具' : 'Tools'}：${tools
        .map((block) => `${block.tool.name}(${block.tool.status})`)
        .join('、')}`,
    );
  }
  if (state.terminal === 'error') parts.push(zh ? '详情见本机日志' : 'See local logs for details');
  if (state.finalDeliveryError) parts.push(zh ? '最终回答发送失败' : 'Final answer delivery failed');
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

function hasAnswer(state: RunState): boolean {
  return state.blocks.some((block) => block.kind === 'text' && block.content.trim() !== '');
}

function processElements(
  state: RunState,
  locale: CardLocale,
  maxTools: number,
): object[] {
  const zh = locale === 'zh_cn';
  const elements: object[] = [];
  const toolBlocks = state.blocks.filter((block) => block.kind === 'tool');
  const visibleTools = maxTools === 0 ? [] : toolBlocks.slice(-maxTools);
  const hiddenTools = toolBlocks.length - visibleTools.length;
  if (hiddenTools > 0) {
    elements.push(
      noteMd(zh
        ? `_已隐藏 ${hiddenTools} 个较早的工具调用，仅显示最新进展_`
        : `_Hidden ${hiddenTools} older tool calls; showing the latest progress_`),
    );
  }
  for (const block of visibleTools) {
    const tool = block.tool;
    elements.push(toolBlock(tool));
  }
  if (elements.length === 0) {
    elements.push(
      noteMd(state.terminal === 'running'
        ? zh ? '_正在处理请求…_' : '_Processing the request…_'
        : zh ? '_执行过程已结束_' : '_Execution finished_'),
    );
  }
  return elements;
}

function thinkingPanel(
  state: RunState,
  locale: CardLocale,
  maxTools: number,
): object {
  return {
    tag: 'collapsible_panel',
    expanded: state.terminal === 'running',
    header: {
      title: { tag: 'plain_text', content: `⚙️ ${locale === 'zh_cn' ? '执行过程' : 'Execution'} · ${summaryText(state, locale)}` },
      icon: { tag: 'standard_icon', token: 'down-small-ccm_outlined' },
      icon_position: 'right',
      icon_expanded_angle: -180,
    },
    border: { color: 'grey', corner_radius: '6px' },
    elements: processElements(state, locale, maxTools),
  };
}

function compatibilityProcessSnapshot(state: RunState, locale: CardLocale): object {
  const zh = locale === 'zh_cn';
  const lines = [zh ? '_执行状态（兼容显示）_' : '_Execution status (compatibility view)_'];
  const tools = state.blocks.filter((block) => block.kind === 'tool').slice(-3);
  for (const block of tools) {
    lines.push(`🧰 ${block.tool.name} · ${block.tool.status}`);
  }
  if (lines.length === 1) lines.push(state.terminal === 'running'
    ? zh ? '正在处理请求…' : 'Processing the request…'
    : zh ? '执行过程已结束' : 'Execution finished');
  return noteMd(lines.join('\n'));
}

function runFailureLine(locale: CardLocale): object {
  return noteMd(locale === 'zh_cn'
    ? '⚠️ Agent 运行失败。可重试；底层详情仅保留在本机日志中。'
    : '⚠️ The agent run failed. Retry it or inspect the local logs for details.');
}

function finalDeliveryFailureLine(locale: CardLocale): object {
  return noteMd(locale === 'zh_cn'
    ? '⚠️ 最终回答发送失败，已尝试在本卡片中显示。'
    : '⚠️ Final-answer delivery failed; the answer is shown in this card when available.');
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

function renderStandard(
  state: RunState,
  now: number,
  locale: CardLocale,
  maxTools: number,
): object {
  const zh = locale === 'zh_cn';
  const elements: object[] = [];
  const owner = ownerLine(state, locale);
  if (owner) elements.push(owner);

  elements.push(thinkingPanel(state, locale, maxTools));
  elements.push(compatibilityProcessSnapshot(state, locale));

  if (state.terminal === 'interrupted') {
    elements.push(noteMd(zh ? '_⏹ 已被中断_' : '_⏹ Interrupted_'));
  } else if (state.terminal === 'idle_timeout') {
    elements.push(noteMd(zh ? `_⏱ ${state.idleTimeoutMinutes ?? 0} 分钟无响应，已自动终止_` : `_⏱ No response for ${state.idleTimeoutMinutes ?? 0} minutes; stopped automatically_`));
  } else if (state.terminal === 'error') {
    elements.push(runFailureLine(locale));
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
    elements.push(finalDeliveryFailureLine(locale));
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

function renderCompact(
  state: RunState,
  now: number,
  locale: CardLocale,
  maxTools: number,
): object {
  const zh = locale === 'zh_cn';
  const elements: object[] = [];
  const owner = ownerLine(state, locale);
  if (owner) elements.push(owner);
  elements.push(noteMd(summaryText(state, locale)));
  elements.push(thinkingPanel(state, locale, maxTools));
  elements.push(compatibilityProcessSnapshot(state, locale));
  if (state.terminal === 'error') {
    elements.push(runFailureLine(locale));
  }
  if (state.finalDeliveryError) {
    elements.push(finalDeliveryFailureLine(locale));
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

function renderDetailed(
  state: RunState,
  now: number,
  locale: CardLocale,
  maxTools: number,
): object {
  const zh = locale === 'zh_cn';
  const elements: object[] = [];
  const owner = ownerLine(state, locale);
  if (owner) elements.push(owner);

  elements.push(thinkingPanel(state, locale, maxTools));
  elements.push(compatibilityProcessSnapshot(state, locale));

  if (state.terminal === 'interrupted') {
    elements.push(noteMd(zh ? '_⏹ 已被中断_' : '_⏹ Interrupted_'));
  } else if (state.terminal === 'idle_timeout') {
    elements.push(noteMd(zh ? `_⏱ ${state.idleTimeoutMinutes ?? 0} 分钟无响应，已自动终止_` : `_⏱ No response for ${state.idleTimeoutMinutes ?? 0} minutes; stopped automatically_`));
  } else if (state.terminal === 'error') {
    elements.push(runFailureLine(locale));
  } else if (state.terminal === 'done') {
    const usage = usageLine(state);
    if (usage) elements.push(noteMd(usage));
    if (!hasAnswer(state)) elements.push(noteMd(zh ? '_（未返回内容）_' : '_(No content returned)_'));
  }
  if (state.finalDeliveryError) {
    elements.push(finalDeliveryFailureLine(locale));
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

/** Render the run card at the requested density (compact / standard / detailed). */
export function renderCard(
  state: RunState,
  density: CardDensity = 'standard',
  now: number = Date.now(),
): object {
  const render = (locale: CardLocale, maxTools: number): object => {
    if (density === 'compact') return renderCompact(state, now, locale, maxTools);
    if (density === 'detailed') return renderDetailed(state, now, locale, maxTools);
    return renderStandard(state, now, locale, maxTools);
  };
  const renderWithToolLimit = (maxTools: number): object =>
    localizeRenderedCard(render('zh_cn', maxTools), render('en_us', maxTools));
  const toolCount = state.blocks.filter((block) => block.kind === 'tool').length;
  const initialLimit = Math.min(toolCount, MAX_VISIBLE_TOOL_CALLS);
  const initialCard = renderWithToolLimit(initialLimit);
  if (JSON.stringify(initialCard).length <= RUN_CARD_JSON_BUDGET) return initialCard;

  let low = 0;
  let high = initialLimit - 1;
  let best = renderWithToolLimit(0);
  while (low <= high) {
    const middle = Math.floor((low + high) / 2);
    const candidate = renderWithToolLimit(middle);
    if (JSON.stringify(candidate).length <= RUN_CARD_JSON_BUDGET) {
      best = candidate;
      low = middle + 1;
    } else {
      high = middle - 1;
    }
  }
  return best;
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
    if (state.footer) elements.push(footerStatus(state.footer, state, now, locale));
    elements.push(stopButton(state.actionScope, locale));
  } else if (state.terminal === 'interrupted') {
    elements.push(noteMd(zh ? '_⏹ 已被中断_' : '_⏹ Interrupted_'));
  } else if (state.terminal === 'idle_timeout') {
    elements.push(noteMd(zh ? `_⏱ ${state.idleTimeoutMinutes ?? 0} 分钟无响应，已自动终止_` : `_⏱ No response for ${state.idleTimeoutMinutes ?? 0} minutes; stopped automatically_`));
  } else if (state.terminal === 'error') {
    elements.push(runFailureLine(locale));
  }
  if (state.finalDeliveryError) {
    elements.push(finalDeliveryFailureLine(locale));
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
