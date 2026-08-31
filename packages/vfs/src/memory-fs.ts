import { normalize, dirname, basename, segments } from "./path-utils.js";
import type { FileStat, IVirtualFileSystem, MkdirOptions } from "./types.js";
import {
  FileNotFoundError,
  FileExistsError,
  NotADirectoryError,
  IsADirectoryError,
  DirectoryNotEmptyError,
  VfsError,
} from "./errors.js";

type FileNode = { kind: "file"; content: Uint8Array; mtime: number };
type DirNode = { kind: "dir"; children: Map<string, FsNode>; mtime: number };
type SymlinkNode = { kind: "symlink"; target: string; mtime: number };
type FsNode = FileNode | DirNode | SymlinkNode;

const encoder = new TextEncoder();

export class MemoryFS implements IVirtualFileSystem {
  private root: DirNode = { kind: "dir", children: new Map(), mtime: Date.now() };
  private readonly maxSymlinkDepth = 40;

  private getNode(path: string, followSymlinks = true): FsNode | undefined {
    return this.getNodeRaw(path, followSymlinks, 0);
  }

  private getNodeRaw(path: string, followSymlinks: boolean, depth: number): FsNode | undefined {
    if (depth > this.maxSymlinkDepth) {
      throw new VfsError("ELOOP: too many levels of symbolic links", "ELOOP", path);
    }

    const norm = normalize(path);
    if (norm === "/") return this.root;

    const parts = segments(norm);
    let current: FsNode = this.root;

    for (let i = 0; i < parts.length; i++) {
      if (current.kind === "symlink" && followSymlinks) {
        const resolved = this.getNodeRaw(current.target, true, depth + 1);
        if (!resolved) return undefined;
        current = resolved;
      }
      if (current.kind !== "dir") return undefined;
      const child = current.children.get(parts[i]);
      if (!child) return undefined;
      current = child;
    }

    if (current.kind === "symlink" && followSymlinks) {
      return this.getNodeRaw(current.target, true, depth + 1);
    }

    return current;
  }

  private getParentDir(path: string): DirNode {
    const parentPath = dirname(path);
    const parent = this.getNode(parentPath);
    if (!parent) throw new FileNotFoundError(parentPath);
    if (parent.kind !== "dir") throw new NotADirectoryError(parentPath);
    return parent;
  }

  private ensureParentDirs(path: string): DirNode {
    const norm = normalize(path);
    const parts = segments(dirname(norm));
    let current: DirNode = this.root;

    for (const part of parts) {
      let child = current.children.get(part);
      if (!child) {
        child = { kind: "dir", children: new Map(), mtime: Date.now() };
        current.children.set(part, child);
      }
      if (child.kind === "symlink") {
        const resolved = this.getNode(child.target);
        if (!resolved || resolved.kind !== "dir") throw new NotADirectoryError(part);
        current = resolved as DirNode;
        continue;
      }
      if (child.kind !== "dir") throw new NotADirectoryError(part);
      current = child;
    }

    return current;
  }

  async readFile(path: string): Promise<Uint8Array> {
    const norm = normalize(path);
    const node = this.getNode(norm);
    if (!node) throw new FileNotFoundError(norm);
    if (node.kind === "dir") throw new IsADirectoryError(norm);
    if (node.kind !== "file") throw new FileNotFoundError(norm);
    return node.content.slice();
  }

  async writeFile(path: string, content: Uint8Array | string): Promise<void> {
    const norm = normalize(path);
    const data = typeof content === "string" ? encoder.encode(content) : content;

    let targetParent = this.ensureParentDirs(norm);
    let targetName = basename(norm);
    let existing = targetParent.children.get(targetName);

    let depth = 0;
    while (existing && existing.kind === "symlink") {
      if (depth++ > this.maxSymlinkDepth) {
        throw new VfsError("ELOOP: too many levels of symbolic links", "ELOOP", norm);
      }
      const resolvedPath = normalize(existing.target);
      targetParent = this.ensureParentDirs(resolvedPath);
      targetName = basename(resolvedPath);
      existing = targetParent.children.get(targetName);
    }

    if (existing && existing.kind === "dir") throw new IsADirectoryError(norm);
    targetParent.children.set(targetName, { kind: "file", content: data.slice(), mtime: Date.now() });
  }

