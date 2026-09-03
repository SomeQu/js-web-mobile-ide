// packages/git-client/src/fs-adapter.ts

import type { FsAdapter, FsAdapterStats, VfsLike } from "./types.js";

function makeStat(vfsStat: { type: "file" | "directory" | "symlink"; size: number; mtime: number }): FsAdapterStats {
  const t = vfsStat.type;
  return {
    type: t,
    mode: t === "directory" ? 0o755 : 0o644,
    size: vfsStat.size,
    mtimeMs: vfsStat.mtime,
    isFile: () => t === "file",
    isDirectory: () => t === "directory",
    isSymbolicLink: () => t === "symlink",
  };
}

function createAdapter(vfs: VfsLike): FsAdapter {
  return {
    async readFile(filepath: string, opts?: { encoding?: string }): Promise<Uint8Array | string> {
      const data = await vfs.readFile(filepath);
      if (opts?.encoding) {
        return new TextDecoder().decode(data);
      }
      return data;
    },
    async writeFile(filepath: string, data: Uint8Array | string): Promise<void> {
      await vfs.writeFile(filepath, data);
    },
    async unlink(filepath: string): Promise<void> {
      await vfs.unlink(filepath);
    },
    async readdir(filepath: string): Promise<string[]> {
      return vfs.readdir(filepath);
    },
    async mkdir(filepath: string): Promise<void> {
      await vfs.mkdir(filepath);
    },
    async rmdir(filepath: string): Promise<void> {
      await vfs.rmdir(filepath);
    },
    async stat(filepath: string): Promise<FsAdapterStats> {
      return makeStat(await vfs.stat(filepath));
    },
    async lstat(filepath: string): Promise<FsAdapterStats> {
      return makeStat(await vfs.lstat(filepath));
    },
    async rename(oldPath: string, newPath: string): Promise<void> {
      await vfs.rename(oldPath, newPath);
    },
    async readlink(filepath: string): Promise<string> {
      return vfs.readlink(filepath);
    },
    async symlink(target: string, filepath: string): Promise<void> {
      await vfs.symlink(target, filepath);
    },
  };
}

export function createFsAdapter(vfs: VfsLike): { promises: FsAdapter } {
  return { promises: createAdapter(vfs) };
}
