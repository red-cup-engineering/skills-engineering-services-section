export interface ChatCompletionTurnInputSchema {
  readonly $schema: string;
  readonly $id: string;
  readonly type: "object";
  readonly required: readonly ["messages"];
  readonly properties: Readonly<Record<string, unknown>>;
  readonly additionalProperties: false;
}

export declare const CHAT_COMPLETION_TURN_INPUT_SCHEMA: ChatCompletionTurnInputSchema;
