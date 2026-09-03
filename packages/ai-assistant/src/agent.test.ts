// packages/ai-assistant/src/agent.test.ts

import { describe, it, expect, vi } from "vitest";
import { Agent } from "./agent.js";
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
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
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
