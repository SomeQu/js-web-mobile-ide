// packages/runtime-bridge/src/protocol.ts
import type { Request, Response, Notification, Message, ErrorCode } from "./types.js";

let idCounter = 0;

export function generateId(): string {
  idCounter += 1;
  const random = Math.random().toString(36).slice(2, 8);
  return `${idCounter}-${random}`;
}

export function serialize(msg: Message): string {
  return JSON.stringify(msg);
}

export function deserialize(raw: string): Message {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new Error("Invalid JSON");
  }

  if (typeof parsed !== "object" || parsed === null) {
    throw new Error("Message must be an object");
  }

  const obj = parsed as Record<string, unknown>;

  if (typeof obj.id === "string" && typeof obj.method === "string") {
    return obj as unknown as Request;
  }
  if (typeof obj.id === "string" && !("method" in obj)) {
    return obj as unknown as Response;
  }
  if (!("id" in obj) && typeof obj.method === "string") {
    return obj as unknown as Notification;
  }

  throw new Error("Unknown message type");
}

export function createRequest(
  method: string,
  params?: Record<string, unknown>,
): Request {
  const req: Request = { id: generateId(), method };
  if (params !== undefined) {
    req.params = params;
  }
  return req;
}

export function createResponse(id: string, result: unknown): Response {
  return { id, result };
}

export function createErrorResponse(
  id: string,
  code: ErrorCode,
  message: string,
  data?: unknown,
): Response {
  const res: Response = { id, error: { code, message } };
  if (data !== undefined) {
    res.error!.data = data;
  }
  return res;
}

export function createNotification(
  method: string,
  params?: Record<string, unknown>,
): Notification {
  const notif: Notification = { method };
  if (params !== undefined) {
    notif.params = params;
  }
  return notif;
}
