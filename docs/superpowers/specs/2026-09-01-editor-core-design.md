# editor-core Design Spec

## Decision: CodeMirror 6

Monaco is explicitly unsupported on mobile browsers. CodeMirror 6 is ~200KB, designed for mobile/touch, modular. TS Language Server integration deferred to a later phase.

## Purpose

Thin adapter over CodeMirror 6 exposing `IEditor` — a framework-agnostic editor interface. The package owns the editor lifecycle, receives content as strings, emits changes via callbacks. No knowledge of VFS, file trees, or project structure.

## Interface

```ts
type LanguageId = "javascript" | "typescript" | "jsx" | "tsx" | "html" | "css" | "json" | "markdown" | "plaintext";

interface EditorOptions {
  parent: HTMLElement;
  readOnly?: boolean;
  theme?: "light" | "dark";
  tabSize?: number;
  lineNumbers?: boolean;
}

interface IEditor {
  open(path: string, content: string, language?: LanguageId): void;
  getContent(): string;
  onChange(callback: (content: string) => void): () => void;
  setLanguage(language: LanguageId): void;
  getSelection(): { from: number; to: number; text: string };
  setSelection(from: number, to: number): void;
  focus(): void;
  destroy(): void;
}

function createEditor(options: EditorOptions): IEditor;
```

## Files

- `types.ts` — `IEditor`, `EditorOptions`, `LanguageId`
- `languages.ts` — maps `LanguageId` to CodeMirror language extensions (lazy dynamic import)
- `theme.ts` — light/dark theme using `@codemirror/theme-one-dark` + custom light theme
- `editor.ts` — `createEditor()` wrapping `EditorView`, manages state/extensions
- `index.ts` — public re-exports

## Dependencies

- `@codemirror/state` — editor state model
- `@codemirror/view` — editor DOM view
- `@codemirror/language` — language infrastructure
- `@codemirror/commands` — keybindings
- `@codemirror/autocomplete` — basic completion infrastructure
- `@codemirror/search` — search/replace
- `@codemirror/lint` — linting infrastructure (for future phases)
- `@codemirror/lang-javascript` — JS/TS/JSX/TSX
- `@codemirror/lang-html` — HTML
- `@codemirror/lang-css` — CSS
- `@codemirror/lang-json` — JSON
- `@codemirror/lang-markdown` — Markdown
- `@codemirror/theme-one-dark` — dark theme base

## TypeScript Config

editor-core's `tsconfig.json` must add `"DOM"` and `"DOM.Iterable"` to lib since CodeMirror uses DOM APIs. This is package-scoped — other packages remain DOM-free.

## Testing

CodeMirror requires a real DOM. Tests use Vitest with `jsdom` environment (`// @vitest-environment jsdom` per-file pragma). Tests cover adapter logic: open/getContent round-trip, onChange firing, language switching, selection get/set, destroy cleanup.

## Acceptance Criteria

- `createEditor({ parent })` renders a working CodeMirror instance
- `open(path, content, lang)` loads content with syntax highlighting
- `onChange` fires on edits with updated content
- `setLanguage` swaps syntax highlighting
- `getSelection`/`setSelection` work
- `destroy()` cleans up the DOM
- No `node:*` imports in source
- HTML demo page that opens/edits a file through `IEditor`
