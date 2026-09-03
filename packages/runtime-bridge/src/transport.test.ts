// packages/runtime-bridge/src/transport.test.ts
import { describe, it, expect, vi } from "vitest";
import { MockTransport } from "./transport.js";

describe("MockTransport", () => {
  it("createPair delivers messages between peers", async () => {
    const [a, b] = MockTransport.createPair();
    const received: string[] = [];
    b.onMessage((msg) => received.push(msg));

    a.send("hello");
    await new Promise((r) => setTimeout(r, 10));

    expect(received).toEqual(["hello"]);
    expect(a.messages).toEqual(["hello"]);
  });

  it("delivers in both directions", async () => {
    const [a, b] = MockTransport.createPair();
    const fromA: string[] = [];
    const fromB: string[] = [];
    b.onMessage((msg) => fromA.push(msg));
    a.onMessage((msg) => fromB.push(msg));

    a.send("ping");
    b.send("pong");
    await new Promise((r) => setTimeout(r, 10));

    expect(fromA).toEqual(["ping"]);
    expect(fromB).toEqual(["pong"]);
  });

  it("records sent messages", () => {
    const [a, b] = MockTransport.createPair();
    a.send("one");
    a.send("two");
    expect(a.messages).toEqual(["one", "two"]);
  });

  it("does not deliver after close", async () => {
    const [a, b] = MockTransport.createPair();
    const received: string[] = [];
    b.onMessage((msg) => received.push(msg));
    b.close();

    a.send("after-close");
    await new Promise((r) => setTimeout(r, 10));
    expect(received).toEqual([]);
  });

  it("throws on send after self close", () => {
    const [a] = MockTransport.createPair();
    a.close();
    expect(() => a.send("fail")).toThrow("Transport is closed");
  });

  it("delivers multiple messages in order", async () => {
    const [a, b] = MockTransport.createPair();
    const received: string[] = [];
    b.onMessage((msg) => received.push(msg));

    a.send("1");
    a.send("2");
    a.send("3");
    await new Promise((r) => setTimeout(r, 10));

    expect(received).toEqual(["1", "2", "3"]);
  });
});
