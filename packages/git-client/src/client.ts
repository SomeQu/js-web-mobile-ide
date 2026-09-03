// packages/git-client/src/client.ts

import git from "isomorphic-git";
import type {
  GitClientOptions,
  GitAuthor,
  GitLogEntry,
  GitStatusRow,
  GitBranch,
  GitTag,
  GitRemote,
  GitStashEntry,
  FsAdapter,
  OnProgress,
  OnAuth,
  IGitHttpClient,
} from "./types.js";
import { GitMergeConflictError } from "./errors.js";
import { createHttpAdapter } from "./http.js";
import { saveStash, popStash, listStash } from "./stash.js";

export class GitClient {
  private readonly _fs: { promises: FsAdapter };
  private readonly _http: { request: (config: any) => Promise<any> };
  private readonly _dir: string;
  private readonly _onAuth?: OnAuth;
  private readonly _author?: GitAuthor;

  constructor(options: GitClientOptions) {
    this._fs = { promises: options.fs };
    this._http = createHttpAdapter(options.http);
    this._dir = options.dir;
    this._onAuth = options.onAuth;
    this._author = options.author;
  }

  private _getAuthor(override?: GitAuthor): { name: string; email: string } {
    const author = override ?? this._author;
    if (!author) {
      throw new Error("No author specified. Provide author in constructor options or per-method call.");
    }
    return author;
  }

  async init(): Promise<void> {
    await git.init({ fs: this._fs, dir: this._dir, defaultBranch: "main" });
  }

  async clone(url: string, opts?: { ref?: string; depth?: number; onProgress?: OnProgress }): Promise<void> {
    await git.clone({
      fs: this._fs,
      http: this._http,
      dir: this._dir,
      url,
      ref: opts?.ref,
      depth: opts?.depth,
      onProgress: opts?.onProgress,
      onAuth: this._onAuth ? () => this._onAuth!(url) : undefined,
    });
  }

  async add(filepath: string): Promise<void> {
    await git.add({ fs: this._fs, dir: this._dir, filepath });
  }

  async remove(filepath: string): Promise<void> {
    await git.remove({ fs: this._fs, dir: this._dir, filepath });
  }

  async commit(message: string, opts?: { author?: GitAuthor }): Promise<string> {
    const author = this._getAuthor(opts?.author);
    return git.commit({ fs: this._fs, dir: this._dir, message, author });
  }

  async log(opts?: { ref?: string; depth?: number }): Promise<GitLogEntry[]> {
    const commits = await git.log({
      fs: this._fs,
      dir: this._dir,
      ref: opts?.ref,
      depth: opts?.depth,
    });
    return commits.map((c) => ({
      oid: c.oid,
      commit: {
        oid: c.oid,
        message: c.commit.message,
        author: {
          name: c.commit.author.name,
          email: c.commit.author.email,
          timestamp: c.commit.author.timestamp,
        },
        parent: c.commit.parent,
      },
    }));
  }

  async status(filepath: string): Promise<GitStatusRow> {
    const matrix = await git.statusMatrix({ fs: this._fs, dir: this._dir, filepaths: [filepath] });
    if (matrix.length === 0) {
      return { filepath, head: 0, workdir: 0, stage: 0 } as GitStatusRow;
    }
    const [, head, workdir, stage] = matrix[0];
    return { filepath, head, workdir, stage } as GitStatusRow;
  }

  async statusAll(): Promise<GitStatusRow[]> {
    const matrix = await git.statusMatrix({ fs: this._fs, dir: this._dir });
    return matrix.map(([filepath, head, workdir, stage]) => ({
      filepath,
      head,
      workdir,
      stage,
    })) as GitStatusRow[];
  }

  async branch(name: string): Promise<void> {
    await git.branch({ fs: this._fs, dir: this._dir, ref: name });
  }

  async deleteBranch(name: string): Promise<void> {
    await git.deleteBranch({ fs: this._fs, dir: this._dir, ref: name });
  }

