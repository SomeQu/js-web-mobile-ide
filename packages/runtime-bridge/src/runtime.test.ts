// packages/runtime-bridge/src/runtime.test.ts
import { describe, it, expect, vi, beforeEach } from "vitest";
import { MockTransport } from "./transport.js";
import { RuntimeBridge } from "./runtime.js";
import { serialize, deserialize, createResponse, createErrorResponse, createNotification } from "./protocol.js";
import { isRequest } from "./types.js";
import type { Request, ConsoleEntry } from "./types.js";
import { MemoryFS } from "@anthropic-ide/vfs";

function setupBridge(options?: { vfs?: InstanceType<typeof MemoryFS>; defaultTimeout?: number }) {
  const [ideSide, guestSide] = MockTransport.createPair();
  const bridge = new RuntimeBridge({
    transport: ideSide,
    vfs: options?.vfs,
    defaultTimeout: options?.defaultTimeout,
  });
  return { bridge, ideSide, guestSide };
}

function autoRespond(
  guestSide: MockTransport,
  handler: (req: Request) => unknown,
): void {
  guestSide.onMessage((raw) => {
    const msg = deserialize(raw);
    if (isRequest(msg)) {
      const result = handler(msg);
      if (result !== undefined) {
        guestSide.send(serialize(createResponse(msg.id, result)));
      }
    }
  });
}

