# Rules for Claude Code in this repository

- Monorepo on pnpm workspaces. Each package in /packages must build and test independently.
- No Node-specific APIs (fs, net, child_process from 'node:...') inside /packages source code, except test files (*.test.ts). The runtime target is JavaScriptCore/WKWebView, not Node.
- Cross-package communication only through exported interfaces from index.ts — no direct imports of another package's internal files.
- Every new feature: test first, then implementation (TDD where applicable to pure logic: vfs, resolver, node-shims).
- Before adding an npm dependency to the project itself — verify it doesn't pull native bindings (node-gyp).
- Commit convention: Conventional Commits (feat/fix/chore/docs).
- Target: ES2020 for JavaScriptCore compatibility.
- Package scope: @anthropic-ide/*
