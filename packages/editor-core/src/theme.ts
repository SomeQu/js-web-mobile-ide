import type { Extension } from "@codemirror/state";
import { EditorView } from "@codemirror/view";
import { oneDark } from "@codemirror/theme-one-dark";

const lightTheme = EditorView.theme({
  "&": {
    backgroundColor: "#ffffff",
    color: "#24292e",
  },
  ".cm-content": {
    caretColor: "#24292e",
  },
  ".cm-cursor": {
    borderLeftColor: "#24292e",
  },
  ".cm-activeLine": {
    backgroundColor: "#f6f8fa",
  },
  ".cm-gutters": {
    backgroundColor: "#ffffff",
    color: "#959da5",
    border: "none",
  },
  ".cm-activeLineGutter": {
    backgroundColor: "#f6f8fa",
  },
  ".cm-selectionBackground": {
    backgroundColor: "#0366d625",
  },
  "&.cm-focused .cm-selectionBackground": {
    backgroundColor: "#0366d640",
  },
});

export function getThemeExtension(theme: "light" | "dark"): Extension[] {
  if (theme === "dark") {
    return [oneDark];
  }
  return [lightTheme];
}
