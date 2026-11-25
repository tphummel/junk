# 0010: A version string in each webpage's footer

- Status: Accepted
- Date: 2026-11-25

## Context

`web/` has no build step ([ADR 0002](0002-no-web-build-step.md)), so nothing can stamp a commit hash or build number into a page. Pages are installed to home screens and cached by service workers ([ADR 0008](0008-pwa-for-all-offline-for-self-contained.md)), which makes "am I running the latest deploy?" a real question on a phone. A git hook would answer it, but hooks are local, are skipped by cloud sessions and edits on github.com, and need per-clone setup. The version should travel with the work itself.

## Decision

1. **Every page shows a version string** in an element with `id="version"`, as the last thing on the page (the footer, or the end of the settings screen for a tabbed app). It holds only the string, styled quietly (small, muted).
2. **Format: `YYYY-MM-DDTHH:MM-xxx`**, for example `2026-11-22T14:37-frp`. The date and time are UTC, to the minute, when the change was made. `xxx` is three random lowercase letters, so two changes in the same minute, or on parallel branches, still differ.
3. **Whoever changes a page rewrites its string in the same commit.** Any change to files under `web/<name>/` that a visitor could notice (code, markup, styles, data, icons) replaces the string with a fresh one: current UTC time and new random letters. Edit the element in `web/<name>/index.html` by hand; there is no tool, hook or CI step.
4. **Pages without one get it the next time they are changed**, the same way migrated pages are brought up to date in ADR 0003. New pages start with one.
5. The `new-webpage` skill's template includes the element, and its procedure says to refresh it.

Make a string with:

```sh
echo "$(date -u +%Y-%m-%dT%H:%M)-$(LC_ALL=C tr -dc a-z </dev/urandom | head -c3)"
```

## Consequences

- No tooling: the version is plain text in a file, so it works in cloud sessions, the GitHub web editor and any clone.
- Nothing enforces it. A change that forgets to refresh the string looks identical to the one before; CI does not check.
- Two branches that both touch a page conflict on the version line. The fix is to take either side and write a fresh string.
- With a squash merge the string is whatever the branch last wrote, which can be earlier than the merge itself. It identifies the work, not the deploy.
- The string is not a commit hash, so it cannot be looked up in git directly; match it by date and the page's history.
- The letters carry no meaning and the string is not meant to be sorted beyond its date and time.

## Alternatives considered

- **Pre-commit or post-commit hook.** Automatic, but local-only, skipped by cloud sessions and the GitHub UI, and a post-commit hook cannot put the change in the commit it follows.
- **Git commit hash.** Exact, but needs a build step to inject it (ADR 0002) and a commit cannot contain its own hash.
- **CI check that fails when a page changes without a bump.** Would enforce the rule, but adds a workflow to maintain and blocks trivial edits; can be added later if the rule is forgotten often.
- **A hand-counted number (`v12`).** Simple, but parallel branches pick the same number and it carries no date.
- **Fetching the latest commit from GitHub at runtime.** Breaks offline use and the "stays on this device" promise of self-contained pages.
