// packages/ai-assistant/src/index.ts

export type {
  Role,
  ContentPart,
  Message,
  ToolDefinition,
  StreamDelta,
  ToolExecutor,
  AgentOptions,
  AgentCallbacks,
} from "./types.js";

export type { IProvider } from "./provider.js";

export type { HttpResponse, IHttpTransport } from "./transport.js";

export type { MockStreamConfig } from "./mock-transport.js";
export { MockHttpTransport } from "./mock-transport.js";

export type { ClaudeProviderOptions } from "./providers/claude.js";
export { ClaudeProvider } from "./providers/claude.js";

export type { CodexProviderOptions } from "./providers/codex.js";
export { CodexProvider } from "./providers/codex.js";

export { Agent } from "./agent.js";
