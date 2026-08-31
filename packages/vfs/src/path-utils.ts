export function normalize(path: string): string {
  if (path === "" || path === "/") return "/";

  const parts = path.split("/");
  const resolved: string[] = [];

  for (const part of parts) {
    if (part === "" || part === ".") continue;
    if (part === "..") {
      resolved.pop();
    } else {
      resolved.push(part);
    }
  }

  return "/" + resolved.join("/");
}

export function join(...parts: string[]): string {
  return normalize(parts.join("/"));
}

export function dirname(path: string): string {
  const norm = normalize(path);
  const idx = norm.lastIndexOf("/");
  if (idx <= 0) return "/";
  return norm.slice(0, idx);
}

export function basename(path: string): string {
  const norm = normalize(path);
  if (norm === "/") return "";
  const idx = norm.lastIndexOf("/");
  return norm.slice(idx + 1);
}

export function isAbsolute(path: string): boolean {
  return path.startsWith("/");
}

export function resolve(base: string, target: string): string {
  if (isAbsolute(target)) return normalize(target);
  return normalize(base + "/" + target);
}

export function segments(path: string): string[] {
  const norm = normalize(path);
  if (norm === "/") return [];
  return norm.slice(1).split("/");
}
