// packages/runtime-bridge/src/protocol.test.ts
import { describe, it, expect } from "vitest";
import {
  generateId,
  serialize,
  deserialize,
  createRequest,
  createResponse,
  createErrorResponse,
  createNotification,
} from "./protocol.js";
import { isRequest, isResponse, isNotification } from "./types.js";

describe("generateId", () => {
  it("returns unique ids", () => {
    const ids = new Set(Array.from({ length: 100 }, () => generateId()));
    expect(ids.size).toBe(100);
  });
});

describe("serialize / deserialize", () => {
  it("roundtrips a request", () => {
    const req = createRequest("exec", { code: "1+1" });
    const raw = serialize(req);
    const parsed = deserialize(raw);
    expect(isRequest(parsed)).toBe(true);
    expect(parsed).toEqual(req);
  });

  it("roundtrips a response", () => {
    const res = createResponse("42", { value: true });
    const raw = serialize(res);
    const parsed = deserialize(raw);
    expect(isResponse(parsed)).toBe(true);
    expect(parsed).toEqual(res);
  });

  it("roundtrips an error response", () => {
    const res = createErrorResponse("7", "TIMEOUT", "timed out", { elapsed: 5000 });
    const raw = serialize(res);
    const parsed = deserialize(raw);
    expect(isResponse(parsed)).toBe(true);
    expect((parsed as any).error.code).toBe("TIMEOUT");
    expect((parsed as any).error.data).toEqual({ elapsed: 5000 });
  });

  it("roundtrips a notification", () => {
    const notif = createNotification("console", { level: "log", args: ["hi"] });
    const raw = serialize(notif);
    const parsed = deserialize(raw);
    expect(isNotification(parsed)).toBe(true);
    expect(parsed).toEqual(notif);
  });

  it("throws on invalid JSON", () => {
    expect(() => deserialize("not json")).toThrow("Invalid JSON");
  });

  it("throws on non-object", () => {
    expect(() => deserialize('"hello"')).toThrow("Message must be an object");
  });

  it("throws on unknown structure", () => {
    expect(() => deserialize('{"foo": "bar"}')).toThrow("Unknown message type");
  });
});

describe("createRequest", () => {
  it("creates request without params", () => {
    const req = createRequest("kill");
    expect(req.method).toBe("kill");
    expect(req.id).toBeTruthy();
    expect(req.params).toBeUndefined();
  });

  it("creates request with params", () => {
    const req = createRequest("exec", { code: "x" });
    expect(req.params).toEqual({ code: "x" });
  });
});

describe("createNotification", () => {
  it("creates notification without params", () => {
    const n = createNotification("stdin.end");
    expect(n.method).toBe("stdin.end");
    expect(n.params).toBeUndefined();
    expect("id" in n).toBe(false);
  });
});
