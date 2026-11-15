---
name: misc-project
description: Work in or start a project in the junk repo that is not a webpage (web/), an API (api/), or a Docker image app. Use when changing an older top-level project folder, or when starting a one-off experiment, investigation, or tool that fits none of those.
metadata:
  version: "1.0.0"
---

# Miscellaneous projects

Most top-level folders are older, unrelated projects (other than `web/`, `api/`, `adr/`, `skill/` and the Docker apps). They share no structure, language or tooling, and the rules for webpages, APIs and Docker apps do not apply to them.

## Changing an existing project

- Read the folder's `README.md` (and `notes.md` if present) and follow its conventions.
- Change only that folder, and its workflow in `.github/workflows/` if it has one.
- Don't restructure, migrate or add tooling (npm, ADR conventions, skills) unless asked.

## Starting something new

For new work that fits no other kind, create a top-level folder with an appropriate name and work only in it.

1. Create `notes.md` and append to it as you work: what you tried and what you learned.
2. Write a `README.md` report at the end.
3. The final commit contains just that folder, and in it only:
   - `notes.md` and `README.md`.
   - Any code you wrote.
   - If you modified an existing repo you checked out, the `git diff` against it saved as a file (not a copy of the repo).
   - Binary files you created, if useful and under 2 MB.
4. Don't include full copies of code you fetched. Include only new files, or diffs showing your changes to existing code.
