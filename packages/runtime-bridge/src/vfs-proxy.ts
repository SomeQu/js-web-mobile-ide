// packages/runtime-bridge/src/vfs-proxy.ts
import type { IVirtualFileSystem } from "@anthropic-ide/vfs";
import type { Request, Response } from "./types.js";
import { createResponse, createErrorResponse } from "./protocol.js";

function uint8ToBase64(data: Uint8Array): string {
  let binary = "";
  for (let i = 0; i < data.length; i++) {
    binary += String.fromCharCode(data[i]);
  }
  return btoa(binary);
}

function base64ToUint8(b64: string): Uint8Array {
  const binary = atob(b64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes;
}

export class VfsProxy {
  private readonly _vfs: IVirtualFileSystem;

  constructor(vfs: IVirtualFileSystem) {
    this._vfs = vfs;
  }

  async handleRequest(request: Request): Promise<Response> {
    const params = (request.params || {}) as Record<string, unknown>;
    const method = request.method;

    try {
      switch (method) {
        case "vfs.readFile": {
          const data = await this._vfs.readFile(params.path as string);
          return createResponse(request.id, { data: uint8ToBase64(data) });
        }
        case "vfs.writeFile": {
          const decoded = base64ToUint8(params.data as string);
          await this._vfs.writeFile(params.path as string, decoded);
          return createResponse(request.id, { ok: true });
        }
        case "vfs.readdir": {
          const entries = await this._vfs.readdir(params.path as string);
          return createResponse(request.id, { entries });
        }
        case "vfs.stat": {
          const stat = await this._vfs.stat(params.path as string);
          return createResponse(request.id, {
            type: stat.type,
            size: stat.size,
            mtime: stat.mtime,
          });
        }
        case "vfs.lstat": {
          const stat = await this._vfs.lstat(params.path as string);
          return createResponse(request.id, {
            type: stat.type,
            size: stat.size,
            mtime: stat.mtime,
          });
        }
        case "vfs.mkdir": {
          await this._vfs.mkdir(
            params.path as string,
            params.recursive ? { recursive: true } : undefined,
          );
          return createResponse(request.id, { ok: true });
        }
        case "vfs.rmdir": {
          await this._vfs.rmdir(
            params.path as string,
            params.recursive ? { recursive: true } : undefined,
          );
          return createResponse(request.id, { ok: true });
        }
        case "vfs.unlink": {
          await this._vfs.unlink(params.path as string);
          return createResponse(request.id, { ok: true });
        }
        case "vfs.rename": {
          await this._vfs.rename(
            params.oldPath as string,
            params.newPath as string,
          );
          return createResponse(request.id, { ok: true });
        }
        case "vfs.exists": {
          const exists = await this._vfs.exists(params.path as string);
          return createResponse(request.id, { exists });
        }
        case "vfs.symlink": {
          await this._vfs.symlink(
            params.target as string,
            params.path as string,
          );
          return createResponse(request.id, { ok: true });
        }
        case "vfs.readlink": {
          const target = await this._vfs.readlink(params.path as string);
          return createResponse(request.id, { target });
        }
        default:
          return createErrorResponse(
            request.id,
            "VFS_ERROR",
            `Unknown VFS method: ${method}`,
          );
      }
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      return createErrorResponse(request.id, "VFS_ERROR", message);
    }
  }
}
