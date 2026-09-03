# AI Assistant Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Multi-provider AI assistant with agent mode (tool use loop) and streaming, supporting Claude and Codex with extensible provider architecture.

**Architecture:** Provider Adapter Pattern — unified message format, injectable HTTP transport, provider-specific adapters for request formatting and response parsing. Agent class runs the tool-use loop. ConversationManager wraps Agent with conversation state.

**Tech Stack:** TypeScript, vitest, ES2020 target

**Spec:** `docs/superpowers/specs/2026-09-03-ai-assistant-design.md`

## Global Constraints

- No Node-specific APIs (`node:*`) in source files — only in `*.test.ts`
- ES2020 target for JavaScriptCore compatibility
- No `Symbol.asyncIterator` / `for await...of` over custom iterables — use callbacks
- Package scope: `@anthropic-ide/*`
- Cross-package communication only through exported interfaces from `index.ts`
- No external npm dependencies

---

## File Map

```
packages/ai-assistant/src/
  types.ts              — Message, ContentPart, StreamDelta, ToolDefinition, Role, AgentCallbacks, AgentOptions, ToolExecutor
  provider.ts           — IProvider interface
  transport.ts          — IHttpTransport, HttpResponse interfaces
  mock-transport.ts     — MockHttpTransport class (configurable mock for tests)
  providers/
    claude.ts           — ClaudeProvider implements IProvider
    codex.ts            — CodexProvider implements IProvider
  agent.ts              — Agent class (streaming tool-use loop)
  conversation.ts       — ConversationManager, Conversation interface
  index.ts              — public API exports

  types.test.ts         — type guard / helper tests (if any)
  mock-transport.test.ts — MockHttpTransport tests
  providers/
    claude.test.ts      — ClaudeProvider tests
    codex.test.ts       — CodexProvider tests
  agent.test.ts         — Agent tests
  conversation.test.ts  — ConversationManager tests
  integration.test.ts   — end-to-end integration tests
```

---

### Task 1: Types, Interfaces, and MockHttpTransport

**Files:**
- Create: `packages/ai-assistant/src/types.ts`
- Create: `packages/ai-assistant/src/provider.ts`
- Create: `packages/ai-assistant/src/transport.ts`
- Create: `packages/ai-assistant/src/mock-transport.ts`
- Create: `packages/ai-assistant/src/mock-transport.test.ts`
- Modify: `packages/ai-assistant/src/index.ts`

**Interfaces:**
- Consumes: nothing
- Produces: `Message`, `ContentPart`, `StreamDelta`, `ToolDefinition`, `Role`, `AgentCallbacks`, `AgentOptions`, `ToolExecutor`, `IProvider`, `IHttpTransport`, `HttpResponse`, `MockHttpTransport`, `MockStreamConfig`

- [ ] **Step 1: Write types.ts**

```ts
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
```

- [ ] **Step 2: Write provider.ts**

```ts
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
```

- [ ] **Step 3: Write transport.ts**

```ts
// packages/ai-assistant/src/transport.ts

export interface HttpResponse {
  status: number;
  headers: Record<string, string>;
  body: string;
}

export interface IHttpTransport {
  request(
    url: string,
    options: {
      method: string;
      headers: Record<string, string>;
      body?: string;
    },
  ): Promise<HttpResponse>;

  stream(
    url: string,
    options: {
      method: string;
      headers: Record<string, string>;
      body?: string;
    },
    onChunk: (chunk: string) => void,
  ): Promise<void>;
}
```

- [ ] **Step 4: Write mock-transport.test.ts**

```ts
// packages/ai-assistant/src/mock-transport.test.ts

import { describe, it, expect } from "vitest";
import { MockHttpTransport } from "./mock-transport.js";

describe("MockHttpTransport", () => {
  it("returns configured response for request", async () => {
    const transport = new MockHttpTransport();
    transport.onRequest("https://api.example.com/v1/test", {
      status: 200,
      headers: { "content-type": "application/json" },
      body: '{"ok":true}',
    });

    const res = await transport.request("https://api.example.com/v1/test", {
      method: "POST",
      headers: {},
      body: "{}",
    });

    expect(res.status).toBe(200);
    expect(res.body).toBe('{"ok":true}');
  });

  it("throws on unconfigured request URL", async () => {
    const transport = new MockHttpTransport();
    await expect(
      transport.request("https://unknown.com", { method: "GET", headers: {} }),
    ).rejects.toThrow("No mock configured");
  });

  it("delivers stream chunks via onChunk callback", async () => {
    const transport = new MockHttpTransport();
    transport.onStream("https://api.example.com/v1/stream", {
      chunks: ['{"type":"start"}', '{"type":"delta","text":"hi"}', '{"type":"end"}'],
    });

    const received: string[] = [];
    await transport.stream(
      "https://api.example.com/v1/stream",
      { method: "POST", headers: {}, body: "{}" },
      (chunk) => received.push(chunk),
    );

    expect(received).toEqual([
      '{"type":"start"}',
      '{"type":"delta","text":"hi"}',
      '{"type":"end"}',
    ]);
  });

  it("throws on unconfigured stream URL", async () => {
    const transport = new MockHttpTransport();
    await expect(
      transport.stream("https://unknown.com", { method: "POST", headers: {} }, () => {}),
    ).rejects.toThrow("No mock configured");
  });

  it("records all requests for assertions", async () => {
    const transport = new MockHttpTransport();
    transport.onRequest("https://api.example.com/v1/test", {
      status: 200,
      headers: {},
      body: "{}",
    });

    await transport.request("https://api.example.com/v1/test", {
      method: "POST",
      headers: { "x-key": "abc" },
      body: '{"q":"hello"}',
    });

    expect(transport.requests).toHaveLength(1);
    expect(transport.requests[0].url).toBe("https://api.example.com/v1/test");
    expect(transport.requests[0].options.headers["x-key"]).toBe("abc");
    expect(transport.requests[0].options.body).toBe('{"q":"hello"}');
  });

  it("records stream requests too", async () => {
    const transport = new MockHttpTransport();
    transport.onStream("https://api.example.com/v1/stream", { chunks: [] });

    await transport.stream(
      "https://api.example.com/v1/stream",
      { method: "POST", headers: {}, body: '{"stream":true}' },
      () => {},
    );

    expect(transport.requests).toHaveLength(1);
    expect(transport.requests[0].options.body).toBe('{"stream":true}');
  });
});
```

- [ ] **Step 5: Write mock-transport.ts**

