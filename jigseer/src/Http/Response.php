<?php

declare(strict_types=1);

namespace Jigseer\Http;

class Response
{
    public function __construct(
        private readonly int $status,
        private readonly array $headers,
        private readonly string $body
    ) {
    }

    public function status(): int
    {
        return $this->status;
    }

    public function headers(): array
    {
        return $this->headers;
    }

    public function body(): string
    {
        return $this->body;
    }

    public static function html(string $body, int $status = 200, array $headers = []): self
    {
        $headers = array_merge(['Content-Type' => 'text/html; charset=utf-8'], $headers);

        return new self($status, $headers, $body);
    }

    public static function redirect(string $location): self
    {
        return new self(302, ['Location' => $location], '');
    }

    public static function json(array $payload, int $status = 200): self
    {
        return new self($status, ['Content-Type' => 'application/json'], json_encode($payload, JSON_PRETTY_PRINT));
    }
}
