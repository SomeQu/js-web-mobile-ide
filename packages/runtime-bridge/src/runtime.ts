// packages/runtime-bridge/src/runtime.ts
import type { IVirtualFileSystem } from "@anthropic-ide/vfs";
import type {
  Request,
  Response,
  Message,
  ConsoleEntry,
  ExecOptions,
  ExecResult,
} from "./types.js";
import { isRequest, isResponse, isNotification } from "./types.js";
import {
  serialize,
  deserialize,
  createRequest,
  createNotification,
} from "./protocol.js";
import type { ITransport } from "./transport.js";
import { ConsoleCollector } from "./console-capture.js";
import { VfsProxy } from "./vfs-proxy.js";
import { NetworkProxy } from "./network-proxy.js";
import type { NetworkHandler } from "./network-proxy.js";

export interface RuntimeBridgeOptions {
  transport: ITransport;
  vfs?: IVirtualFileSystem;
  networkHandler?: NetworkHandler;
  defaultTimeout?: number;
  onConsole?: (entry: ConsoleEntry) => void;
  onStdinRequest?: () => void;
  onExit?: (code: number) => void;
}

interface PendingRequest {
  resolve: (response: Response) => void;
  reject: (error: Error) => void;
  timer?: ReturnType<typeof setTimeout>;
}

export class RuntimeBridge {
  private readonly _transport: ITransport;
  private readonly _vfsProxy: VfsProxy | null;
  private readonly _networkProxy: NetworkProxy;
  private readonly _defaultTimeout: number;
  private readonly _pending = new Map<string, PendingRequest>();
  private readonly _consoleHandlers: Array<(entry: ConsoleEntry) => void> = [];
  private _onStdinRequest: (() => void) | null;
  private _onExit: ((code: number) => void) | null;
  private _executing = false;
  private _destroyed = false;
  private _execCollector: ConsoleCollector | null = null;

  constructor(options: RuntimeBridgeOptions) {
    this._transport = options.transport;
    this._vfsProxy = options.vfs ? new VfsProxy(options.vfs) : null;
    this._networkProxy = new NetworkProxy(options.networkHandler);
    this._defaultTimeout = options.defaultTimeout ?? 30000;
    this._onStdinRequest = options.onStdinRequest ?? null;
    this._onExit = options.onExit ?? null;

    if (options.onConsole) {
      this._consoleHandlers.push(options.onConsole);
    }

    this._transport.onMessage((raw: string) => {
      this._handleMessage(raw);
    });
  }

  get isExecuting(): boolean {
    return this._executing;
  }

  async exec(code: string, options?: ExecOptions): Promise<ExecResult> {
    this._checkDestroyed();
    if (this._executing) {
      throw new Error("Already executing");
    }

    this._executing = true;
    const collector = new ConsoleCollector();
    this._execCollector = collector;

    const timeout = options?.timeout ?? this._defaultTimeout;
    try {
      const response = await this._sendRequest("exec", { code }, timeout);

      if (response.error) {
        const err = new Error(response.error.message);
        (err as any).code = response.error.code;
        throw err;
      }

      return {
        result: response.result,
        console: collector.drain(),
      };
    } finally {
      this._executing = false;
      this._execCollector = null;
    }
  }

  async eval(expression: string): Promise<unknown> {
    this._checkDestroyed();

    const response = await this._sendRequest("eval", { expression });

    if (response.error) {
      const err = new Error(response.error.message);
      (err as any).code = response.error.code;
      throw err;
    }

    return response.result;
  }

  async kill(): Promise<void> {
    this._checkDestroyed();
    const response = await this._sendRequest("kill", {});
    if (response.error) {
      const err = new Error(response.error.message);
      (err as any).code = response.error.code;
      throw err;
    }
  }

  async reset(): Promise<void> {
    this._checkDestroyed();
    const response = await this._sendRequest("reset", {});
    if (response.error) {
      const err = new Error(response.error.message);
      (err as any).code = response.error.code;
      throw err;
    }
  }

  writeStdin(data: string): void {
    this._checkDestroyed();
    this._sendNotification("stdin.write", { data });
  }

  endStdin(): void {
    this._checkDestroyed();
    this._sendNotification("stdin.end", {});
  }