```ts
// packages/ai-assistant/src/mock-transport.ts

import type { HttpResponse, IHttpTransport } from "./transport.js";

export interface MockStreamConfig {
  chunks: string[];
  delayMs?: number;
}

interface RequestRecord {
  url: string;
  options: { method: string; headers: Record<string, string>; body?: string };
}

export class MockHttpTransport implements IHttpTransport {
  private _responses = new Map<string, HttpResponse>();
  private _streams = new Map<string, MockStreamConfig>();
  private _requests: RequestRecord[] = [];

  get requests(): ReadonlyArray<RequestRecord> {
    return this._requests;
  }

  onRequest(url: string, response: HttpResponse): void {
    this._responses.set(url, response);
  }

  onStream(url: string, config: MockStreamConfig): void {
    this._streams.set(url, config);
  }

  async request(
    url: string,
    options: { method: string; headers: Record<string, string>; body?: string },
  ): Promise<HttpResponse> {
    this._requests.push({ url, options });
    const response = this._responses.get(url);
    if (!response) {
      throw new Error(`No mock configured for request URL: ${url}`);
    }
    return response;
  }

  async stream(
    url: string,
    options: { method: string; headers: Record<string, string>; body?: string },
    onChunk: (chunk: string) => void,
  ): Promise<void> {
    this._requests.push({ url, options });
    const config = this._streams.get(url);
    if (!config) {
      throw new Error(`No mock configured for stream URL: ${url}`);
    }
    for (const chunk of config.chunks) {
      if (config.delayMs) {
        await new Promise((r) => setTimeout(r, config.delayMs));
      }
      onChunk(chunk);
    }
  }
}
```

- [ ] **Step 6: Run tests**

Run: `cd packages/ai-assistant && pnpm test`
Expected: all mock-transport tests pass

- [ ] **Step 7: Update index.ts**

```ts
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
```

- [ ] **Step 8: Commit**

```bash
git add packages/ai-assistant/src/types.ts packages/ai-assistant/src/provider.ts \
  packages/ai-assistant/src/transport.ts packages/ai-assistant/src/mock-transport.ts \
  packages/ai-assistant/src/mock-transport.test.ts packages/ai-assistant/src/index.ts
git commit -m "feat(ai-assistant): add core types, interfaces, and MockHttpTransport"
```

---

### Task 2: ClaudeProvider

**Files:**
- Create: `packages/ai-assistant/src/providers/claude.ts`
- Create: `packages/ai-assistant/src/providers/claude.test.ts`
- Modify: `packages/ai-assistant/src/index.ts`

**Interfaces:**
- Consumes: `IProvider`, `Message`, `ContentPart`, `ToolDefinition`, `StreamDelta` from Task 1
- Produces: `ClaudeProvider` class implementing `IProvider`

- [ ] **Step 1: Write claude.test.ts**

```ts
// packages/ai-assistant/src/providers/claude.test.ts

import { describe, it, expect } from "vitest";
import { ClaudeProvider } from "./claude.js";
import type { Message, ToolDefinition } from "../types.js";

describe("ClaudeProvider", () => {
  const provider = new ClaudeProvider({ apiKey: "test-key-123" });

  it("has name 'claude'", () => {
    expect(provider.name).toBe("claude");
  });

  describe("formatRequest", () => {
    it("formats a simple text message", () => {
      const messages: Message[] = [
        { role: "user", content: [{ type: "text", text: "Hello" }] },
      ];

      const req = provider.formatRequest({
        messages,
        model: "claude-sonnet-4-20250514",
        maxTokens: 1024,
        stream: false,
      });

      expect(req.url).toBe("https://api.anthropic.com/v1/messages");
      expect(req.headers["x-api-key"]).toBe("test-key-123");
      expect(req.headers["anthropic-version"]).toBe("2023-06-01");
      expect(req.headers["content-type"]).toBe("application/json");

      const body = JSON.parse(req.body);
      expect(body.model).toBe("claude-sonnet-4-20250514");
      expect(body.max_tokens).toBe(1024);
      expect(body.stream).toBe(false);
      expect(body.messages).toEqual([
        { role: "user", content: [{ type: "text", text: "Hello" }] },
      ]);
    });

    it("includes system prompt when provided", () => {
      const messages: Message[] = [
        { role: "user", content: [{ type: "text", text: "Hi" }] },
      ];

      const req = provider.formatRequest({
        messages,
        model: "claude-sonnet-4-20250514",
        system: "You are a helpful assistant.",
        stream: false,
      });

      const body = JSON.parse(req.body);
      expect(body.system).toBe("You are a helpful assistant.");
    });

    it("maps tools to Claude format with input_schema", () => {
      const tools: ToolDefinition[] = [
        {
          name: "readFile",
          description: "Read a file from the filesystem",
          parameters: {
            type: "object",
            properties: { path: { type: "string" } },
            required: ["path"],
          },
        },
      ];

      const req = provider.formatRequest({
        messages: [{ role: "user", content: [{ type: "text", text: "Read main.ts" }] }],
        tools,
        model: "claude-sonnet-4-20250514",
        stream: false,
      });

      const body = JSON.parse(req.body);
      expect(body.tools).toEqual([
        {
          name: "readFile",
          description: "Read a file from the filesystem",
          input_schema: {
            type: "object",
            properties: { path: { type: "string" } },
            required: ["path"],
          },
        },
      ]);
    });

    it("formats tool_use and tool_result messages", () => {
      const messages: Message[] = [
        { role: "user", content: [{ type: "text", text: "Read main.ts" }] },
        {
          role: "assistant",
          content: [
            { type: "text", text: "I'll read that file." },
            { type: "tool_use", id: "tu_1", name: "readFile", input: { path: "/main.ts" } },
          ],
        },
        {
          role: "user",
          content: [
            { type: "tool_result", tool_use_id: "tu_1", content: "console.log('hello')" },
          ],
        },
      ];

      const req = provider.formatRequest({
        messages,
        model: "claude-sonnet-4-20250514",
        stream: false,
      });

      const body = JSON.parse(req.body);
      expect(body.messages).toHaveLength(3);
      expect(body.messages[1].content[1]).toEqual({
        type: "tool_use",
        id: "tu_1",
        name: "readFile",
        input: { path: "/main.ts" },
      });
      expect(body.messages[2].content[0]).toEqual({
        type: "tool_result",
        tool_use_id: "tu_1",
        content: "console.log('hello')",
      });
    });

    it("sets stream: true when requested", () => {
      const req = provider.formatRequest({
        messages: [{ role: "user", content: [{ type: "text", text: "Hi" }] }],
        model: "claude-sonnet-4-20250514",
        stream: true,
      });

      const body = JSON.parse(req.body);
      expect(body.stream).toBe(true);
    });

    it("uses default maxTokens of 4096 when not specified", () => {
      const req = provider.formatRequest({
        messages: [{ role: "user", content: [{ type: "text", text: "Hi" }] }],
        model: "claude-sonnet-4-20250514",
        stream: false,
      });

      const body = JSON.parse(req.body);
      expect(body.max_tokens).toBe(4096);
    });
  });

  describe("parseResponse", () => {
    it("parses a text-only response", () => {
      const raw = JSON.stringify({
        id: "msg_1",
        type: "message",
        role: "assistant",
        content: [{ type: "text", text: "Hello there!" }],
        stop_reason: "end_turn",
      });

      const msg = provider.parseResponse(raw);
      expect(msg.role).toBe("assistant");
      expect(msg.content).toEqual([{ type: "text", text: "Hello there!" }]);
    });

    it("parses a response with tool_use", () => {
      const raw = JSON.stringify({
        id: "msg_2",
        type: "message",
        role: "assistant",
        content: [
          { type: "text", text: "Let me read that." },
          { type: "tool_use", id: "tu_1", name: "readFile", input: { path: "/main.ts" } },
        ],
        stop_reason: "tool_use",
      });

      const msg = provider.parseResponse(raw);
      expect(msg.content).toHaveLength(2);
      expect(msg.content[0]).toEqual({ type: "text", text: "Let me read that." });
      expect(msg.content[1]).toEqual({
        type: "tool_use",
        id: "tu_1",
        name: "readFile",
        input: { path: "/main.ts" },
      });
    });
  });

  describe("parseStreamChunk", () => {
    it("parses message_start event", () => {
      const chunk = JSON.stringify({ type: "message_start", message: { id: "msg_1", role: "assistant" } });
      const delta = provider.parseStreamChunk(chunk);
      expect(delta).toEqual({ type: "message_start" });
    });

    it("parses text delta", () => {
      const chunk = JSON.stringify({
        type: "content_block_delta",
        index: 0,
        delta: { type: "text_delta", text: "Hello" },
      });
      const delta = provider.parseStreamChunk(chunk);
      expect(delta).toEqual({ type: "text_delta", text: "Hello" });
    });

    it("parses tool_use start from content_block_start", () => {
      const chunk = JSON.stringify({
        type: "content_block_start",
        index: 1,
        content_block: { type: "tool_use", id: "tu_1", name: "readFile", input: {} },
      });
      const delta = provider.parseStreamChunk(chunk);
      expect(delta).toEqual({ type: "tool_use_start", id: "tu_1", name: "readFile" });
    });

    it("parses tool input delta", () => {
      const chunk = JSON.stringify({
        type: "content_block_delta",
        index: 1,
        delta: { type: "input_json_delta", partial_json: '{"path":' },
      });
      const delta = provider.parseStreamChunk(chunk);
      expect(delta).toEqual({ type: "tool_input_delta", id: "", delta: '{"path":' });
    });

    it("parses content_block_stop as tool_use_end", () => {
      const chunk = JSON.stringify({ type: "content_block_stop", index: 1 });
      const delta = provider.parseStreamChunk(chunk);
      expect(delta).toEqual({ type: "tool_use_end", id: "" });
    });

    it("parses message_stop as message_end", () => {
      const chunk = JSON.stringify({ type: "message_stop" });
      const delta = provider.parseStreamChunk(chunk);
      expect(delta).toEqual({ type: "message_end", stop_reason: "end_turn" });
    });

    it("parses message_delta with stop_reason", () => {
      const chunk = JSON.stringify({
        type: "message_delta",
        delta: { stop_reason: "tool_use" },
      });
      const delta = provider.parseStreamChunk(chunk);
      expect(delta).toEqual({ type: "message_end", stop_reason: "tool_use" });
    });

    it("returns null for ping events", () => {
      const delta = provider.parseStreamChunk("[DONE]");
      expect(delta).toBeNull();
    });

    it("returns null for unrecognized event types", () => {
      const chunk = JSON.stringify({ type: "ping" });
      const delta = provider.parseStreamChunk(chunk);
      expect(delta).toBeNull();
    });
  });
});
```

