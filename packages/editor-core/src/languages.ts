import type { Extension } from "@codemirror/state";
import { javascript } from "@codemirror/lang-javascript";
import { html } from "@codemirror/lang-html";
import { css } from "@codemirror/lang-css";
import { json } from "@codemirror/lang-json";
import { markdown } from "@codemirror/lang-markdown";
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

export function getLanguageExtension(lang: LanguageId): Extension[] {
  switch (lang) {
    case "javascript":
      return [javascript()];
    case "typescript":
      return [javascript({ typescript: true })];
    case "jsx":
      return [javascript({ jsx: true })];
    case "tsx":
      return [javascript({ typescript: true, jsx: true })];
    case "html":
      return [html()];
    case "css":
      return [css()];
    case "json":
      return [json()];
    case "markdown":
      return [markdown()];
    case "plaintext":
      return [];
  }
}