  onConsole(handler: (entry: ConsoleEntry) => void): () => void {
    this._consoleHandlers.push(handler);
    return () => {
      const idx = this._consoleHandlers.indexOf(handler);
      if (idx >= 0) {
        this._consoleHandlers.splice(idx, 1);
      }
    };
  }

  destroy(): void {
    this._destroyed = true;
    this._transport.close();

    for (const [, pending] of this._pending) {
      if (pending.timer !== undefined) {
        clearTimeout(pending.timer);
      }
      pending.reject(new Error("Bridge destroyed"));
    }
    this._pending.clear();
    this._consoleHandlers.length = 0;
  }

  private _checkDestroyed(): void {
    if (this._destroyed) {
      throw new Error("Bridge is destroyed");
    }
  }

  private _sendRequest(
    method: string,
    params: Record<string, unknown>,
    timeout?: number,
  ): Promise<Response> {
    return new Promise<Response>((resolve, reject) => {
      const request = createRequest(method, params);
      const pending: PendingRequest = { resolve, reject };

      if (timeout !== undefined && timeout > 0) {
        pending.timer = setTimeout(() => {
          this._pending.delete(request.id);
          reject(Object.assign(new Error("Execution timed out"), { code: "TIMEOUT" }));
        }, timeout);
      }

      this._pending.set(request.id, pending);
      this._transport.send(serialize(request));
    });
  }

  private _sendNotification(
    method: string,
    params: Record<string, unknown>,
  ): void {
    const notif = createNotification(method, params);
    this._transport.send(serialize(notif));
  }

  private _handleMessage(raw: string): void {
    let msg: Message;
    try {
      msg = deserialize(raw);
    } catch {
      return;
    }

    if (isResponse(msg)) {
      this._handleResponse(msg);
    } else if (isRequest(msg)) {
      this._handleIncomingRequest(msg);
    } else if (isNotification(msg)) {
      this._handleNotification(msg);
    }
  }

  private _handleResponse(response: Response): void {
    const pending = this._pending.get(response.id);
    if (!pending) {
      return;
    }
    this._pending.delete(response.id);
    if (pending.timer !== undefined) {
      clearTimeout(pending.timer);
    }
    pending.resolve(response);
  }

  private _handleIncomingRequest(request: Request): void {
    const method = request.method;

    if (method.startsWith("vfs.")) {
      if (this._vfsProxy) {
        this._vfsProxy.handleRequest(request).then((response) => {
          this._transport.send(serialize(response));
        }).catch(() => {
          const errResp = { id: request.id, error: { code: "VFS_ERROR" as const, message: "Internal VFS error" } };
          this._transport.send(serialize(errResp));
        });
      } else {
        const response = {
          id: request.id,
          error: { code: "VFS_ERROR" as const, message: "VFS not available" },
        };
        this._transport.send(serialize(response));
      }
      return;
    }

    if (method === "fetch") {
      this._networkProxy.handleRequest(request).then((response) => {
        this._transport.send(serialize(response));
      }).catch(() => {
        const errResp = { id: request.id, error: { code: "NETWORK_ERROR" as const, message: "Internal network error" } };
        this._transport.send(serialize(errResp));
      });
      return;
    }

    const unknownResp = { id: request.id, error: { code: "METHOD_NOT_FOUND" as const, message: `Unknown method: ${method}` } };
    this._transport.send(serialize(unknownResp));
  }

  private _handleNotification(notification: { method: string; params?: Record<string, unknown> }): void {
    const params = notification.params || {};

    switch (notification.method) {
      case "console": {
        const entry: ConsoleEntry = {
          level: params.level as ConsoleEntry["level"],
          args: params.args as unknown[],
          timestamp: Date.now(),
        };
        if (this._execCollector) {
          this._execCollector.push(entry.level, entry.args);
        }
        for (const handler of this._consoleHandlers) {
          handler(entry);
        }
        break;
      }
      case "stdin.request": {
        if (this._onStdinRequest) {
          this._onStdinRequest();
        }
        break;
      }
      case "exit": {
        if (this._onExit) {
          this._onExit(params.code as number);
        }
        break;
      }
    }
  }
}