- [ ] **Step 2: Write claude.ts**

```ts
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
```

- [ ] **Step 3: Run tests**

Run: `cd packages/ai-assistant && pnpm test`
Expected: all tests pass

- [ ] **Step 4: Update index.ts — add ClaudeProvider export**

Add to `packages/ai-assistant/src/index.ts`:

```ts
export type { ClaudeProviderOptions } from "./providers/claude.js";
export { ClaudeProvider } from "./providers/claude.js";
```

- [ ] **Step 5: Commit**

```bash
git add packages/ai-assistant/src/providers/claude.ts \
  packages/ai-assistant/src/providers/claude.test.ts \
  packages/ai-assistant/src/index.ts
git commit -m "feat(ai-assistant): add ClaudeProvider (Anthropic Messages API adapter)"
```

---

### Task 3: CodexProvider

**Files:**
- Create: `packages/ai-assistant/src/providers/codex.ts`
- Create: `packages/ai-assistant/src/providers/codex.test.ts`
- Modify: `packages/ai-assistant/src/index.ts`

**Interfaces:**
- Consumes: `IProvider`, `Message`, `ContentPart`, `ToolDefinition`, `StreamDelta` from Task 1
- Produces: `CodexProvider` class implementing `IProvider`

- [ ] **Step 1: Write codex.test.ts**

