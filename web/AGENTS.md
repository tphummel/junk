# web/

Static webpages, one directory each ([ADR 0003](../adr/0003-webpages.md)). Before changing one, check the [`skill/`](../skill/) that matches the task.

**Refresh the page's version when you change it.** Any change under `web/<name>/` that a visitor could notice (code, markup, styles, data, icons) means rewriting the `#version` string in that page's `index.html` in the same commit, with the current UTC time:

```sh
date -u +%Y-%m-%dT%H:%M:%SZ
```

A page without a `#version` element gets one the next time you change it. Reasoning and format are in [ADR 0010](../adr/0010-page-version-string.md).
