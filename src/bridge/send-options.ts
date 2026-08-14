export interface MentionTarget {
  /** Feishu/Lark open_id (`ou_…`) or user_id to mention. */
  userId: string;
  /** Optional display name rendered inside the `<at>` tag. */
  name?: string;
}

export interface SendOptions {
  replyTo?: string;
  /** Mentioned users; the channel prepends `<at>` markup to the body. */
  mentions?: MentionTarget[];
  /** Keep the reply inside a topic thread (Lark only). */
  threadId?: string;
}