```ts
// packages/ai-assistant/src/providers/codex.test.ts

import { describe, it, expect } from "vitest";
import { CodexProvider } from "./codex.js";
import type { Message, ToolDefinition } from "../types.js";

describe("CodexProvider", () => {
  const provider = new CodexProvider({ apiKey: "sk-test-key" });

  it("has name 'codex'", () => {
    expect(provider.name).toBe("codex");
  });

  describe("formatRequest", () => {
    it("formats a simple text message to OpenAI format", () => {
      const messages: Message[] = [
        { role: "user", content: [{ type: "text", text: "Hello" }] },
      ];

      const req = provider.formatRequest({
        messages,
        model: "gpt-4o",
        maxTokens: 1024,
        stream: false,
      });

      expect(req.url).toBe("https://api.openai.com/v1/chat/completions");
      expect(req.headers["Authorization"]).toBe("Bearer sk-test-key");
      expect(req.headers["content-type"]).toBe("application/json");

      const body = JSON.parse(req.body);
      expect(body.model).toBe("gpt-4o");
      expect(body.max_tokens).toBe(1024);
      expect(body.stream).toBe(false);
      expect(body.messages).toEqual([
        { role: "user", content: "Hello" },
      ]);
    });

    it("includes system as a system message", () => {
      const req = provider.formatRequest({
        messages: [{ role: "user", content: [{ type: "text", text: "Hi" }] }],
        model: "gpt-4o",
        system: "You are helpful.",
        stream: false,
      });

      const body = JSON.parse(req.body);
      expect(body.messages[0]).toEqual({ role: "system", content: "You are helpful." });
      expect(body.messages[1]).toEqual({ role: "user", content: "Hi" });
    });

    it("maps tools to OpenAI function format", () => {
      const tools: ToolDefinition[] = [
        {
          name: "readFile",
          description: "Read a file",
          parameters: {
            type: "object",
            properties: { path: { type: "string" } },
            required: ["path"],
          },
        },
      ];

      const req = provider.formatRequest({
        messages: [{ role: "user", content: [{ type: "text", text: "Read it" }] }],
        tools,
        model: "gpt-4o",
        stream: false,
      });

      const body = JSON.parse(req.body);
      expect(body.tools).toEqual([
        {
          type: "function",
          function: {
            name: "readFile",
            description: "Read a file",
            parameters: {
              type: "object",
              properties: { path: { type: "string" } },
              required: ["path"],
            },
          },
        },
      ]);
    });

    it("maps assistant tool_use to OpenAI tool_calls", () => {
      const messages: Message[] = [
        { role: "user", content: [{ type: "text", text: "Read main.ts" }] },
        {
          role: "assistant",
          content: [
            { type: "text", text: "Reading..." },
            { type: "tool_use", id: "call_1", name: "readFile", input: { path: "/main.ts" } },
          ],
        },
        {
          role: "user",
          content: [
            { type: "tool_result", tool_use_id: "call_1", content: "file contents" },
          ],
        },
      ];

      const req = provider.formatRequest({
        messages,
        model: "gpt-4o",
        stream: false,
      });

      const body = JSON.parse(req.body);
      expect(body.messages[1]).toEqual({
        role: "assistant",
        content: "Reading...",
        tool_calls: [
          {
            id: "call_1",
            type: "function",
            function: { name: "readFile", arguments: '{"path":"/main.ts"}' },
          },
        ],
      });
      expect(body.messages[2]).toEqual({
        role: "tool",
        tool_call_id: "call_1",
        content: "file contents",
      });
    });

    it("adds stream_options when streaming", () => {
      const req = provider.formatRequest({
        messages: [{ role: "user", content: [{ type: "text", text: "Hi" }] }],
        model: "gpt-4o",
        stream: true,
      });

      const body = JSON.parse(req.body);
      expect(body.stream).toBe(true);
      expect(body.stream_options).toEqual({ include_usage: true });
    });
  });

  describe("parseResponse", () => {
    it("parses a text-only response", () => {
      const raw = JSON.stringify({
        choices: [
          {
            message: { role: "assistant", content: "Hello!" },
            finish_reason: "stop",
          },
        ],
      });

      const msg = provider.parseResponse(raw);
      expect(msg.role).toBe("assistant");
      expect(msg.content).toEqual([{ type: "text", text: "Hello!" }]);
    });

    it("parses a response with tool_calls", () => {
      const raw = JSON.stringify({
        choices: [
          {
            message: {
              role: "assistant",
              content: "Let me check.",
              tool_calls: [
                {
                  id: "call_1",
                  type: "function",
                  function: { name: "readFile", arguments: '{"path":"/main.ts"}' },
                },
              ],
            },
            finish_reason: "tool_calls",
          },
        ],
      });

      const msg = provider.parseResponse(raw);
      expect(msg.content).toHaveLength(2);
      expect(msg.content[0]).toEqual({ type: "text", text: "Let me check." });
      expect(msg.content[1]).toEqual({
        type: "tool_use",
        id: "call_1",
        name: "readFile",
        input: { path: "/main.ts" },
      });
    });

    it("handles response with no text content", () => {
      const raw = JSON.stringify({
        choices: [
          {
            message: {
              role: "assistant",
              content: null,
              tool_calls: [
                {
                  id: "call_1",
                  type: "function",
                  function: { name: "readFile", arguments: '{"path":"/a.ts"}' },
                },
              ],
            },
            finish_reason: "tool_calls",
          },
        ],
      });

      const msg = provider.parseResponse(raw);
      expect(msg.content).toHaveLength(1);
      expect(msg.content[0].type).toBe("tool_use");
    });
  });

  describe("parseStreamChunk", () => {
    it("returns null for [DONE]", () => {
      expect(provider.parseStreamChunk("[DONE]")).toBeNull();
    });

    it("parses text delta", () => {
      const chunk = JSON.stringify({
        choices: [{ delta: { content: "Hello" }, index: 0 }],
      });
      expect(provider.parseStreamChunk(chunk)).toEqual({ type: "text_delta", text: "Hello" });
    });

    it("parses tool call start", () => {
      const chunk = JSON.stringify({
        choices: [
          {
            delta: {
              tool_calls: [
                { index: 0, id: "call_1", type: "function", function: { name: "readFile", arguments: "" } },
              ],
            },
            index: 0,
          },
        ],
      });

      expect(provider.parseStreamChunk(chunk)).toEqual({
        type: "tool_use_start",
        id: "call_1",
        name: "readFile",
      });
    });

    it("parses tool call argument delta", () => {
      const chunk = JSON.stringify({
        choices: [
          {
            delta: {
              tool_calls: [{ index: 0, function: { arguments: '{"path":' } }],
            },
            index: 0,
          },
        ],
      });

      expect(provider.parseStreamChunk(chunk)).toEqual({
        type: "tool_input_delta",
        id: "",
        delta: '{"path":',
      });
    });

    it("parses finish_reason as message_end", () => {
      const chunk = JSON.stringify({
        choices: [{ delta: {}, finish_reason: "stop", index: 0 }],
      });

      expect(provider.parseStreamChunk(chunk)).toEqual({
        type: "message_end",
        stop_reason: "stop",
      });
    });

    it("returns null for empty delta", () => {
      const chunk = JSON.stringify({
        choices: [{ delta: { role: "assistant" }, index: 0 }],
      });

      expect(provider.parseStreamChunk(chunk)).toEqual({ type: "message_start" });
    });
  });
});
```

- [ ] **Step 2: Write codex.ts**

```ts
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
        const toolResults = msg.content.filter((p): p is Extract<ContentPart, { type: "tool_result" }> => p.type === "tool_result");
        if (toolResults.length > 0) {
          for (const tr of toolResults) {
            openaiMessages.push({
              role: "tool",
              tool_call_id: tr.tool_use_id,
              content: tr.content,
            });
          }
        } else {
          const textParts = msg.content.filter((p): p is Extract<ContentPart, { type: "text" }> => p.type === "text");
          openaiMessages.push({
            role: "user",
            content: textParts.map((p) => p.text).join("\n"),
          });
        }
      } else if (msg.role === "assistant") {
        const textParts = msg.content.filter((p): p is Extract<ContentPart, { type: "text" }> => p.type === "text");
        const toolUses = msg.content.filter((p): p is Extract<ContentPart, { type: "tool_use" }> => p.type === "tool_use");

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
```

- [ ] **Step 3: Run tests**

Run: `cd packages/ai-assistant && pnpm test`
Expected: all tests pass

- [ ] **Step 4: Update index.ts — add CodexProvider export**

Add to `packages/ai-assistant/src/index.ts`:

```ts
export type { CodexProviderOptions } from "./providers/codex.js";
export { CodexProvider } from "./providers/codex.js";
```

- [ ] **Step 5: Commit**

```bash
git add packages/ai-assistant/src/providers/codex.ts \
  packages/ai-assistant/src/providers/codex.test.ts \
  packages/ai-assistant/src/index.ts
git commit -m "feat(ai-assistant): add CodexProvider (OpenAI Chat Completions adapter)"
```

---

### Task 4: Agent

**Files:**
- Create: `packages/ai-assistant/src/agent.ts`
- Create: `packages/ai-assistant/src/agent.test.ts`
- Modify: `packages/ai-assistant/src/index.ts`

