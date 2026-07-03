# Axon IDE Release Notes

## Version 1.106

### What's New

- **Axon Agent**: AI-powered coding assistant with multi-model support (OpenAI, Claude, etc.)
- **Lightning Rollback**: Snapshot-based rollback for every turn, with session isolation
- **Smart Terminal**: Terminal reuse across sessions within the same workspace
- **Markdown Rendering**: Improved rendering for SVG, Mermaid diagrams, and HTML previews

### Improvements

- Session-isolated snapshots: each conversation only sees its own rollback history
- Terminal key based on workspace directory, preventing cross-workspace interference
- Fixed markdown rendering flicker during streaming output
- Fixed IDE outer scrollbar caused by offscreen measurement containers
- Release Notes now opens in-editor instead of external browser

### Bug Fixes

- Fixed leaked disposable in terminal decoration addon
- Fixed xterm addon-ligatures missing UMD bundle
- Fixed tool result loss causing infinite retry loop
