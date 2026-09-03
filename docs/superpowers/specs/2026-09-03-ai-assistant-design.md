# AI Assistant Design Spec

**Package:** `@anthropic-ide/ai-assistant`
**Status:** Draft
**Date:** 2026-09-03

## Purpose

Multi-provider AI assistant for a mobile JS/TS IDE running on iOS (JavaScriptCore/WKWebView). Supports agent mode (AI autonomously reads/edits files, runs code, iterates) and chat mode (conversational interaction about code). Both modes share the same message loop with tool use — the difference is UI, not architecture.

Initial providers: Claude (Anthropic) and Codex (OpenAI). Architecture supports adding new providers by implementing a single interface.

## Non-Goals

- Inline code completion (deferred to a later phase)
- Persisting conversations to disk (consumer responsibility)
- Direct dependency on VFS, bundler, or runtime-bridge (connected via ToolExecutor injection)
- API key management / keychain access (consumer provides keys)

## Architecture

Three layers:

1. **Core** — Unified message format, agent loop (tool use cycle with streaming), conversation management
2. **Providers** — Adapter per AI service: `ClaudeProvider`, `CodexProvider`, each implementing `IProvider`
3. **Transport** — Injectable `IHttpTransport` interface. Swift implements it with `URLSession`; tests use `MockHttpTransport`

```
User message
  → ConversationManager.send()
    → Agent.run()
      → IProvider.formatRequest()     // build provider-specific payload
      → IHttpTransport.stream()       // Swift does HTTP, calls back with SSE chunks
      → IProvider.parseStreamChunk()  // normalize to StreamDelta
      → assemble Message
      → tool_use found?
        → yes → ToolExecutor(name, input) → add tool_result → loop
        → no  → return final history
```

## Core Types

### Message Format

```ts
type Role = "user" | "assistant";

type ContentPart =
  | { type: "text"; text: string }
  | { type: "tool_use"; id: string; name: string; input: Record<string, unknown> }
  | { type: "tool_result"; tool_use_id: string; content: string; is_error?: boolean };

interface Message {
  role: Role;
  content: ContentPart[];
}
```

Format is closer to Claude's native format (richer model). Codex adapter maps to/from OpenAI format without data loss.

### Tool Definition

```ts
interface ToolDefinition {
  name: string;
  description: string;
  parameters: Record<string, unknown>; // JSON Schema object
}
```

### Stream Deltas

```ts
type StreamDelta =
  | { type: "text_delta"; text: string }
  | { type: "tool_use_start"; id: string; name: string }
  | { type: "tool_input_delta"; id: string; delta: string }
  | { type: "tool_use_end"; id: string }
  | { type: "message_start" }
  | { type: "message_end"; stop_reason: string }
  | { type: "error"; message: string };
```

### Tool Executor

```ts
type ToolExecutor = (name: string, input: Record<string, unknown>) => Promise<string>;
```

Injected by the consumer. Maps tool names to IDE capabilities (VFS read/write, runtime exec, search, etc.). The package never imports other IDE packages directly.

## Provider Interface

```ts
interface IProvider {
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
```

### ClaudeProvider

- API URL: `https://api.anthropic.com/v1/messages`
- Headers: `x-api-key`, `anthropic-version: 2023-06-01`, `content-type: application/json`
- API key passed at construction: `new ClaudeProvider({ apiKey })`
- Request format: `{ model, max_tokens, system, messages: [{role, content}], tools: [{name, description, input_schema}], stream }`
- `formatRequest`: maps `Message[]` to Claude API messages format. `tool_use` and `tool_result` content parts map directly. `ToolDefinition.parameters` maps to `input_schema`.
- `parseResponse`: extracts `content` array from response, maps `text` and `tool_use` blocks to `ContentPart[]`.
- `parseStreamChunk`: parses SSE `data: {...}` lines. Maps `content_block_start` (type tool_use) → `tool_use_start`, `content_block_delta` (type text_delta) → `text_delta`, `content_block_delta` (type input_json_delta) → `tool_input_delta`, `content_block_stop` → `tool_use_end`, `message_start` → `message_start`, `message_stop` → `message_end`. Lines with `event: ping` or `data: [DONE]` return `null`.

### CodexProvider