**Interfaces:**
- Consumes: `Message`, `ContentPart`, `StreamDelta`, `AgentOptions`, `AgentCallbacks`, `ToolExecutor`, `IProvider`, `IHttpTransport` from Task 1; `MockHttpTransport` from Task 1; `ClaudeProvider` from Task 2 (used in tests for realistic formatting)
- Produces: `Agent` class

- [ ] **Step 1: Write agent.test.ts**

```ts
// packages/ai-assistant/src/agent.test.ts

import { describe, it, expect, vi } from "vitest";
import { Agent } from "./agent.js";
import { MockHttpTransport } from "./mock-transport.js";
import type { IProvider } from "./provider.js";
import type { Message, StreamDelta, ToolDefinition } from "./types.js";

function createMockProvider(): IProvider {
  return {
    name: "mock",
    formatRequest: vi.fn((params) => ({
      url: "https://api.mock.com/v1/chat",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ messages: params.messages, stream: params.stream }),
    })),
    parseResponse: vi.fn((raw: string) => {
      const data = JSON.parse(raw);
      return data.message as Message;
    }),
    parseStreamChunk: vi.fn((chunk: string): StreamDelta | null => {
      if (chunk === "[DONE]") return null;
      const data = JSON.parse(chunk);
      return data as StreamDelta;
    }),
  };
}

describe("Agent", () => {
  it("single turn: text-only response", async () => {
    const transport = new MockHttpTransport();
    const provider = createMockProvider();

    transport.onStream("https://api.mock.com/v1/chat", {
      chunks: [
        JSON.stringify({ type: "message_start" }),
        JSON.stringify({ type: "text_delta", text: "Hello!" }),
        JSON.stringify({ type: "message_end", stop_reason: "end_turn" }),
      ],
    });

    const agent = new Agent({ provider, transport, model: "mock-1" });
    const messages: Message[] = [
      { role: "user", content: [{ type: "text", text: "Hi" }] },
    ];

    const result = await agent.run(messages, async () => "");

    expect(result).toHaveLength(2);
    expect(result[0].role).toBe("user");
    expect(result[1].role).toBe("assistant");
    expect(result[1].content).toEqual([{ type: "text", text: "Hello!" }]);
  });

  it("multi-turn: tool use loop", async () => {
    const transport = new MockHttpTransport();
    const provider = createMockProvider();
    let callCount = 0;

    transport.onStream("https://api.mock.com/v1/chat", {
      chunks: [
        JSON.stringify({ type: "message_start" }),
        JSON.stringify({ type: "tool_use_start", id: "tu_1", name: "readFile" }),
        JSON.stringify({ type: "tool_input_delta", id: "tu_1", delta: '{"path":"/a.ts"}' }),
        JSON.stringify({ type: "tool_use_end", id: "tu_1" }),
        JSON.stringify({ type: "message_end", stop_reason: "tool_use" }),
      ],
    });

    // Override onStream to return different responses on subsequent calls
    const origStream = transport.stream.bind(transport);
    transport.stream = async (url, options, onChunk) => {
      callCount++;
      if (callCount === 1) {
        return origStream(url, options, onChunk);
      }
      // Second call: text-only response
      const finalChunks = [
        JSON.stringify({ type: "message_start" }),
        JSON.stringify({ type: "text_delta", text: "File contents: hello" }),
        JSON.stringify({ type: "message_end", stop_reason: "end_turn" }),
      ];
      for (const c of finalChunks) {
        onChunk(c);
      }
    };

    const executor = vi.fn(async () => "hello world");
    const agent = new Agent({ provider, transport, model: "mock-1" });

    const result = await agent.run(
      [{ role: "user", content: [{ type: "text", text: "Read a.ts" }] }],
      executor,
    );

    expect(executor).toHaveBeenCalledWith("readFile", { path: "/a.ts" });
    expect(result).toHaveLength(4);
    expect(result[0].role).toBe("user");
    expect(result[1].role).toBe("assistant");
    expect(result[1].content[0]).toEqual({
      type: "tool_use",
      id: "tu_1",
      name: "readFile",
      input: { path: "/a.ts" },
    });
    expect(result[2].role).toBe("user");
    expect(result[2].content[0]).toEqual({
      type: "tool_result",
      tool_use_id: "tu_1",
      content: "hello world",
    });
    expect(result[3].role).toBe("assistant");
    expect(result[3].content[0]).toEqual({ type: "text", text: "File contents: hello" });
  });

  it("respects maxTurns limit", async () => {
    const transport = new MockHttpTransport();
    const provider = createMockProvider();

    // Always returns a tool call
    transport.onStream("https://api.mock.com/v1/chat", {
      chunks: [
        JSON.stringify({ type: "message_start" }),
        JSON.stringify({ type: "tool_use_start", id: "tu_1", name: "loop" }),
        JSON.stringify({ type: "tool_input_delta", id: "tu_1", delta: "{}" }),
        JSON.stringify({ type: "tool_use_end", id: "tu_1" }),
        JSON.stringify({ type: "message_end", stop_reason: "tool_use" }),
      ],
    });

    const agent = new Agent({ provider, transport, model: "mock-1", maxTurns: 2 });
    const result = await agent.run(
      [{ role: "user", content: [{ type: "text", text: "Go" }] }],
      async () => "ok",
    );

    // 1 user + 2 turns * (assistant + tool_result) = 5 messages
    expect(result.length).toBeLessThanOrEqual(5);
  });

  it("calls onTextDelta callback during streaming", async () => {
    const transport = new MockHttpTransport();
    const provider = createMockProvider();

    transport.onStream("https://api.mock.com/v1/chat", {
      chunks: [
        JSON.stringify({ type: "message_start" }),
        JSON.stringify({ type: "text_delta", text: "Hel" }),
        JSON.stringify({ type: "text_delta", text: "lo!" }),
        JSON.stringify({ type: "message_end", stop_reason: "end_turn" }),
      ],
    });

    const deltas: string[] = [];
    const agent = new Agent({ provider, transport, model: "mock-1" });

    await agent.run(
      [{ role: "user", content: [{ type: "text", text: "Hi" }] }],
      async () => "",
      { onTextDelta: (text) => deltas.push(text) },
    );

    expect(deltas).toEqual(["Hel", "lo!"]);
  });

  it("calls onToolStart and onToolEnd callbacks", async () => {
    const transport = new MockHttpTransport();
    const provider = createMockProvider();
    let callCount = 0;

    transport.onStream("https://api.mock.com/v1/chat", {
      chunks: [
        JSON.stringify({ type: "message_start" }),
        JSON.stringify({ type: "tool_use_start", id: "tu_1", name: "readFile" }),
        JSON.stringify({ type: "tool_input_delta", id: "tu_1", delta: '{"path":"x"}' }),
        JSON.stringify({ type: "tool_use_end", id: "tu_1" }),
        JSON.stringify({ type: "message_end", stop_reason: "tool_use" }),
      ],
    });

    const origStream = transport.stream.bind(transport);
    transport.stream = async (url, options, onChunk) => {
      callCount++;
      if (callCount === 1) return origStream(url, options, onChunk);
      onChunk(JSON.stringify({ type: "message_start" }));
      onChunk(JSON.stringify({ type: "text_delta", text: "Done" }));
      onChunk(JSON.stringify({ type: "message_end", stop_reason: "end_turn" }));
    };

    const starts: Array<{ id: string; name: string }> = [];
    const ends: Array<{ id: string; result: string }> = [];

    const agent = new Agent({ provider, transport, model: "mock-1" });
    await agent.run(
      [{ role: "user", content: [{ type: "text", text: "Go" }] }],
      async () => "file content",
      {
        onToolStart: (id, name) => starts.push({ id, name }),
        onToolEnd: (id, result) => ends.push({ id, result }),
      },
    );

    expect(starts).toEqual([{ id: "tu_1", name: "readFile" }]);
    expect(ends).toEqual([{ id: "tu_1", result: "file content" }]);
  });

  it("wraps tool executor errors as is_error tool_result", async () => {
    const transport = new MockHttpTransport();
    const provider = createMockProvider();
    let callCount = 0;

    transport.onStream("https://api.mock.com/v1/chat", {
      chunks: [
        JSON.stringify({ type: "message_start" }),
        JSON.stringify({ type: "tool_use_start", id: "tu_1", name: "readFile" }),
        JSON.stringify({ type: "tool_input_delta", id: "tu_1", delta: '{"path":"x"}' }),
        JSON.stringify({ type: "tool_use_end", id: "tu_1" }),
        JSON.stringify({ type: "message_end", stop_reason: "tool_use" }),
      ],
    });

    const origStream = transport.stream.bind(transport);
    transport.stream = async (url, options, onChunk) => {
      callCount++;
      if (callCount === 1) return origStream(url, options, onChunk);
      onChunk(JSON.stringify({ type: "message_start" }));
      onChunk(JSON.stringify({ type: "text_delta", text: "I see the error" }));
      onChunk(JSON.stringify({ type: "message_end", stop_reason: "end_turn" }));
    };

    const agent = new Agent({ provider, transport, model: "mock-1" });
    const result = await agent.run(
      [{ role: "user", content: [{ type: "text", text: "Go" }] }],
      async () => {
        throw new Error("File not found");
      },
    );

    const toolResultMsg = result[2];
    expect(toolResultMsg.content[0]).toEqual({
      type: "tool_result",
      tool_use_id: "tu_1",
      content: "File not found",
      is_error: true,
    });
  });

  it("abort rejects the run promise", async () => {
    const transport = new MockHttpTransport();
    const provider = createMockProvider();

    // Stream that hangs (never resolves)
    transport.stream = async (_url, _options, _onChunk) => {
      await new Promise((resolve) => setTimeout(resolve, 60000));
    };

    const agent = new Agent({ provider, transport, model: "mock-1" });

    const runPromise = agent.run(
      [{ role: "user", content: [{ type: "text", text: "Hi" }] }],
      async () => "",
    );

    // Abort after a tick
    await new Promise((r) => setTimeout(r, 10));
    agent.abort();

    await expect(runPromise).rejects.toThrow("Aborted");
  });
});
```

