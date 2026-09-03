// packages/runtime-bridge/src/types.test.ts
import { describe, it, expect } from "vitest";
import { isRequest, isResponse, isNotification } from "./types.js";
import type { Request, Response, Notification } from "./types.js";

describe("type guards", () => {
  it("isRequest identifies a request", () => {
    const req: Request = { id: "1", method: "exec" };
    expect(isRequest(req)).toBe(true);
    expect(isResponse(req)).toBe(false);
    expect(isNotification(req)).toBe(false);
  });

  it("isResponse identifies a response", () => {
    const res: Response = { id: "1", result: 42 };
    expect(isResponse(res)).toBe(true);
    expect(isRequest(res)).toBe(false);
    expect(isNotification(res)).toBe(false);
  });

  it("isResponse identifies an error response", () => {
    const res: Response = {
      id: "1",
      error: { code: "RUNTIME_ERROR", message: "oops" },
    };
    expect(isResponse(res)).toBe(true);
  });

  it("isNotification identifies a notification", () => {
    const notif: Notification = { method: "console", params: { level: "log", args: ["hi"] } };
    expect(isNotification(notif)).toBe(true);
    expect(isRequest(notif)).toBe(false);
    expect(isResponse(notif)).toBe(false);
  });
});
