# Docker Image Build and Deployment Context

This document provides context for AI agents working on the fast-note project's Docker containerization.

## Repository Structure
- This is the `fast-note` subdirectory within the larger `junk` repository
- The project has its own Dockerfile, README, and application files in this subdirectory
- CI/CD builds Docker images from this subdirectory context

## Docker Image Registry
- Images are published to GitHub Container Registry (GHCR): `ghcr.io/tphummel/fast-note`
- Images are tagged with build date and git hash (e.g., `20250906-7e5958f`)
- CI automatically builds and pushes images on branch pushes

## Production Deployment Context
The application runs on a server with:
- Systemd service named `fast-note.service`
- Service runs Docker container with volume mounts
- Data persistence via host directory mount: `/opt/fast-note/data`
- Container exposes port 8080 for HTTP traffic

## Common Issues and Solutions

### SQLite Permission Problems
**Problem**: "attempt to write a readonly database" errors
**Root Cause**: Volume-mounted files inherit host ownership, not container ownership
**Solution**: Mount the data directory, not the SQLite file directly
- Host: `-v /opt/fast-note/data:/var/www/html/data` 
- Container: Uses `FASTNOTE_DB=/var/www/html/data/notes.sqlite`
- Host directory needs proper ownership: `chown -R 33:33 /opt/fast-note/data`

### Image Architecture
- Uses `php:8.3-apache` for simplicity (single container vs PHP-FPM + web server)
- Apache configured to listen on port 8080 instead of default 80
- Application files copied to `/var/www/html`
- Data directory created at `/var/www/html/data` with www-data ownership

## Workflow for Container Changes
1. Make changes to Dockerfile and/or README
2. Create feature branch (e.g., `fix-sqlite-permissions`)
3. Commit and push to trigger CI build
4. Test with new image tag in production
5. Create PR for review and merge

## Testing Commands
```bash
# Build locally
docker build -t fast-note .

# Test locally with proper volume mount
mkdir -p data
docker run -p 8080:8080 -v $(pwd)/data:/var/www/html/data --name fast-note fast-note

# Check container internals
docker exec fast-note ls -la /var/www/html/data/
docker exec fast-note curl localhost:8080
```

## Production Service Commands
```bash
# Check service status
systemctl status fast-note --no-pager

# View logs
journalctl -f -u fast-note

# Update to new image (requires service file edit)
systemctl restart fast-note
```