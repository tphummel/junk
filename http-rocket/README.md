# HTTP Rocket

`HTTP Rocket` is a client-only web HTTP client (Svelte + TypeScript).

## Selected Name
- Project directory: `http-rocket`
- Planned image name: `ghcr.io/tphummel/http-rocket`

## Current Status
Initial scaffold is now in place:
- Svelte + TypeScript + Vite app skeleton
- Apache httpd production image via multi-stage Dockerfile

## Planned Features
- Request builder (URL, verb, headers)
- Save/send behavior with browser persistence
- Multiple named request configurations in local storage
- Import/export JSON configuration
- Audit tab with last 1000 request/response records

## Local Development
```bash
npm install
npm run dev
```

## Build
```bash
npm run build
```

## Container
```bash
docker build -t http-rocket .
docker run --rm -p 8080:80 http-rocket
```