- [ ] **Step 2: Write agent.ts**

```ts
// packages/ai-assistant/src/agent.ts

import type {
  Message,
  ContentPart,
  StreamDelta,
  AgentOptions,
  AgentCallbacks,
  ToolExecutor,
} from "./types.js";
import type { IProvider } from "./provider.js";
import type { IHttpTransport } from "./transport.js";

export class Agent {
  private _provider: IProvider;
  private _transport: IHttpTransport;
  private _model: string;
  private _system?: string;
  private _tools?: import("./types.js").ToolDefinition[];
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
        const err = new Error("Aborted");
        (err as any).code = "ABORT";
        throw err;
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
      const err = new Error("Aborted");
      (err as any).code = "ABORT";
      this._abortReject(err);
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
        const err = new Error("Aborted");
        (err as any).code = "ABORT";
        reject(err);
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
```

- [ ] **Step 3: Run tests**

Run: `cd packages/ai-assistant && pnpm test`
Expected: all tests pass

- [ ] **Step 4: Update index.ts — add Agent export**

Add to `packages/ai-assistant/src/index.ts`:

```ts
export { Agent } from "./agent.js";
```

- [ ] **Step 5: Commit**

```bash
git add packages/ai-assistant/src/agent.ts \
  packages/ai-assistant/src/agent.test.ts \
  packages/ai-assistant/src/index.ts
git commit -m "feat(ai-assistant): add Agent class with streaming tool-use loop"
```

---

### Task 5: ConversationManager and Integration Tests

**Files:**
- Create: `packages/ai-assistant/src/conversation.ts`
- Create: `packages/ai-assistant/src/conversation.test.ts`
- Create: `packages/ai-assistant/src/integration.test.ts`
- Modify: `packages/ai-assistant/src/index.ts`

**Interfaces:**
- Consumes: `Agent` from Task 4, `Message`, `AgentCallbacks`, `ToolExecutor`, `IProvider`, `IHttpTransport` from Task 1, `MockHttpTransport` from Task 1, `ClaudeProvider` from Task 2
- Produces: `ConversationManager`, `Conversation`

- [ ] **Step 1: Write conversation.test.ts**

