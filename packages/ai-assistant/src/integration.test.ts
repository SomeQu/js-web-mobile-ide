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
