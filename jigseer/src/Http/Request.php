<?php

declare(strict_types=1);

namespace Jigseer\Http;

class Request
{
    public function __construct(
        private readonly string $method,
        private readonly string $path,
        private readonly array $queryParams,
        private readonly array $parsedBody,
        private readonly array $server,
    ) {
    }

    public static function fromGlobals(): self
    {
        $method = $_SERVER['REQUEST_METHOD'] ?? 'GET';
        $uri = $_SERVER['REQUEST_URI'] ?? '/';
        $parts = explode('?', $uri, 2);
        $path = $parts[0];
        $query = [];
        if (isset($parts[1])) {
            parse_str($parts[1], $query);
        }
        $body = $_POST;

        return new self($method, $path, $query, $body, $_SERVER);
    }

    public function method(): string
    {
        return strtoupper($this->method);
    }

    public function path(): string
    {
        return $this->path;
    }

    public function query(string $key, mixed $default = null): mixed
    {
        return $this->queryParams[$key] ?? $default;
    }

    public function body(string $key, mixed $default = null): mixed
    {
        return $this->parsedBody[$key] ?? $default;
    }

    public function ipAddress(): ?string
    {
        return $this->server['REMOTE_ADDR'] ?? null;
    }

    public function userAgent(): ?string
    {
        return $this->server['HTTP_USER_AGENT'] ?? null;
    }

    public function scheme(): string
    {
        $https = $this->server['HTTPS'] ?? null;
        $forwardedProto = $this->server['HTTP_X_FORWARDED_PROTO'] ?? null;

        $isHttps = false;
        if (is_string($https)) {
            $isHttps = $https !== '' && strtolower($https) !== 'off';
        }

        if (!$isHttps && is_string($forwardedProto)) {
            $isHttps = strtolower($forwardedProto) === 'https';
        }

        if (!$isHttps) {
            $isHttps = ($this->server['SERVER_PORT'] ?? null) === '443';
        }

        return $isHttps ? 'https' : 'http';
    }

    public function host(): string
    {
        $host = $this->server['HTTP_HOST'] ?? ($this->server['SERVER_NAME'] ?? 'localhost');

        if (str_contains($host, ':')) {
            return $host;
        }

        $port = $this->server['SERVER_PORT'] ?? '';
        $scheme = $this->scheme();
        $defaultPort = $scheme === 'https' ? '443' : '80';

        if ($port !== '' && $port !== $defaultPort) {
            $host .= ':' . $port;
        }

        return $host;
    }

    public function header(string $name): ?string
    {
        $normalized = 'HTTP_' . strtoupper(str_replace('-', '_', $name));

        if (isset($this->server[$normalized])) {
            return $this->server[$normalized];
        }

        if ($normalized === 'HTTP_CONTENT_TYPE') {
            return $this->server['CONTENT_TYPE'] ?? null;
        }

        if ($normalized === 'HTTP_CONTENT_LENGTH') {
            return $this->server['CONTENT_LENGTH'] ?? null;
        }

        return null;
    }

    public function absoluteUrl(string $path): string
    {
        if ($path === '' || $path[0] !== '/') {
            $path = '/' . ltrim($path, '/');
        }

        return $this->scheme() . '://' . $this->host() . $path;
    }
}
