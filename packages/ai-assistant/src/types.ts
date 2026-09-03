// packages/ai-assistant/src/types.ts

export type Role = "user" | "assistant";

export type ContentPart =
  | { type: "text"; text: string }
  | { type: "tool_use"; id: string; name: string; input: Record<string, unknown> }
  | { type: "tool_result"; tool_use_id: string; content: string; is_error?: boolean };

export interface Message {
  role: Role;
  content: ContentPart[];
}

export interface ToolDefinition {
  name: string;
  description: string;
  parameters: Record<string, unknown>;
}

export type StreamDelta =
  | { type: "text_delta"; text: string }
  | { type: "tool_use_start"; id: string; name: string }
  | { type: "tool_input_delta"; id: string; delta: string }
  | { type: "tool_use_end"; id: string }
  | { type: "message_start" }
  | { type: "message_end"; stop_reason: string }
  | { type: "error"; message: string };

export type ToolExecutor = (
  name: string,
  input: Record<string, unknown>,
) => Promise<string>;

export interface AgentOptions {
  provider: IProvider;
  transport: IHttpTransport;
  model: string;
  system?: string;
  tools?: ToolDefinition[];
  maxTokens?: number;
  maxTurns?: number;
}

export interface AgentCallbacks {
  onTextDelta?: (text: string) => void;
  onToolStart?: (id: string, name: string) => void;
  onToolEnd?: (id: string, result: string) => void;
  onTurnComplete?: (message: Message) => void;
  onError?: (error: Error) => void;
}

// Re-export interface types so AgentOptions is self-contained
import type { IProvider } from "./provider.js";
import type { IHttpTransport } from "./transport.js";
