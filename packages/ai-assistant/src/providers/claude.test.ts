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
