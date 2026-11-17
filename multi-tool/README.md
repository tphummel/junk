# multi-tool

A Debian (arm64) toolbox image with the CLIs I reach for when poking at infrastructure: `kubectl`, `aws` (v2), `eksctl`, `mongosh`, `psql`, `redis-cli`, `lynis`, `bats`, `grpcurl`, `jq`, and friends. Scripts in [`kits/`](kits/) are copied into the image at `/kits/`.

Moved here from the `tphummel/multi-tool` repo (history stays there).

## Image

Published to `ghcr.io/tphummel/multi-tool` by [`.github/workflows/multi-tool.yml`](../.github/workflows/multi-tool.yml), per [ADR 0006](../adr/0006-docker-image-projects.md). Platform is `linux/arm64` only.

Tags: `main`, `pr-<n>`, semver for `v*` tags, and the commit SHA. There is no `latest` or date tag any more; pin `main`, a version or a SHA.

## Build and run

```sh
docker build --platform linux/arm64 -t multi-tool multi-tool/
docker run --rm -it multi-tool
```

## Local helpers

`just k8s-snap` (alias `ks`) dumps every resource in every visible namespace to `outs/`. Expects `KUBECONFIG` to be set.

## Tests

```sh
for f in multi-tool/kits/*.sh; do bash -n "$f"; done
```
