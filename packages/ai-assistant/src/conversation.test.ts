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
