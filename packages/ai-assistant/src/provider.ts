// packages/ai-assistant/src/provider.ts

import type { Message, ToolDefinition, StreamDelta } from "./types.js";

export interface IProvider {
  readonly name: string;

  formatRequest(params: {
    messages: Message[];
    tools?: ToolDefinition[];
    model: string;
    maxTokens?: number;
    system?: string;
    stream: boolean;
  }): { url: string; headers: Record<string, string>; body: string };

  parseResponse(raw: string): Message;

  parseStreamChunk(chunk: string): StreamDelta | null;
}
