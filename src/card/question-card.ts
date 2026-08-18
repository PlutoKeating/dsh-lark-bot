export type QuestionKind = 'single' | 'multi' | 'text';

export interface QuestionCardInput {
  id: string;
  kind: QuestionKind;
  question: string;
  options?: string[];
  placeholder?: string;
  actionScope?: string;
}

function formElement(input: QuestionCardInput): object {
  if (input.kind === 'text') {
    return {
      tag: 'input',
      name: 'answer',
      placeholder: { tag: 'plain_text', content: input.placeholder ?? '请输入答案…' },
    };
  }
  const options = (input.options ?? []).map((option, index) => ({
    text: { tag: 'plain_text', content: option },
    value: `option-${index}`,
  }));
  if (input.kind === 'multi') {
    return {
      tag: 'multi_select_static',
      name: 'answer',
      placeholder: { tag: 'plain_text', content: '请选择（可多选）…' },
      options,
    };
  }
  return {
    tag: 'select_static',
    name: 'answer',
    placeholder: { tag: 'plain_text', content: '请选择…' },
    options,
  };
}

/**
 * Structured question card: single choice, multi choice, or free text.
 * The input/select and its submit button are wrapped in a `form` container —
 * schema 2.0 only returns the selected/filled value in the callback when the
 * interactive component lives inside a form with a submit-bound button.
 */
export function renderQuestionCard(input: QuestionCardInput): object {
  return {
    schema: '2.0',
    config: {
      summary: { content: '问题' },
    },
    body: {
      elements: [
        { tag: 'markdown', content: `❓ ${input.question}` },
        {
          tag: 'form',
          name: `form-${input.id}`,
          elements: [
            formElement(input),
            {
              tag: 'button',
              text: { tag: 'plain_text', content: '提交' },
              type: 'primary',
              value: {
                cmd: 'question-submit',
                id: input.id,
                ...(input.actionScope ? { scope: input.actionScope } : {}),
              },
              form_action_type: 'submit',
              name: `btn-submit-${input.id}`,
            },
          ],
        },
      ],
    },
  };
}

/**
 * Normalize a card action value into an answer for the question kind.
 * `answer` shapes: string (text / single select) or string[] (multi select).
 */
export function extractQuestionAnswer(
  kind: QuestionKind,
  value: unknown,
  options?: string[],
): string | string[] | undefined {
  const answer = value;
  if (kind === 'text') {
    return typeof answer === 'string' && answer.trim() ? answer.trim() : undefined;
  }
  const selected = Array.isArray(answer)
    ? answer.map((item) => String(item))
    : typeof answer === 'string' && answer
      ? [answer]
      : [];
  if (selected.length === 0) return undefined;
  const labels = options ?? [];
  const resolved = selected.map((item) => {
    const match = /^option-(\d+)$/.exec(item);
    if (match) {
      const index = Number(match[1]);
      return labels[index] ?? item;
    }
    return item;
  });
  return kind === 'single' ? resolved[0] : resolved;
}
