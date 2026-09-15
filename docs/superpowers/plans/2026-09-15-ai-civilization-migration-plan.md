# AI Civilization Sandbox Migration Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Migrate all useful files from `AI-Civilization-Sandbox` to `AiA-Fantasy-Civilization` without old git history, leaving the project ready in its existing git repository.

**Architecture:** Use rsync/cp to transfer all project files, ignoring build artifacts, caches, and `.git`, into `AiA-Fantasy-Civilization`, followed by git staging and initial commit.

**Tech Stack:** Node.js / TypeScript / React 19 / Vite / Git

**Spec:** `docs/superpowers/specs/2026-09-15-ai-civilization-migration-design.md`

## Global Constraints
- Exclude `.git`, `.codegraph`, `node_modules`, `dist`, `target`, `.idea`, and external symlinks.
- Preserve all source code, configurations, scripts, and docs.
- Maintain existing Git repository initialization in `AiA-Fantasy-Civilization`.

---

### Task 1: Copy Codebase and Configuration Files

**Files:**
- Copy all files from `/home/ranmadxs/models/AI-Civilization-Sandbox/` to `/home/ranmadxs/models/AiA-Fantasy-Civilization/` with exclusions.

**Interfaces:**
- Consumes: `AI-Civilization-Sandbox` root files and directories.
- Produces: Populated `AiA-Fantasy-Civilization` directory structure.

- [ ] **Step 1: Execute file transfer with exclusions**

Run:
```bash
rsync -av --exclude='.git' --exclude='.codegraph' --exclude='node_modules' --exclude='dist' --exclude='target' --exclude='.idea' --exclude='Fantasy-Map-Generator' /home/ranmadxs/models/AI-Civilization-Sandbox/ /home/ranmadxs/models/AiA-Fantasy-Civilization/
```
Expected: Files successfully synchronized to `AiA-Fantasy-Civilization`.

- [ ] **Step 2: Verify git status and untracked files**

Run:
```bash
git -C /home/ranmadxs/models/AiA-Fantasy-Civilization status
```
Expected: List of untracked files representing the migrated codebase.

- [ ] **Step 3: Stage all migrated files**

Run:
```bash
git -C /home/ranmadxs/models/AiA-Fantasy-Civilization add .
```
Expected: All files staged successfully.

- [ ] **Step 4: Create initial commit**

Run:
```bash
git -C /home/ranmadxs/models/AiA-Fantasy-Civilization commit -m "feat: migrate AI-Civilization-Sandbox codebase without history"
```
Expected: Clean initial commit created successfully on branch `main`.

- [ ] **Step 5: Verify final git log**

Run:
```bash
git -C /home/ranmadxs/models/AiA-Fantasy-Civilization log --oneline
```
Expected: Exactly 1 commit showing the initial migration.
