# Design Spec: AI Civilization Sandbox Migration to AiA-Fantasy-Civilization

## Overview
Migrate the entire codebase, configuration files, scripts, and assets from `AI-Civilization-Sandbox` to `AiA-Fantasy-Civilization` as a fresh start, discarding the old Git commit history while leveraging the existing Git repository initialized in `AiA-Fantasy-Civilization`.

## Scope & Exclusions
- **Included**: All source code (`src/`), configuration files (`package.json`, `tsconfig.json`, `vite.config.ts`, etc.), scripts (`scripts/`), documentation (`docs/`), and public assets.
- **Excluded**:
  - `.git` (old git history)
  - `.codegraph` (local index cache)
  - `node_modules` (dependency cache)
  - `dist` / `target` (build outputs)
  - `.idea` (IDE settings)
  - Symlinks pointing outside the repository (`Fantasy-Map-Generator`)

## Implementation Steps
1. Copy all project files from `AI-Civilization-Sandbox` to `AiA-Fantasy-Civilization` applying the exclusion filters.
2. Verify file presence and integrity in `AiA-Fantasy-Civilization`.
3. Check `git status` inside `AiA-Fantasy-Civilization` to confirm untracked files are correctly recognized.
4. Stage all files (`git add .`) and make the initial commit (`git commit -m "Initial commit: migrate AI-Civilization-Sandbox codebase without history"`).
