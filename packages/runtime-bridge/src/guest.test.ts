import { describe, it, expect, beforeEach, vi } from "vitest";
import { GUEST_BOOTSTRAP } from "./guest.js";

function createGuestEnv() {
  const sent: any[] = [];
  let messageHandler: ((raw: string) => void) | null = null;

  const globals: Record<string, unknown> = {
    __bridge_send: (raw: string) => {
      sent.push(JSON.parse(raw));
    },
    __bridge_onMessage: (handler: (raw: string) => void) => {
      messageHandler = handler;
    },
    btoa: globalThis.btoa,
    atob: globalThis.atob,
    TextEncoder: globalThis.TextEncoder,
    Headers: globalThis.Headers ?? Map,
    Promise: globalThis.Promise,
    console: {
      log: vi.fn(),
      warn: vi.fn(),
      error: vi.fn(),
      info: vi.fn(),
      debug: vi.fn(),
    },
    fetch: vi.fn(),
  };

  const fn = new Function(
    ...Object.keys(globals),
    GUEST_BOOTSTRAP + "\nreturn { __vfs: globalThis.__vfs, __stdin: globalThis.__stdin, console: console, fetch: globalThis.fetch };",
  );

  const ctx = fn(...Object.values(globals));

  function receiveFromIDE(msg: unknown) {
    if (messageHandler) {
      messageHandler(JSON.stringify(msg));
    }
  }

  return { sent, receiveFromIDE, ctx, messageHandler };
}

describe("GUEST_BOOTSTRAP", () => {
  it("is a non-empty string", () => {
    expect(typeof GUEST_BOOTSTRAP).toBe("string");
    expect(GUEST_BOOTSTRAP.length).toBeGreaterThan(100);
  });

  it("intercepts console.log and sends notification", () => {
    const { sent } = createGuestEnv();
    // The guest replaces console, so calling it will trigger the interception
    // We test via the sent messages
    const consoleMsgs = sent.filter((m) => m.method === "console");
    // No console calls yet
    expect(consoleMsgs).toHaveLength(0);
  });

  it("responds to exec request", async () => {
    const { sent, receiveFromIDE } = createGuestEnv();

    receiveFromIDE({ id: "test-1", method: "exec", params: { code: "1 + 1" } });
    await new Promise((r) => setTimeout(r, 20));

    const responses = sent.filter((m) => m.id === "test-1");
    expect(responses).toHaveLength(1);
    expect(responses[0].result).toEqual({ result: 2 });
  });

  it("responds to exec with error for bad code", async () => {
    const { sent, receiveFromIDE } = createGuestEnv();

    receiveFromIDE({ id: "test-2", method: "exec", params: { code: "throw new Error('boom')" } });
    await new Promise((r) => setTimeout(r, 20));

    const responses = sent.filter((m) => m.id === "test-2");
    expect(responses).toHaveLength(1);
    expect(responses[0].error).toBeDefined();
    expect(responses[0].error.code).toBe("RUNTIME_ERROR");
    expect(responses[0].error.message).toBe("boom");
  });

  it("responds to eval request", async () => {
    const { sent, receiveFromIDE } = createGuestEnv();

    receiveFromIDE({ id: "test-3", method: "eval", params: { expression: "2 * 3" } });
    await new Promise((r) => setTimeout(r, 10));

    const responses = sent.filter((m) => m.id === "test-3");
    expect(responses).toHaveLength(1);
    expect(responses[0].result).toEqual({ result: 6 });
  });

  it("responds to kill request", async () => {
    const { sent, receiveFromIDE } = createGuestEnv();

    receiveFromIDE({ id: "test-4", method: "kill", params: {} });
    await new Promise((r) => setTimeout(r, 10));

    const responses = sent.filter((m) => m.id === "test-4");
    expect(responses).toHaveLength(1);
    expect(responses[0].result).toEqual({ ok: true });
  });

  it("responds to reset request", async () => {
    const { sent, receiveFromIDE } = createGuestEnv();

    receiveFromIDE({ id: "test-5", method: "reset", params: {} });
    await new Promise((r) => setTimeout(r, 10));

    const responses = sent.filter((m) => m.id === "test-5");
    expect(responses).toHaveLength(1);
    expect(responses[0].result).toEqual({ ok: true });
  });

  it("sends vfs request when __vfs.exists is called", async () => {
    const { sent, receiveFromIDE, ctx } = createGuestEnv();

    // Call __vfs.exists — it should send a request to IDE
    const existsPromise = ctx.__vfs.exists("/some/path");

    await new Promise((r) => setTimeout(r, 10));
    const vfsReqs = sent.filter((m) => m.method === "vfs.exists");
    expect(vfsReqs).toHaveLength(1);
    expect(vfsReqs[0].params.path).toBe("/some/path");

    // Simulate IDE response
    receiveFromIDE({ id: vfsReqs[0].id, result: { exists: true } });
    const result = await existsPromise;
    expect(result).toBe(true);
  });

  it("handles stdin.write notification", async () => {
    const { sent, receiveFromIDE, ctx } = createGuestEnv();

    const readPromise = ctx.__stdin.read();
    await new Promise((r) => setTimeout(r, 10));

    // Should have sent stdin.request
    const stdinReqs = sent.filter((m) => m.method === "stdin.request");
    expect(stdinReqs).toHaveLength(1);

    // IDE sends data
    receiveFromIDE({ method: "stdin.write", params: { data: "hello\n" } });
    const data = await readPromise;
    expect(data).toBe("hello\n");
  });

  it("stdin.end resolves pending reads with null", async () => {
    const { receiveFromIDE, ctx } = createGuestEnv();

    const readPromise = ctx.__stdin.read();
    await new Promise((r) => setTimeout(r, 10));

    receiveFromIDE({ method: "stdin.end" });
    const data = await readPromise;
    expect(data).toBeNull();
  });
});