describe("RuntimeBridge", () => {
  describe("exec", () => {
    it("sends exec request and returns result", async () => {
      const { bridge, guestSide } = setupBridge();
      autoRespond(guestSide, (req) => {
        if (req.method === "exec") return { result: 42 };
      });

      const result = await bridge.exec("1 + 1");
      expect(result.result).toEqual({ result: 42 });
    });

    it("collects console entries during exec", async () => {
      const { bridge, guestSide } = setupBridge();
      guestSide.onMessage((raw) => {
        const msg = deserialize(raw);
        if (isRequest(msg) && msg.method === "exec") {
          guestSide.send(serialize(createNotification("console", { level: "log", args: ["hello"] })));
          guestSide.send(serialize(createNotification("console", { level: "warn", args: ["warning!"] })));
          setTimeout(() => {
            guestSide.send(serialize(createResponse(msg.id, { result: "done" })));
          }, 10);
        }
      });

      const result = await bridge.exec("code");
      expect(result.console).toHaveLength(2);
      expect(result.console[0].level).toBe("log");
      expect(result.console[0].args).toEqual(["hello"]);
      expect(result.console[1].level).toBe("warn");
    });

    it("rejects with RUNTIME_ERROR on error response", async () => {
      const { bridge, guestSide } = setupBridge();
      guestSide.onMessage((raw) => {
        const msg = deserialize(raw);
        if (isRequest(msg) && msg.method === "exec") {
          guestSide.send(serialize(createErrorResponse(msg.id, "RUNTIME_ERROR", "ReferenceError: x is not defined")));
        }
      });

      await expect(bridge.exec("x")).rejects.toThrow("ReferenceError: x is not defined");
    });

    it("rejects on timeout", async () => {
      const { bridge } = setupBridge({ defaultTimeout: 50 });

      await expect(bridge.exec("while(true){}")).rejects.toThrow("Execution timed out");
    });

    it("rejects concurrent exec", async () => {
      const { bridge, guestSide } = setupBridge();
      guestSide.onMessage((raw) => {
        const msg = deserialize(raw);
        if (isRequest(msg) && msg.method === "exec") {
          setTimeout(() => {
            guestSide.send(serialize(createResponse(msg.id, { result: 1 })));
          }, 50);
        }
      });

      const p1 = bridge.exec("first");
      await expect(bridge.exec("second")).rejects.toThrow("Already executing");
      await p1;
    });
  });

  describe("eval", () => {
    it("sends eval request and returns result", async () => {
      const { bridge, guestSide } = setupBridge();
      autoRespond(guestSide, (req) => {
        if (req.method === "eval") return { result: "evaluated" };
      });

      const result = await bridge.eval("2 + 2");
      expect(result).toEqual({ result: "evaluated" });
    });

    it("rejects on error response", async () => {
      const { bridge, guestSide } = setupBridge();
      guestSide.onMessage((raw) => {
        const msg = deserialize(raw);
        if (isRequest(msg)) {
          guestSide.send(serialize(createErrorResponse(msg.id, "RUNTIME_ERROR", "SyntaxError")));
        }
      });

      await expect(bridge.eval("{{")).rejects.toThrow("SyntaxError");
    });
  });

  describe("kill", () => {
    it("sends kill request", async () => {
      const { bridge, guestSide } = setupBridge();
      autoRespond(guestSide, (req) => {
        if (req.method === "kill") return { ok: true };
      });

      await bridge.kill();
    });
  });

  describe("reset", () => {
    it("sends reset request", async () => {
      const { bridge, guestSide } = setupBridge();
      autoRespond(guestSide, (req) => {
        if (req.method === "reset") return { ok: true };
      });

      await bridge.reset();
    });
  });

  describe("stdin", () => {
    it("writeStdin sends notification", async () => {
      const { bridge, guestSide } = setupBridge();
      const received: string[] = [];
      guestSide.onMessage((raw) => received.push(raw));

      bridge.writeStdin("user input\n");
      await new Promise((r) => setTimeout(r, 10));
      expect(received).toHaveLength(1);
      const parsed = deserialize(received[0]);
      expect(parsed).toMatchObject({ method: "stdin.write", params: { data: "user input\n" } });
    });

    it("endStdin sends notification", async () => {
      const { bridge, guestSide } = setupBridge();
      const received: string[] = [];
      guestSide.onMessage((raw) => received.push(raw));

      bridge.endStdin();
      await new Promise((r) => setTimeout(r, 10));
      const parsed = deserialize(received[0]);
      expect(parsed).toMatchObject({ method: "stdin.end" });
    });

    it("stdin.request notification triggers onStdinRequest", async () => {
      const [ideSide, guestSide] = MockTransport.createPair();
      const stdinFn = vi.fn();
      const bridge = new RuntimeBridge({
        transport: ideSide,
        onStdinRequest: stdinFn,
      });

      guestSide.send(serialize(createNotification("stdin.request", {})));
      await new Promise((r) => setTimeout(r, 10));
      expect(stdinFn).toHaveBeenCalled();
    });
  });

  describe("console subscription", () => {
    it("onConsole handler receives entries", async () => {
      const { bridge, guestSide } = setupBridge();
      const entries: ConsoleEntry[] = [];
      bridge.onConsole((e) => entries.push(e));

      guestSide.send(serialize(createNotification("console", { level: "error", args: ["fail"] })));
      await new Promise((r) => setTimeout(r, 10));

      expect(entries).toHaveLength(1);
      expect(entries[0].level).toBe("error");
    });

    it("unsubscribe stops delivery", async () => {
      const { bridge, guestSide } = setupBridge();
      const entries: ConsoleEntry[] = [];
      const unsub = bridge.onConsole((e) => entries.push(e));

      guestSide.send(serialize(createNotification("console", { level: "log", args: ["1"] })));
      await new Promise((r) => setTimeout(r, 10));
      unsub();
      guestSide.send(serialize(createNotification("console", { level: "log", args: ["2"] })));
      await new Promise((r) => setTimeout(r, 10));

      expect(entries).toHaveLength(1);
    });
  });

  describe("exit notification", () => {
    it("triggers onExit callback", async () => {
      const [ideSide, guestSide] = MockTransport.createPair();
      const exitFn = vi.fn();
      const bridge = new RuntimeBridge({
        transport: ideSide,
        onExit: exitFn,
      });

      guestSide.send(serialize(createNotification("exit", { code: 1 })));
      await new Promise((r) => setTimeout(r, 10));
      expect(exitFn).toHaveBeenCalledWith(1);
    });
  });

  describe("VFS proxy", () => {
    it("proxies vfs.readFile request to VFS", async () => {
      const vfs = new MemoryFS();
      await vfs.writeFile("/test.txt", new TextEncoder().encode("hello"));
      const { bridge, guestSide } = setupBridge({ vfs });

      const received: string[] = [];
      const origHandler = guestSide.onMessage.bind(guestSide);

      guestSide.onMessage((raw) => received.push(raw));

      // Guest sends a VFS request
      const req = { id: "vfs-1", method: "vfs.readFile", params: { path: "/test.txt" } };
      guestSide.send(serialize(req));
      await new Promise((r) => setTimeout(r, 50));

      expect(received.length).toBeGreaterThanOrEqual(1);
      const response = deserialize(received[0]);
      expect(response).toHaveProperty("id", "vfs-1");
      expect((response as any).result.data).toBeTruthy();
    });

    it("returns VFS_ERROR when vfs not provided", async () => {
      const { bridge, guestSide } = setupBridge();
      const received: string[] = [];
      guestSide.onMessage((raw) => received.push(raw));

      guestSide.send(serialize({ id: "v1", method: "vfs.readFile", params: { path: "/x" } }));
      await new Promise((r) => setTimeout(r, 20));

      const response = deserialize(received[0]);
      expect((response as any).error.code).toBe("VFS_ERROR");
    });
  });

  describe("network proxy", () => {
    it("returns NETWORK_ERROR when handler not provided", async () => {
      const { bridge, guestSide } = setupBridge();
      const received: string[] = [];
      guestSide.onMessage((raw) => received.push(raw));

      guestSide.send(serialize({ id: "f1", method: "fetch", params: { url: "https://example.com" } }));
      await new Promise((r) => setTimeout(r, 20));

      const response = deserialize(received[0]);
      expect((response as any).error.code).toBe("NETWORK_ERROR");
    });
  });

  describe("isExecuting", () => {
    it("is true during exec", async () => {
      const { bridge, guestSide } = setupBridge();
      expect(bridge.isExecuting).toBe(false);

      guestSide.onMessage((raw) => {
        const msg = deserialize(raw);
        if (isRequest(msg) && msg.method === "exec") {
          expect(bridge.isExecuting).toBe(true);
          guestSide.send(serialize(createResponse(msg.id, { result: 1 })));
        }
      });

      await bridge.exec("x");
      expect(bridge.isExecuting).toBe(false);
    });
  });

  describe("destroy", () => {
    it("rejects pending requests", async () => {
      const { bridge } = setupBridge();

      const execPromise = bridge.exec("code", { timeout: 5000 });
      bridge.destroy();

      await expect(execPromise).rejects.toThrow("Bridge destroyed");
    });

    it("throws on use after destroy", () => {
      const { bridge } = setupBridge();
      bridge.destroy();
      expect(() => bridge.writeStdin("x")).toThrow("Bridge is destroyed");
    });
  });
});