```ts
// packages/ai-assistant/src/conversation.test.ts

import { describe, it, expect, vi } from "vitest";
import { ConversationManager } from "./conversation.js";
import { MockHttpTransport } from "./mock-transport.js";
import type { IProvider } from "./provider.js";
import type { Message, StreamDelta } from "./types.js";

function createMockProvider(): IProvider {
  return {
    name: "mock",
    formatRequest: vi.fn((params) => ({
      url: "https://api.mock.com/v1/chat",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ messages: params.messages, stream: params.stream }),
    })),
    parseResponse: vi.fn((raw: string) => JSON.parse(raw).message as Message),
    parseStreamChunk: vi.fn((chunk: string): StreamDelta | null => {
      if (chunk === "[DONE]") return null;
      return JSON.parse(chunk) as StreamDelta;
    }),
  };
}

function setupSimpleStream(transport: MockHttpTransport): void {
  transport.onStream("https://api.mock.com/v1/chat", {
    chunks: [
      JSON.stringify({ type: "message_start" }),
      JSON.stringify({ type: "text_delta", text: "Hello!" }),
      JSON.stringify({ type: "message_end", stop_reason: "end_turn" }),
    ],
  });
}

describe("ConversationManager", () => {
  it("create returns a conversation with unique id", () => {
    const transport = new MockHttpTransport();
    const provider = createMockProvider();
    const mgr = new ConversationManager({
      provider,
      transport,
      model: "mock-1",
      executor: async () => "",
    });

    const c1 = mgr.create();
    const c2 = mgr.create();

    expect(c1.id).toBeTruthy();
    expect(c2.id).toBeTruthy();
    expect(c1.id).not.toBe(c2.id);
    expect(c1.messages).toEqual([]);
    expect(c1.provider).toBe("mock");
    expect(c1.model).toBe("mock-1");
  });

  it("get returns conversation by id", () => {
    const transport = new MockHttpTransport();
    const provider = createMockProvider();
    const mgr = new ConversationManager({ provider, transport, model: "mock-1", executor: async () => "" });

    const c = mgr.create();
    expect(mgr.get(c.id)).toBe(c);
    expect(mgr.get("nonexistent")).toBeUndefined();
  });

  it("list returns all conversations", () => {
    const transport = new MockHttpTransport();
    const provider = createMockProvider();
    const mgr = new ConversationManager({ provider, transport, model: "mock-1", executor: async () => "" });

    mgr.create();
    mgr.create();
    expect(mgr.list()).toHaveLength(2);
  });

  it("delete removes a conversation", () => {
    const transport = new MockHttpTransport();
    const provider = createMockProvider();
    const mgr = new ConversationManager({ provider, transport, model: "mock-1", executor: async () => "" });

    const c = mgr.create();
    mgr.delete(c.id);
    expect(mgr.get(c.id)).toBeUndefined();
    expect(mgr.list()).toHaveLength(0);
  });

  it("send appends user message and runs agent", async () => {
    const transport = new MockHttpTransport();
    const provider = createMockProvider();
    setupSimpleStream(transport);

    const mgr = new ConversationManager({
      provider,
      transport,
      model: "mock-1",
      executor: async () => "",
    });

    const conv = mgr.create();
    const updated = await mgr.send(conv.id, "Hi there");

    expect(updated.messages).toHaveLength(2);
    expect(updated.messages[0]).toEqual({
      role: "user",
      content: [{ type: "text", text: "Hi there" }],
    });
    expect(updated.messages[1].role).toBe("assistant");
    expect(updated.messages[1].content[0]).toEqual({ type: "text", text: "Hello!" });
  });

  it("send throws for unknown conversation id", async () => {
    const transport = new MockHttpTransport();
    const provider = createMockProvider();
    const mgr = new ConversationManager({ provider, transport, model: "mock-1", executor: async () => "" });

    await expect(mgr.send("bad-id", "Hi")).rejects.toThrow("Conversation not found");
  });

  it("send throws if conversation is already running", async () => {
    const transport = new MockHttpTransport();
    const provider = createMockProvider();

    // Slow stream
    transport.stream = async (_url, _options, onChunk) => {
      await new Promise((r) => setTimeout(r, 100));
      onChunk(JSON.stringify({ type: "message_start" }));
      onChunk(JSON.stringify({ type: "text_delta", text: "Hi" }));
      onChunk(JSON.stringify({ type: "message_end", stop_reason: "end_turn" }));
    };

    const mgr = new ConversationManager({
      provider,
      transport,
      model: "mock-1",
      executor: async () => "",
    });

    const conv = mgr.create();
    const first = mgr.send(conv.id, "Hi");
    await expect(mgr.send(conv.id, "Hi again")).rejects.toThrow("already running");
    await first;
  });

  it("abort cancels running agent", async () => {
    const transport = new MockHttpTransport();
    const provider = createMockProvider();

    transport.stream = async (_url, _options, _onChunk) => {
      await new Promise((r) => setTimeout(r, 60000));
    };

    const mgr = new ConversationManager({
      provider,
      transport,
      model: "mock-1",
      executor: async () => "",
    });

    const conv = mgr.create();
    const runPromise = mgr.send(conv.id, "Hi");

    await new Promise((r) => setTimeout(r, 10));
    mgr.abort(conv.id);

    await expect(runPromise).rejects.toThrow("Aborted");
  });
});
```

- [ ] **Step 2: Write conversation.ts**

```ts
// packages/ai-assistant/src/conversation.ts

import { Agent } from "./agent.js";
import type {
  Message,
  AgentCallbacks,
  ToolExecutor,
  ToolDefinition,
} from "./types.js";
import type { IProvider } from "./provider.js";
import type { IHttpTransport } from "./transport.js";

export interface Conversation {
  id: string;
  messages: Message[];
  provider: string;
  model: string;
  createdAt: number;
}

interface ConversationManagerOptions {
  provider: IProvider;
  transport: IHttpTransport;
  model: string;
  system?: string;
  tools?: ToolDefinition[];
  executor: ToolExecutor;
  maxTurns?: number;
}

let idCounter = 0;
function generateId(): string {
  idCounter++;
  return "conv-" + idCounter + "-" + Math.random().toString(36).slice(2, 8);
}

export class ConversationManager {
  private _provider: IProvider;
  private _transport: IHttpTransport;
  private _model: string;
  private _system?: string;
  private _tools?: ToolDefinition[];
  private _executor: ToolExecutor;
  private _maxTurns?: number;
  private _conversations = new Map<string, Conversation>();
  private _activeAgents = new Map<string, Agent>();

  constructor(options: ConversationManagerOptions) {
    this._provider = options.provider;
    this._transport = options.transport;
    this._model = options.model;
    this._system = options.system;
    this._tools = options.tools;
    this._executor = options.executor;
    this._maxTurns = options.maxTurns;
  }

  create(): Conversation {
    const conv: Conversation = {
      id: generateId(),
      messages: [],
      provider: this._provider.name,
      model: this._model,
      createdAt: Date.now(),
    };
    this._conversations.set(conv.id, conv);
    return conv;
  }

  async send(
    conversationId: string,
    text: string,
    callbacks?: AgentCallbacks,
  ): Promise<Conversation> {
    const conv = this._conversations.get(conversationId);
    if (!conv) {
      throw new Error("Conversation not found: " + conversationId);
    }

    if (this._activeAgents.has(conversationId)) {
      throw new Error("Conversation is already running: " + conversationId);
    }

    conv.messages.push({
      role: "user",
      content: [{ type: "text", text }],
    });

    const agent = new Agent({
      provider: this._provider,
      transport: this._transport,
      model: this._model,
      system: this._system,
      tools: this._tools,
      maxTurns: this._maxTurns,
    });

    this._activeAgents.set(conversationId, agent);

    try {
      const history = await agent.run(conv.messages, this._executor, callbacks);
      conv.messages = history;
      return conv;
    } finally {
      this._activeAgents.delete(conversationId);
    }
  }

  abort(conversationId: string): void {
    const agent = this._activeAgents.get(conversationId);
    if (agent) {
      agent.abort();
    }
  }

  get(conversationId: string): Conversation | undefined {
    return this._conversations.get(conversationId);
  }

  list(): Conversation[] {
    return Array.from(this._conversations.values());
  }

  delete(conversationId: string): void {
    this._activeAgents.get(conversationId)?.abort();
    this._activeAgents.delete(conversationId);
    this._conversations.delete(conversationId);
  }
}
```

