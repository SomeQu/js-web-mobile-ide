import * as pako from "pako";
import type { IVirtualFileSystem } from "@anthropic-ide/vfs";

export interface TarEntry {
  name: string;
  data: Uint8Array;
}

export function parseTar(buffer: Uint8Array): TarEntry[] {
  const entries: TarEntry[] = [];
  let offset = 0;

  while (offset + 512 <= buffer.length) {
    const header = buffer.subarray(offset, offset + 512);

    let allZero = true;
    for (let i = 0; i < 512; i++) {
      if (header[i] !== 0) { allZero = false; break; }
    }
    if (allZero) break;

    let name = readString(header, 0, 100);
    const prefix = readString(header, 345, 155);
    if (prefix) name = prefix + "/" + name;

    const sizeStr = readString(header, 124, 12);
    const size = parseInt(sizeStr, 8) || 0;

    const typeFlag = header[156];
    // '0' or '\0' = regular file, '5' = directory
    const isFile = typeFlag === 0 || typeFlag === 48; // 48 = ASCII '0'

    offset += 512;

    if (isFile && size > 0) {
      const data = buffer.slice(offset, offset + size);
      entries.push({ name, data: new Uint8Array(data) });
    } else if (isFile && size === 0) {
      entries.push({ name, data: new Uint8Array(0) });
    }

    offset += Math.ceil(size / 512) * 512;
  }

  return entries;
}

function readString(buf: Uint8Array, offset: number, length: number): string {
  let end = offset;
  const max = offset + length;
  while (end < max && buf[end] !== 0) end++;
  const decoder = new TextDecoder();
  return decoder.decode(buf.subarray(offset, end));
}

export async function extractTarGzip(
  data: Uint8Array,
  vfs: IVirtualFileSystem,
  destPath: string,
): Promise<void> {
  const tarData = pako.ungzip(data);
  const entries = parseTar(tarData);

  for (const entry of entries) {
    let name = entry.name;

    // Strip "package/" prefix (npm tarball convention)
    const slashIdx = name.indexOf("/");
    if (slashIdx !== -1) {
      name = name.substring(slashIdx + 1);
    }

    if (!name) continue;

    const fullPath = destPath + "/" + name;

    // Ensure parent directory exists
    const lastSlash = fullPath.lastIndexOf("/");
    if (lastSlash > 0) {
      const parentDir = fullPath.substring(0, lastSlash);
      if (!(await vfs.exists(parentDir))) {
        await vfs.mkdir(parentDir, { recursive: true });
      }
    }

    await vfs.writeFile(fullPath, entry.data);
  }
}
