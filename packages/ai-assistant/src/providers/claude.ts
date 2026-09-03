// packages/ai-assistant/src/providers/claude.ts

import type { Message, ToolDefinition, StreamDelta } from "../types.js";
import type { IProvider } from "../provider.js";

export interface ClaudeProviderOptions {
  apiKey: string;
}

export class ClaudeProvider implements IProvider {
  readonly name = "claude";
  private _apiKey: string;

  constructor(options: ClaudeProviderOptions) {
    this._apiKey = options.apiKey;
  }

  formatRequest(params: {
    messages: Message[];
    tools?: ToolDefinition[];
    model: string;
    maxTokens?: number;
    system?: string;
    stream: boolean;
  }): { url: string; headers: Record<string, string>; body: string } {
    const payload: Record<string, unknown> = {
      model: params.model,
      max_tokens: params.maxTokens ?? 4096,
      messages: params.messages.map((m) => ({
        role: m.role,
        content: m.content,
      })),
      stream: params.stream,
    };

    if (params.system) {
      payload.system = params.system;
    }

    if (params.tools && params.tools.length > 0) {
      payload.tools = params.tools.map((t) => ({
        name: t.name,
        description: t.description,
        input_schema: t.parameters,
      }));
    }

    return {
      url: "https://api.anthropic.com/v1/messages",
      headers: {
        "x-api-key": this._apiKey,
        "anthropic-version": "2023-06-01",
        "content-type": "application/json",
      },
      body: JSON.stringify(payload),
    };
  }

  parseResponse(raw: string): Message {
    const data = JSON.parse(raw);
    return {
      role: "assistant",
      content: data.content.map((block: Record<string, unknown>) => {
        if (block.type === "text") {
          return { type: "text", text: block.text as string };
        }
        if (block.type === "tool_use") {
          return {
            type: "tool_use",
            id: block.id as string,
            name: block.name as string,
            input: block.input as Record<string, unknown>,
          };
        }
        return { type: "text", text: "" };
      }),
    };
  }

  parseStreamChunk(chunk: string): StreamDelta | null {
    if (chunk === "[DONE]") return null;

    let data: Record<string, unknown>;
    try {
      data = JSON.parse(chunk);
    } catch {
      return null;
    }

    const eventType = data.type as string;

    switch (eventType) {
      case "message_start":
        return { type: "message_start" };

      case "message_stop":
        return { type: "message_end", stop_reason: "end_turn" };

      case "message_delta": {
        const delta = data.delta as Record<string, unknown>;
        return { type: "message_end", stop_reason: (delta.stop_reason as string) || "end_turn" };
      }

      case "content_block_start": {
        const block = data.content_block as Record<string, unknown>;
        if (block.type === "tool_use") {
          return {
            type: "tool_use_start",
            id: block.id as string,
            name: block.name as string,
          };
        }
        return null;
      }

      case "content_block_delta": {
        const delta = data.delta as Record<string, unknown>;
        if (delta.type === "text_delta") {
          return { type: "text_delta", text: delta.text as string };
        }
        if (delta.type === "input_json_delta") {
          return { type: "tool_input_delta", id: "", delta: delta.partial_json as string };
        }
        return null;
      }

      case "content_block_stop":
        return { type: "tool_use_end", id: "" };

      default:
        return null;
    }
  }
}