- [ ] **Step 3: Run tests**

Run: `cd packages/ai-assistant && pnpm test`
Expected: all conversation tests pass

- [ ] **Step 4: Write integration.test.ts**

```ts
// packages/ai-assistant/src/integration.test.ts

import { describe, it, expect, vi } from "vitest";
import { ConversationManager } from "./conversation.js";
import { ClaudeProvider } from "./providers/claude.js";
import { MockHttpTransport } from "./mock-transport.js";
import type { AgentCallbacks } from "./types.js";

describe("Integration: ConversationManager + ClaudeProvider + MockTransport", () => {
  it("single-turn text conversation", async () => {
    const provider = new ClaudeProvider({ apiKey: "test-key" });
    const transport = new MockHttpTransport();

    transport.onStream("https://api.anthropic.com/v1/messages", {
      chunks: [
        JSON.stringify({ type: "message_start", message: { id: "msg_1", role: "assistant" } }),
        JSON.stringify({ type: "content_block_start", index: 0, content_block: { type: "text", text: "" } }),
        JSON.stringify({ type: "content_block_delta", index: 0, delta: { type: "text_delta", text: "Hello from Claude!" } }),
        JSON.stringify({ type: "content_block_stop", index: 0 }),
        JSON.stringify({ type: "message_delta", delta: { stop_reason: "end_turn" } }),
      ],
    });

    const mgr = new ConversationManager({
      provider,
      transport,
      model: "claude-sonnet-4-20250514",
      system: "You are helpful.",
      executor: async () => "",
    });

    const conv = mgr.create();
    const result = await mgr.send(conv.id, "Hello!");

    expect(result.messages).toHaveLength(2);
    expect(result.messages[0].content[0]).toEqual({ type: "text", text: "Hello!" });
    expect(result.messages[1].role).toBe("assistant");

    // Verify the request was formatted correctly for Claude API
    const req = transport.requests[0];
    expect(req.url).toBe("https://api.anthropic.com/v1/messages");
    const body = JSON.parse(req.options.body!);
    expect(body.model).toBe("claude-sonnet-4-20250514");
    expect(body.system).toBe("You are helpful.");
    expect(body.stream).toBe(true);
  });

  it("multi-turn tool-use conversation", async () => {
    const provider = new ClaudeProvider({ apiKey: "test-key" });
    const transport = new MockHttpTransport();
    let callCount = 0;

    const origStream = transport.stream.bind(transport);

    transport.onStream("https://api.anthropic.com/v1/messages", {
      chunks: [
        JSON.stringify({ type: "message_start", message: { id: "msg_1", role: "assistant" } }),
        JSON.stringify({ type: "content_block_start", index: 0, content_block: { type: "text", text: "" } }),
        JSON.stringify({ type: "content_block_delta", index: 0, delta: { type: "text_delta", text: "Let me read that." } }),
        JSON.stringify({ type: "content_block_stop", index: 0 }),
        JSON.stringify({ type: "content_block_start", index: 1, content_block: { type: "tool_use", id: "toolu_1", name: "readFile", input: {} } }),
        JSON.stringify({ type: "content_block_delta", index: 1, delta: { type: "input_json_delta", partial_json: '{"path":"/main.ts"}' } }),
        JSON.stringify({ type: "content_block_stop", index: 1 }),
        JSON.stringify({ type: "message_delta", delta: { stop_reason: "tool_use" } }),
      ],
    });

    transport.stream = async (url, options, onChunk) => {
      callCount++;
      if (callCount === 1) return origStream(url, options, onChunk);
      // Second turn: text-only response
      const chunks = [
        JSON.stringify({ type: "message_start", message: { id: "msg_2", role: "assistant" } }),
        JSON.stringify({ type: "content_block_start", index: 0, content_block: { type: "text", text: "" } }),
        JSON.stringify({ type: "content_block_delta", index: 0, delta: { type: "text_delta", text: "The file contains a hello world program." } }),
        JSON.stringify({ type: "content_block_stop", index: 0 }),
        JSON.stringify({ type: "message_delta", delta: { stop_reason: "end_turn" } }),
      ];
      for (const c of chunks) onChunk(c);
    };

    const executor = vi.fn(async (name: string, input: Record<string, unknown>) => {
      if (name === "readFile") return 'console.log("hello world")';
      return "unknown tool";
    });

    const textDeltas: string[] = [];
    const toolStarts: string[] = [];

    const mgr = new ConversationManager({
      provider,
      transport,
      model: "claude-sonnet-4-20250514",
      tools: [
        {
          name: "readFile",
          description: "Read a file",
          parameters: {
            type: "object",
            properties: { path: { type: "string" } },
            required: ["path"],
          },
        },
      ],
      executor,
    });

    const conv = mgr.create();
    const result = await mgr.send(conv.id, "Read /main.ts", {
      onTextDelta: (t) => textDeltas.push(t),
      onToolStart: (id, name) => toolStarts.push(name),
    });

    expect(result.messages).toHaveLength(4);
    // User message
    expect(result.messages[0].role).toBe("user");
    // Assistant with tool_use
    expect(result.messages[1].role).toBe("assistant");
    expect(result.messages[1].content.some((p) => p.type === "tool_use")).toBe(true);
    // Tool result
    expect(result.messages[2].role).toBe("user");
    expect(result.messages[2].content[0]).toEqual({
      type: "tool_result",
      tool_use_id: "toolu_1",
      content: 'console.log("hello world")',
    });
    // Final assistant response
    expect(result.messages[3].role).toBe("assistant");

    expect(executor).toHaveBeenCalledWith("readFile", { path: "/main.ts" });
    expect(toolStarts).toContain("readFile");
    expect(textDeltas.join("")).toContain("Let me read that.");
  });
});
```

- [ ] **Step 5: Run tests**

Run: `cd packages/ai-assistant && pnpm test`
Expected: all tests pass

- [ ] **Step 6: Run full monorepo test suite**

Run: `pnpm -r run test`
Expected: all packages pass

- [ ] **Step 7: Build and verify dist/**

Run: `cd packages/ai-assistant && pnpm run build`
Run: `ls dist/`
Expected: `index.js`, `types.js`, `provider.js`, `transport.js`, `mock-transport.js`, `agent.js`, `conversation.js` all present with `.d.ts` counterparts, plus `providers/claude.js`, `providers/codex.js` with `.d.ts`

- [ ] **Step 8: Update index.ts — add Conversation exports**

Add to `packages/ai-assistant/src/index.ts`:

```ts
export type { Conversation } from "./conversation.js";
export { ConversationManager } from "./conversation.js";
```

- [ ] **Step 9: Commit**

```bash
git add packages/ai-assistant/src/conversation.ts \
  packages/ai-assistant/src/conversation.test.ts \
  packages/ai-assistant/src/integration.test.ts \
  packages/ai-assistant/src/index.ts
git commit -m "feat(ai-assistant): add ConversationManager and integration tests"
```
