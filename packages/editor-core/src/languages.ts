import type { Extension } from "@codemirror/state";
import type { LanguageId } from "./types.js";

const extensionMap: Record<string, LanguageId> = {
  ".js": "javascript",
  ".mjs": "javascript",
  ".cjs": "javascript",
  ".ts": "typescript",
  ".mts": "typescript",
  ".cts": "typescript",
  ".jsx": "jsx",
  ".tsx": "tsx",
  ".html": "html",
  ".htm": "html",
  ".css": "css",
  ".json": "json",
  ".md": "markdown",
  ".markdown": "markdown",
};

export function detectLanguage(path: string): LanguageId {
  const dotIndex = path.lastIndexOf(".");
  if (dotIndex === -1 || dotIndex === path.length - 1) return "plaintext";
  const ext = path.slice(dotIndex).toLowerCase();
  return extensionMap[ext] ?? "plaintext";
}

export async function getLanguageExtension(lang: LanguageId): Promise<Extension[]> {
  switch (lang) {
    case "javascript": {
      const { javascript } = await import("@codemirror/lang-javascript");
      return [javascript()];
    }
    case "typescript": {
      const { javascript } = await import("@codemirror/lang-javascript");
      return [javascript({ typescript: true })];
    }
    case "jsx": {
      const { javascript } = await import("@codemirror/lang-javascript");
      return [javascript({ jsx: true })];
    }
    case "tsx": {
      const { javascript } = await import("@codemirror/lang-javascript");
      return [javascript({ typescript: true, jsx: true })];
    }
    case "html": {
      const { html } = await import("@codemirror/lang-html");
      return [html()];
    }
    case "css": {
      const { css } = await import("@codemirror/lang-css");
      return [css()];
    }
    case "json": {
      const { json } = await import("@codemirror/lang-json");
      return [json()];
    }
    case "markdown": {
      const { markdown } = await import("@codemirror/lang-markdown");
      return [markdown()];
    }
    case "plaintext":
      return [];
  }
}
