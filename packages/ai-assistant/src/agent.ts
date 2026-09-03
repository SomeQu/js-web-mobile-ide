// packages/ai-assistant/src/agent.ts

import type {
  Message,
  ContentPart,
  StreamDelta,
  AgentOptions,
  AgentCallbacks,
  ToolExecutor,
  ToolDefinition,
} from "./types.js";
import type { IProvider } from "./provider.js";
import type { IHttpTransport } from "./transport.js";

function abortError(): Error {
  const err = new Error("Aborted");
  (err as any).code = "ABORT";
  return err;
}

export class Agent {
  private _provider: IProvider;
  private _transport: IHttpTransport;
  private _model: string;
  private _system?: string;
  private _tools?: ToolDefinition[];
  private _maxTokens?: number;
  private _maxTurns: number;
  private _aborted = false;
  private _abortReject: ((err: Error) => void) | null = null;

  constructor(options: AgentOptions) {
    this._provider = options.provider;
    this._transport = options.transport;
    this._model = options.model;
    this._system = options.system;
    this._tools = options.tools;
    this._maxTokens = options.maxTokens;
    this._maxTurns = options.maxTurns ?? 20;
  }

  async run(
    messages: Message[],
    executor: ToolExecutor,
    callbacks?: AgentCallbacks,
  ): Promise<Message[]> {
    const history = [...messages];
    let turns = 0;

    while (turns < this._maxTurns) {
      if (this._aborted) {
        throw abortError();
      }

      turns++;

      const assistantMessage = await this._streamTurn(history, callbacks);
      history.push(assistantMessage);

      if (callbacks?.onTurnComplete) {
        callbacks.onTurnComplete(assistantMessage);
      }

      const toolUses = assistantMessage.content.filter(
        (p): p is Extract<ContentPart, { type: "tool_use" }> => p.type === "tool_use",
      );

      if (toolUses.length === 0) {
        return history;
      }

      const toolResults: ContentPart[] = [];
      for (const tu of toolUses) {
        if (callbacks?.onToolStart) {
          callbacks.onToolStart(tu.id, tu.name);
        }

        let result: string;
        let isError = false;
        try {
          result = await executor(tu.name, tu.input);
        } catch (err) {
          result = err instanceof Error ? err.message : String(err);
          isError = true;
        }

        if (callbacks?.onToolEnd) {
          callbacks.onToolEnd(tu.id, result);
        }

        toolResults.push({
          type: "tool_result",
          tool_use_id: tu.id,
          content: result,
          ...(isError ? { is_error: true } : {}),
        });
      }

      history.push({ role: "user", content: toolResults });
    }

    return history;
  }

  abort(): void {
    this._aborted = true;
    if (this._abortReject) {
      this._abortReject(abortError());
    }
  }

  private async _streamTurn(
    messages: Message[],
    callbacks?: AgentCallbacks,
  ): Promise<Message> {
    const formatted = this._provider.formatRequest({
      messages,
      tools: this._tools,
      model: this._model,
      maxTokens: this._maxTokens,
      system: this._system,
      stream: true,
    });

    const content: ContentPart[] = [];
    let currentText = "";
    let currentToolId = "";
    let currentToolName = "";
    let currentToolInput = "";

    return new Promise<Message>((resolve, reject) => {
      this._abortReject = reject;

      if (this._aborted) {
        reject(abortError());
        return;
      }

      this._transport
        .stream(
          formatted.url,
          {
            method: "POST",
            headers: formatted.headers,
            body: formatted.body,
          },
          (chunk) => {
            let delta: StreamDelta | null;
            try {
              delta = this._provider.parseStreamChunk(chunk);
            } catch (err) {
              if (callbacks?.onError) {
                callbacks.onError(err instanceof Error ? err : new Error(String(err)));
              }
              return;
            }

            if (!delta) return;

            switch (delta.type) {
              case "text_delta":
                currentText += delta.text;
                if (callbacks?.onTextDelta) {
                  callbacks.onTextDelta(delta.text);
                }
                break;

              case "tool_use_start":
                if (currentText) {
                  content.push({ type: "text", text: currentText });
                  currentText = "";
                }
                currentToolId = delta.id;
                currentToolName = delta.name;
                currentToolInput = "";
                break;

              case "tool_input_delta":
                currentToolInput += delta.delta;
                break;

              case "tool_use_end":
                content.push({
                  type: "tool_use",
                  id: currentToolId,
                  name: currentToolName,
                  input: currentToolInput ? JSON.parse(currentToolInput) : {},
                });
                currentToolId = "";
                currentToolName = "";
                currentToolInput = "";
                break;

              case "message_end":
                if (currentText) {
                  content.push({ type: "text", text: currentText });
                  currentText = "";
                }
                break;

              case "error":
                if (callbacks?.onError) {
                  callbacks.onError(new Error(delta.message));
                }
                break;
            }
          },
        )
        .then(() => {
          this._abortReject = null;
          if (currentText) {
            content.push({ type: "text", text: currentText });
          }
          resolve({ role: "assistant", content });
        })
        .catch((err) => {
          this._abortReject = null;
          reject(err);
        });
    });
  }
}
