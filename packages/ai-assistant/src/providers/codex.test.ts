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
