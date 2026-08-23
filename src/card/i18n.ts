export type CardLocale = 'zh_cn' | 'en_us';

interface CardVariant {
  summary: string;
  body: Record<string, unknown>;
  header?: Record<string, unknown>;
}

interface LocalizedCardInput {
  zhCn: CardVariant;
  enUs: CardVariant;
  config?: Record<string, unknown>;
  /** Make the protocol fallback readable when an old client ignores i18n. */
  bilingualFallback?: boolean;
}

/**
 * Build one Card JSON 2.0 payload whose chrome follows each viewer's client
 * language. The Chinese body/header remain the protocol fallback for clients
 * that do not advertise a supported locale.
 *
 * Callback payloads are deliberately checked here: translated buttons must
 * never route to different commands merely because their labels differ.
 */
export function localizedCard(input: LocalizedCardInput): object {
  const zhCallbacks = callbackValues(input.zhCn.body);
  const enCallbacks = callbackValues(input.enUs.body);
  if (JSON.stringify(zhCallbacks) !== JSON.stringify(enCallbacks)) {
    throw new Error('Localized card callback values must be identical');
  }

  const body = withV2CallbackBehaviors(
    localizeNode(input.zhCn.body, input.enUs.body, 'body', input.bilingualFallback === true),
  );
  const header = input.zhCn.header
    ? localizeNode(
        input.zhCn.header,
        input.enUs.header ?? input.zhCn.header,
        'header',
        input.bilingualFallback === true,
      )
    : undefined;

  return {
    schema: '2.0',
    config: {
      ...input.config,
      locales: ['zh_cn', 'en_us'],
      use_custom_translation: true,
      summary: {
        content: input.bilingualFallback
          ? bilingualMarkdown(input.zhCn.summary, input.enUs.summary)
          : input.zhCn.summary,
        i18n_content: {
          zh_cn: input.zhCn.summary,
          en_us: input.enUs.summary,
        },
      },
    },
    ...(header ? { header } : {}),
    body,
  };
}

/** Card JSON 2.0 routes button interactions through callback behaviors. */
function withV2CallbackBehaviors(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(withV2CallbackBehaviors);
  if (!value || typeof value !== 'object') return value;
  const source = value as Record<string, unknown>;
  const mapped = Object.fromEntries(
    Object.entries(source).map(([key, child]) => [key, withV2CallbackBehaviors(child)]),
  );
  if (source.tag !== 'button' || source.value === undefined) return mapped;
  const { value: callbackValue, ...button } = mapped;
  const behaviors = Array.isArray(button.behaviors) ? button.behaviors : [];
  return {
    ...button,
    behaviors: [
      ...behaviors,
      { type: 'callback', value: callbackValue },
    ],
  };
}

/** Plain-message fallback for surfaces where per-viewer locale is unavailable. */
export function bilingualMarkdown(zhCn: string, enUs: string, configured?: 'bilingual' | 'zh' | 'en'): string {
  const preference = configured ?? process.env.DSH_LARK_REPLY_LANG?.trim().toLowerCase();
  if (preference === 'zh') return zhCn;
  if (preference === 'en') return enUs;
  if (zhCn === enUs) return zhCn;
  return `${zhCn}\n\n---\n\n${enUs}`;
}

function callbackValues(value: unknown): unknown[] {
  const found: unknown[] = [];
  visit(value, found);
  return found;
}

function visit(value: unknown, found: unknown[]): void {
  if (Array.isArray(value)) {
    for (const item of value) visit(item, found);
    return;
  }
  if (!value || typeof value !== 'object') return;
  const record = value as Record<string, unknown>;
  if (record.tag === 'button' && record.value !== undefined) {
    found.push(record.value);
  }
  for (const [key, child] of Object.entries(record)) {
    if (key !== 'value') visit(child, found);
  }
}

/**
 * Card JSON 2.0 has no whole-body locale switch. Custom translations belong
 * to each text-bearing component as `i18n_content`, so merge the two
 * structurally-identical render trees and reject unsupported divergence.
 */
function localizeNode(
  zhCn: unknown,
  enUs: unknown,
  path: string,
  bilingualFallback: boolean,
): unknown {
  if (Array.isArray(zhCn)) {
    if (!Array.isArray(enUs) || zhCn.length !== enUs.length) {
      throw new Error(`Localized card structure differs at ${path}`);
    }
    return zhCn.map((item, index) =>
      localizeNode(item, enUs[index], `${path}[${index}]`, bilingualFallback));
  }
  if (!zhCn || typeof zhCn !== 'object') {
    if (Object.is(zhCn, enUs)) return zhCn;
    throw new Error(`Localized card property differs outside text content at ${path}`);
  }
  if (!enUs || typeof enUs !== 'object' || Array.isArray(enUs)) {
    throw new Error(`Localized card structure differs at ${path}`);
  }

  const zhRecord = zhCn as Record<string, unknown>;
  const enRecord = enUs as Record<string, unknown>;
  if (JSON.stringify(Object.keys(zhRecord).sort()) !== JSON.stringify(Object.keys(enRecord).sort())) {
    throw new Error(`Localized card structure differs at ${path}`);
  }
  const merged: Record<string, unknown> = {};
  for (const [key, zhValue] of Object.entries(zhRecord)) {
    const enValue = enRecord[key];
    if (key === 'content' && typeof zhValue === 'string' && typeof enValue === 'string') {
      merged.content = bilingualFallback ? bilingualMarkdown(zhValue, enValue) : zhValue;
      merged.i18n_content = { zh_cn: zhValue, en_us: enValue };
      continue;
    }
    merged[key] = localizeNode(zhValue, enValue, `${path}.${key}`, bilingualFallback);
  }
  return merged;
}
