import { describe, it, expect } from "vitest";
import { MockTransport } from "./transport.js";
import { RuntimeBridge } from "./runtime.js";
import { GUEST_BOOTSTRAP } from "./guest.js";
import { MemoryFS } from "@anthropic-ide/vfs";

function setupFullBridge(options?: { vfs?: InstanceType<typeof MemoryFS> }) {
  const [ideSide, guestSide] = MockTransport.createPair();

  let guestMessageHandler: ((raw: string) => void) | null = null;

  const globals: Record<string, unknown> = {
    __bridge_send: (raw: string) => {
      guestSide.send(raw);
    },
    __bridge_onMessage: (handler: (raw: string) => void) => {
      guestMessageHandler = handler;
    },
    btoa: globalThis.btoa,
    atob: globalThis.atob,
    TextEncoder: globalThis.TextEncoder,
    TextDecoder: globalThis.TextDecoder,
    Headers: globalThis.Headers ?? Map,
    Promise: globalThis.Promise,
    console: { ...console },
    Math: globalThis.Math,
    Array: globalThis.Array,
    Object: globalThis.Object,
    String: globalThis.String,
    JSON: globalThis.JSON,
    Uint8Array: globalThis.Uint8Array,
    Error: globalThis.Error,
    TypeError: globalThis.TypeError,
  };

  const guestFn = new Function(...Object.keys(globals), GUEST_BOOTSTRAP);
  guestFn(...Object.values(globals));

  guestSide.onMessage((raw) => {
    if (guestMessageHandler) {
      guestMessageHandler(raw);
    }
  });

  const bridge = new RuntimeBridge({
    transport: ideSide,
    vfs: options?.vfs,
  });

  return { bridge, guestSide };
}

describe("Integration: RuntimeBridge + GUEST_BOOTSTRAP", () => {
  it("exec runs code and returns result", async () => {
    const { bridge } = setupFullBridge();
    const result = await bridge.exec("return 40 + 2");
    expect(result.result).toEqual({ result: 42 });
  });

  it("console notifications reach bridge", async () => {
    const { bridge, guestSide } = setupFullBridge();
    const consoleEntries: any[] = [];
    bridge.onConsole((e) => consoleEntries.push(e));

    guestSide.send(JSON.stringify({ method: "console", params: { level: "log", args: ["hello from sandbox"] } }));
    await new Promise((r) => setTimeout(r, 20));

    expect(consoleEntries).toHaveLength(1);
    expect(consoleEntries[0].level).toBe("log");
    expect(consoleEntries[0].args).toContain("hello from sandbox");
  });

  it("exec reports runtime errors", async () => {
    const { bridge } = setupFullBridge();
    await expect(
      bridge.exec('throw new Error("test error")'),
    ).rejects.toThrow("test error");
  });

  it("eval preserves state between calls", async () => {
    const { bridge } = setupFullBridge();
    await bridge.eval("globalThis.testVar = 123");
    const result = await bridge.eval("globalThis.testVar");
    expect(result).toEqual({ result: 123 });
  });

  it("VFS proxy roundtrip through guest", async () => {
    const vfs = new MemoryFS();
    await vfs.writeFile("/hello.txt", new TextEncoder().encode("world"));
    const { bridge } = setupFullBridge({ vfs });

    const result = await bridge.exec(`
      var data = await globalThis.__vfs.readFile("/hello.txt");
      var text = new TextDecoder().decode(data);
      return text;
    `);
    expect(result.result).toEqual({ result: "world" });
  });

  it("VFS write through guest", async () => {
    const vfs = new MemoryFS();
    const { bridge } = setupFullBridge({ vfs });

    await bridge.exec(`
      await globalThis.__vfs.writeFile("/created.txt", "from guest");
    `);

    const content = await vfs.readFile("/created.txt");
    const text = new TextDecoder().decode(content);
    expect(text).toBe("from guest");
  });

  it("kill responds", async () => {
    const { bridge } = setupFullBridge();
    await bridge.kill();
  });

  it("reset clears state", async () => {
    const { bridge } = setupFullBridge();
    await bridge.reset();
  });
});
