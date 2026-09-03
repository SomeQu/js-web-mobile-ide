// packages/ai-assistant/src/providers/codex.ts

import type { Message, ContentPart, ToolDefinition, StreamDelta } from "../types.js";
import type { IProvider } from "../provider.js";

export interface CodexProviderOptions {
  apiKey: string;
}

export class CodexProvider implements IProvider {
  readonly name = "codex";
  private _apiKey: string;

  constructor(options: CodexProviderOptions) {
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
    const openaiMessages: Record<string, unknown>[] = [];

    if (params.system) {
      openaiMessages.push({ role: "system", content: params.system });
    }

    for (const msg of params.messages) {
      if (msg.role === "user") {
        const toolResults = msg.content.filter(
          (p): p is Extract<ContentPart, { type: "tool_result" }> => p.type === "tool_result",
        );
        if (toolResults.length > 0) {
          for (const tr of toolResults) {
            openaiMessages.push({
              role: "tool",
              tool_call_id: tr.tool_use_id,
              content: tr.content,
            });
          }
        } else {
          const textParts = msg.content.filter(
            (p): p is Extract<ContentPart, { type: "text" }> => p.type === "text",
          );
          openaiMessages.push({
            role: "user",
            content: textParts.map((p) => p.text).join("\n"),
          });
        }
      } else if (msg.role === "assistant") {
        const textParts = msg.content.filter(
          (p): p is Extract<ContentPart, { type: "text" }> => p.type === "text",
        );
        const toolUses = msg.content.filter(
          (p): p is Extract<ContentPart, { type: "tool_use" }> => p.type === "tool_use",
        );

        const entry: Record<string, unknown> = {
          role: "assistant",
          content: textParts.length > 0 ? textParts.map((p) => p.text).join("\n") : null,
        };

        if (toolUses.length > 0) {
          entry.tool_calls = toolUses.map((tu) => ({
            id: tu.id,
            type: "function",
            function: {
              name: tu.name,
              arguments: JSON.stringify(tu.input),
            },
          }));
        }

        openaiMessages.push(entry);
      }
    }

    const payload: Record<string, unknown> = {
      model: params.model,
      max_tokens: params.maxTokens ?? 4096,
      messages: openaiMessages,
      stream: params.stream,
    };

    if (params.stream) {
      payload.stream_options = { include_usage: true };
    }

    if (params.tools && params.tools.length > 0) {
      payload.tools = params.tools.map((t) => ({
        type: "function",
        function: {
          name: t.name,
          description: t.description,
          parameters: t.parameters,
        },
      }));
    }

    return {
      url: "https://api.openai.com/v1/chat/completions",
      headers: {
        Authorization: `Bearer ${this._apiKey}`,
        "content-type": "application/json",
      },
      body: JSON.stringify(payload),
    };
  }

  parseResponse(raw: string): Message {
    const data = JSON.parse(raw);
    const choice = data.choices[0];
    const msg = choice.message;
    const content: ContentPart[] = [];

    if (msg.content) {
      content.push({ type: "text", text: msg.content });
    }

    if (msg.tool_calls) {
      for (const tc of msg.tool_calls) {
        content.push({
          type: "tool_use",
          id: tc.id,
          name: tc.function.name,
          input: JSON.parse(tc.function.arguments),
        });
      }
    }

    return { role: "assistant", content };
  }

  parseStreamChunk(chunk: string): StreamDelta | null {
    if (chunk === "[DONE]") return null;

    let data: Record<string, unknown>;
    try {
      data = JSON.parse(chunk);
    } catch {
      return null;
    }

    const choices = data.choices as Array<Record<string, unknown>> | undefined;
    if (!choices || choices.length === 0) return null;

    const choice = choices[0];
    const delta = choice.delta as Record<string, unknown> | undefined;
    const finishReason = choice.finish_reason as string | null;

    if (finishReason) {
      return { type: "message_end", stop_reason: finishReason };
    }

    if (!delta) return null;

    if (delta.role === "assistant" && !delta.content && !delta.tool_calls) {
      return { type: "message_start" };
    }

    if (typeof delta.content === "string") {
      return { type: "text_delta", text: delta.content };
    }

    const toolCalls = delta.tool_calls as Array<Record<string, unknown>> | undefined;
    if (toolCalls && toolCalls.length > 0) {
      const tc = toolCalls[0];
      const fn = tc.function as Record<string, unknown> | undefined;
      if (tc.id && fn && fn.name) {
        return { type: "tool_use_start", id: tc.id as string, name: fn.name as string };
      }
      if (fn && typeof fn.arguments === "string" && fn.arguments.length > 0) {
        return { type: "tool_input_delta", id: "", delta: fn.arguments as string };
      }
    }

    return null;
  }
}