  async listBranches(): Promise<GitBranch[]> {
    const names = await git.listBranches({ fs: this._fs, dir: this._dir });
    const current = await this.currentBranch();
    const branches: GitBranch[] = [];
    for (const name of names) {
      const oid = await git.resolveRef({ fs: this._fs, dir: this._dir, ref: name });
      branches.push({ name, current: name === current, oid });
    }
    return branches;
  }

  async checkout(ref: string): Promise<void> {
    await git.checkout({ fs: this._fs, dir: this._dir, ref });
  }

  async currentBranch(): Promise<string | undefined> {
    const branch = await git.currentBranch({ fs: this._fs, dir: this._dir });
    return branch ?? undefined;
  }

  async merge(theirs: string, opts?: { author?: GitAuthor }): Promise<string> {
    const author = this._getAuthor(opts?.author);
    try {
      const result = await git.merge({
        fs: this._fs,
        dir: this._dir,
        theirs,
        author,
      });
      return result.oid ?? "";
    } catch (err: unknown) {
      if ((err as any).code === "MergeConflictError") {
        throw new GitMergeConflictError((err as any).data?.filepaths ?? [theirs]);
      }
      throw err;
    }
  }

  async tag(name: string, opts?: { ref?: string }): Promise<void> {
    await git.tag({
      fs: this._fs,
      dir: this._dir,
      ref: name,
      object: opts?.ref,
    });
  }

  async deleteTag(name: string): Promise<void> {
    await git.deleteTag({ fs: this._fs, dir: this._dir, ref: name });
  }

  async listTags(): Promise<GitTag[]> {
    const names = await git.listTags({ fs: this._fs, dir: this._dir });
    const tags: GitTag[] = [];
    for (const name of names) {
      const oid = await git.resolveRef({ fs: this._fs, dir: this._dir, ref: `refs/tags/${name}` });
      tags.push({ name, oid });
    }
    return tags;
  }

  async addRemote(name: string, url: string): Promise<void> {
    await git.addRemote({ fs: this._fs, dir: this._dir, remote: name, url });
  }

  async deleteRemote(name: string): Promise<void> {
    await git.deleteRemote({ fs: this._fs, dir: this._dir, remote: name });
  }

  async listRemotes(): Promise<GitRemote[]> {
    const remotes = await git.listRemotes({ fs: this._fs, dir: this._dir });
    return remotes.map((r) => ({ name: r.remote, url: r.url }));
  }

  async fetch(opts?: { remote?: string; ref?: string; onProgress?: OnProgress }): Promise<void> {
    await git.fetch({
      fs: this._fs,
      http: this._http,
      dir: this._dir,
      remote: opts?.remote,
      ref: opts?.ref,
      onProgress: opts?.onProgress,
      onAuth: this._onAuth ? (url: string) => this._onAuth!(url) : undefined,
    });
  }

  async pull(opts?: { remote?: string; ref?: string; author?: GitAuthor; onProgress?: OnProgress }): Promise<void> {
    const author = this._getAuthor(opts?.author);
    await git.pull({
      fs: this._fs,
      http: this._http,
      dir: this._dir,
      remote: opts?.remote,
      ref: opts?.ref,
      author,
      onProgress: opts?.onProgress,
      onAuth: this._onAuth ? (url: string) => this._onAuth!(url) : undefined,
    });
  }

  async push(opts?: { remote?: string; ref?: string; onProgress?: OnProgress }): Promise<void> {
    await git.push({
      fs: this._fs,
      http: this._http,
      dir: this._dir,
      remote: opts?.remote,
      ref: opts?.ref,
      onProgress: opts?.onProgress,
      onAuth: this._onAuth ? (url: string) => this._onAuth!(url) : undefined,
    });
  }

  async stash(opts?: { message?: string }): Promise<void> {
    const author = this._getAuthor();
    await saveStash(this._fs, this._dir, author, opts?.message);
  }

  async stashPop(): Promise<void> {
    await popStash(this._fs, this._dir);
  }

  async stashList(): Promise<GitStashEntry[]> {
    return listStash(this._fs, this._dir);
  }
}