  async mkdir(path: string, options?: MkdirOptions): Promise<void> {
    const norm = normalize(path);
    if (options?.recursive) {
      const parts = segments(norm);
      let current: DirNode = this.root;
      for (const part of parts) {
        let child = current.children.get(part);
        if (!child) {
          child = { kind: "dir", children: new Map(), mtime: Date.now() };
          current.children.set(part, child);
        }
        if (child.kind === "symlink") {
          const resolved = this.getNode(child.target);
          if (!resolved || resolved.kind !== "dir") throw new NotADirectoryError(norm);
          current = resolved as DirNode;
          continue;
        }
        if (child.kind !== "dir") throw new NotADirectoryError(norm);
        current = child;
      }
      return;
    }
    const parent = this.getParentDir(norm);
    const name = basename(norm);
    if (parent.children.has(name)) throw new FileExistsError(norm);
    parent.children.set(name, { kind: "dir", children: new Map(), mtime: Date.now() });
  }

  async readdir(path: string): Promise<string[]> {
    const norm = normalize(path);
    const node = this.getNode(norm);
    if (!node) throw new FileNotFoundError(norm);
    if (node.kind !== "dir") throw new NotADirectoryError(norm);
    return [...node.children.keys()];
  }

  async stat(path: string): Promise<FileStat> {
    const norm = normalize(path);
    const node = this.getNode(norm, true);
    if (!node) throw new FileNotFoundError(norm);
    return this.nodeToStat(node);
  }

  async lstat(path: string): Promise<FileStat> {
    const norm = normalize(path);
    const node = this.getNode(norm, false);
    if (!node) throw new FileNotFoundError(norm);
    return this.nodeToStat(node);
  }

  private nodeToStat(node: FsNode): FileStat {
    switch (node.kind) {
      case "file":
        return { type: "file", size: node.content.byteLength, mtime: node.mtime };
      case "dir":
        return { type: "directory", size: 0, mtime: node.mtime };
      case "symlink":
        return { type: "symlink", size: 0, mtime: node.mtime };
    }
  }

  async exists(path: string): Promise<boolean> {
    const norm = normalize(path);
    return this.getNode(norm) !== undefined;
  }

  async rmdir(path: string, options?: { recursive?: boolean }): Promise<void> {
    const norm = normalize(path);
    const node = this.getNode(norm);
    if (!node) throw new FileNotFoundError(norm);
    if (node.kind !== "dir") throw new NotADirectoryError(norm);
    if (!options?.recursive && node.children.size > 0) throw new DirectoryNotEmptyError(norm);
    const parent = this.getParentDir(norm);
    parent.children.delete(basename(norm));
  }

  async unlink(path: string): Promise<void> {
    const norm = normalize(path);
    const node = this.getNode(norm, false);
    if (!node) throw new FileNotFoundError(norm);
    if (node.kind === "dir") throw new IsADirectoryError(norm);
    const parent = this.getParentDir(norm);
    parent.children.delete(basename(norm));
  }

  async rename(oldPath: string, newPath: string): Promise<void> {
    const normOld = normalize(oldPath);
    const normNew = normalize(newPath);
    const oldParent = this.getParentDir(normOld);
    const oldName = basename(normOld);
    const node = oldParent.children.get(oldName);
    if (!node) throw new FileNotFoundError(normOld);
    const newParent = this.ensureParentDirs(normNew);
    const newName = basename(normNew);
    oldParent.children.delete(oldName);
    newParent.children.set(newName, node);
  }

  async symlink(target: string, path: string): Promise<void> {
    const norm = normalize(path);
    const parent = this.getParentDir(norm);
    const name = basename(norm);
    if (parent.children.has(name)) throw new FileExistsError(norm);
    parent.children.set(name, { kind: "symlink", target: normalize(target), mtime: Date.now() });
  }

  async readlink(path: string): Promise<string> {
    const norm = normalize(path);
    const node = this.getNode(norm, false);
    if (!node) throw new FileNotFoundError(norm);
    if (node.kind !== "symlink") throw new VfsError("EINVAL: not a symlink", "EINVAL", norm);
    return node.target;
  }
}