- API URL: `https://api.openai.com/v1/chat/completions`
- Headers: `Authorization: Bearer <key>`, `content-type: application/json`
- API key passed at construction: `new CodexProvider({ apiKey })`
- Request format: `{ model, max_tokens, messages: [{role, content | tool_calls | tool_call_id}], tools: [{type: "function", function: {name, description, parameters}}], stream, stream_options: { include_usage: true } }`
- `formatRequest`: maps `Message[]` to OpenAI format. User messages: `{role: "user", content: text}`. Assistant messages with tool_use: `{role: "assistant", tool_calls: [{id, type: "function", function: {name, arguments}}]}`. Tool results: `{role: "tool", tool_call_id, content}`. Multiple text parts concatenated. `ToolDefinition.parameters` maps to `function.parameters`.
- `parseResponse`: extracts `choices[0].message`, maps `content` to text ContentPart, `tool_calls` to tool_use ContentParts. `tool_calls[].function.arguments` is JSON string → parsed to `input`.
- `parseStreamChunk`: parses SSE `data: {...}` lines. `choices[0].delta.content` → `text_delta`. `choices[0].delta.tool_calls[0]` with `index` and `function.name` → `tool_use_start`. `choices[0].delta.tool_calls[0].function.arguments` (subsequent chunks) → `tool_input_delta`. `choices[0].finish_reason` present → `tool_use_end` for pending tool calls + `message_end`. `data: [DONE]` → `null`.

## Transport Interface

```ts
interface HttpResponse {
  status: number;
  headers: Record<string, string>;
  body: string;
}

interface IHttpTransport {
  request(url: string, options: {
    method: string;
    headers: Record<string, string>;
    body?: string;
  }): Promise<HttpResponse>;

  stream(url: string, options: {
    method: string;
    headers: Record<string, string>;
    body?: string;
  }, onChunk: (chunk: string) => void): Promise<void>;
}
```

- `request`: full request/response. Used for non-streaming calls.
- `stream`: SSE streaming. `onChunk` called with each `data: ...` line (without the `data: ` prefix). Promise resolves when stream ends, rejects on network error or timeout.
- Callback-based streaming (not AsyncIterable) for ES2020/JavaScriptCore compatibility.
- Swift implements via `URLSession` with `AsyncBytes` and SSE parsing.
- `MockHttpTransport` for tests: configurable responses and chunk sequences.

## Agent

```ts
interface AgentOptions {
  provider: IProvider;
  transport: IHttpTransport;
  model: string;
  system?: string;
  tools?: ToolDefinition[];
  maxTokens?: number;
  maxTurns?: number; // default 20, safety against infinite loops
}

interface AgentCallbacks {
  onTextDelta?: (text: string) => void;
  onToolStart?: (id: string, name: string) => void;
  onToolEnd?: (id: string, result: string) => void;
  onTurnComplete?: (message: Message) => void;
  onError?: (error: Error) => void;
}

class Agent {
  constructor(options: AgentOptions);

  run(
    messages: Message[],
    executor: ToolExecutor,
    callbacks?: AgentCallbacks,
  ): Promise<Message[]>;

  abort(): void;
}
```

### Agent Loop Behavior

1. Call `provider.formatRequest()` with current messages, tools, and `stream: true`.
2. Call `transport.stream()` with the formatted request.
3. For each chunk: call `provider.parseStreamChunk()`, dispatch to callbacks (`onTextDelta`, `onToolStart`, etc.), accumulate into a complete `Message`.
4. When stream ends: check if the assembled message contains `tool_use` parts.
5. If tool_use present: for each tool call, invoke `executor(name, input)`. Wrap results as `tool_result` content parts in a new user message. Append both the assistant message and the tool results message to history. Go to step 1 (next turn).
6. If no tool_use (stop_reason is `end_turn` or equivalent): append the assistant message to history and return the full history.
7. If `maxTurns` exceeded: append the last message and return (no error — the consumer can check if tool calls are pending).
8. `abort()`: cancels the current transport stream. The `run()` promise rejects with an `AbortError`.

### Error Handling

- HTTP errors (4xx, 5xx): throw with status code and body.
- Network errors: transport rejects, propagated as-is.
- Malformed responses: throw with descriptive parse error.
- Tool executor errors: caught, wrapped as `tool_result` with `is_error: true`, loop continues (the AI sees the error and can retry or explain).
- Stream parse errors on individual chunks: skip the chunk (log via callback if `onError` provided), don't abort the stream.

### Abort

