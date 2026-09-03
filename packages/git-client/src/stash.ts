// packages/git-client/src/stash.ts

import git from "isomorphic-git";
import type { FsAdapter, GitStashEntry } from "./types.js";

const STASH_LIST_PATH = ".git/stash-list.json";

interface StashRecord {
  oid: string;
  message: string;
}

async function readStashList(fs: { promises: FsAdapter }, dir: string): Promise<StashRecord[]> {
  try {
    const data = await fs.promises.readFile(`${dir}/${STASH_LIST_PATH}`, { encoding: "utf8" });
    return JSON.parse(data as string) as StashRecord[];
  } catch {
    return [];
  }
}

async function writeStashList(fs: { promises: FsAdapter }, dir: string, list: StashRecord[]): Promise<void> {
  await fs.promises.writeFile(`${dir}/${STASH_LIST_PATH}`, JSON.stringify(list));
}

/**
 * Save the current working-directory + staged changes as a stash entry.
 *
 * Implementation note: this stages every pending change, commits it on top of
 * HEAD (capturing the full working tree in a normal commit object), then
 * rewinds the current branch back to its original position and restores the
 * working directory to match. The stash commit itself is left dangling
 * (unreferenced by any branch) but stays reachable via its oid, which is
 * recorded in `.git/stash-list.json`.
 */
export async function saveStash(
  fs: { promises: FsAdapter },
  dir: string,
  author: { name: string; email: string },
  message?: string,
): Promise<void> {
  const msg = message ?? "WIP";

  const statusMatrix = await git.statusMatrix({ fs, dir });
  const changedFiles = statusMatrix.filter(
    ([, head, workdir, stage]) => head !== workdir || workdir !== stage,
  );

  if (changedFiles.length === 0) {
    throw new Error("No changes to stash");
  }

  const branch = await git.currentBranch({ fs, dir });
  if (!branch) {
    throw new Error("Cannot stash: HEAD is not on a branch");
  }
  const originalOid = await git.resolveRef({ fs, dir, ref: branch });

  for (const [filepath, , workdir] of changedFiles) {
    if (workdir === 0) {
      await git.remove({ fs, dir, filepath });
    } else {
      await git.add({ fs, dir, filepath });
    }
  }

  const stashOid = await git.commit({
    fs,
    dir,
    message: `stash: ${msg}`,
    author,
  });

  // Rewind the branch to where it was before the stash commit, then restore
  // the working directory + index to match that original state.
  await git.writeRef({ fs, dir, ref: `refs/heads/${branch}`, value: originalOid, force: true });
  await git.checkout({ fs, dir, ref: branch, force: true });

  const list = await readStashList(fs, dir);
  list.unshift({ oid: stashOid, message: msg });
  await writeStashList(fs, dir, list);
}

/**
 * Pop (apply + drop) the most recent stash entry, restoring its changes into
 * the working directory and index.
 */
export async function popStash(
  fs: { promises: FsAdapter },
  dir: string,
): Promise<void> {
  const list = await readStashList(fs, dir);
  if (list.length === 0) {
    throw new Error("No stash entries to pop");
  }

  const entry = list[0];
  const stashCommit = await git.readCommit({ fs, dir, oid: entry.oid });
  const parentOid = stashCommit.commit.parent[0];

  const stashFiles = await git.listFiles({ fs, dir, ref: entry.oid });
  for (const filepath of stashFiles) {
    const { blob } = await git.readBlob({ fs, dir, oid: entry.oid, filepath });
    await fs.promises.writeFile(`${dir}/${filepath}`, blob);
    await git.add({ fs, dir, filepath });
  }

  // Anything present before the stash but absent from the stashed tree was
  // deleted as part of the stash — remove it again on pop.
  if (parentOid) {
    const parentFiles = await git.listFiles({ fs, dir, ref: parentOid });
    const stashFileSet = new Set(stashFiles);
    for (const filepath of parentFiles) {
      if (!stashFileSet.has(filepath)) {
        await git.remove({ fs, dir, filepath });
        try {
          await fs.promises.unlink(`${dir}/${filepath}`);
        } catch {
          // already absent from the working directory
        }
      }
    }
  }

  list.shift();
  await writeStashList(fs, dir, list);
}

export async function listStash(
  fs: { promises: FsAdapter },
  dir: string,
): Promise<GitStashEntry[]> {
  const list = await readStashList(fs, dir);
  return list.map((entry, index) => ({
    index,
    message: entry.message,
    oid: entry.oid,
  }));
}