- `Agent` holds a flag `_aborted: boolean`.
- `abort()` sets the flag and cancels the in-flight transport stream.
- Each loop iteration checks the flag before starting a new turn.
- On abort: `run()` rejects with `new Error("Aborted")` with `(err as any).code = "ABORT"`.

## Conversation Manager

```ts
interface Conversation {
  id: string;
  messages: Message[];
  provider: string;
  model: string;
  createdAt: number;
}

class ConversationManager {
  constructor(options: {
    provider: IProvider;
    transport: IHttpTransport;
    model: string;
    system?: string;
    tools?: ToolDefinition[];
    executor: ToolExecutor;
    maxTurns?: number;
  });

  create(): Conversation;

  send(
    conversationId: string,
    text: string,
    callbacks?: AgentCallbacks,
  ): Promise<Conversation>;

  abort(conversationId: string): void;

  get(conversationId: string): Conversation | undefined;
  list(): Conversation[];
  delete(conversationId: string): void;
}
```

- `create()`: generates a unique ID, returns empty conversation.
- `send()`: appends user message, creates an `Agent`, runs the agent loop, updates the conversation with full history, returns updated conversation.
- `abort()`: aborts the active agent for the given conversation.
- `delete()`: removes conversation from in-memory store.
- No persistence — consumer serializes conversations if needed.
- One active agent per conversation (calling `send` while a previous `send` is running throws).

## MockHttpTransport

```ts
interface MockStreamConfig {
  chunks: string[];   // SSE data lines to emit
  delayMs?: number;   // delay between chunks, default 0
}

class MockHttpTransport implements IHttpTransport {
  constructor();

  // Configure responses
  onRequest(url: string, response: HttpResponse): void;
  onStream(url: string, config: MockStreamConfig): void;

  // For assertions
  readonly requests: Array<{ url: string; options: { method: string; headers: Record<string, string>; body?: string } }>;

  request(url: string, options: {...}): Promise<HttpResponse>;
  stream(url: string, options: {...}, onChunk: (chunk: string) => void): Promise<void>;
}
```

## File Structure

```
packages/ai-assistant/src/
  types.ts              — Message, ContentPart, StreamDelta, ToolDefinition, Role, AgentCallbacks, AgentOptions
  provider.ts           — IProvider interface
  transport.ts          — IHttpTransport, HttpResponse
  providers/
    claude.ts           — ClaudeProvider
    codex.ts            — CodexProvider
  agent.ts              — Agent class
  conversation.ts       — ConversationManager, Conversation
  mock-transport.ts     — MockHttpTransport
  index.ts              — public exports
```

## Public API (index.ts exports)

Types: `Message`, `ContentPart`, `StreamDelta`, `ToolDefinition`, `Role`, `Conversation`, `AgentCallbacks`, `AgentOptions`, `ToolExecutor`

Interfaces: `IProvider`, `IHttpTransport`, `HttpResponse`

Classes: `Agent`, `ConversationManager`, `ClaudeProvider`, `CodexProvider`, `MockHttpTransport`

## Dependencies

None. No dependency on `@anthropic-ide/vfs`, `@anthropic-ide/runtime-bridge`, or any other package. Connection to IDE capabilities is through `ToolExecutor` injection.

## Global Constraints

- No Node-specific APIs (`node:*`) in source files (only in `*.test.ts`)
- ES2020 target for JavaScriptCore compatibility
- No `Symbol.asyncIterator` / `for await...of` over custom iterables — use callbacks
- Package scope: `@anthropic-ide/*`
- Cross-package communication only through exported interfaces from `index.ts`

## Testing Strategy

- **Provider tests**: verify `formatRequest` produces correct provider-specific payloads, `parseResponse` correctly maps responses to `Message`, `parseStreamChunk` correctly maps SSE chunks to `StreamDelta`. Use snapshot-style assertions with real API response shapes.
- **Agent tests**: use `MockHttpTransport` with preconfigured responses. Test: single-turn (no tool use), multi-turn (tool use loop), max turns limit, abort mid-stream, error handling (HTTP error, parse error, tool executor error).
- **ConversationManager tests**: create/get/list/delete, send with mock transport, abort, concurrent send rejection.
- **Integration test**: full loop — ConversationManager + ClaudeProvider + MockHttpTransport + ToolExecutor — verify that a multi-turn tool-use conversation produces expected history.
