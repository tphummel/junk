<?php

declare(strict_types=1);

namespace Jigseer;

function ensure_directory(string $path): void
{
    if (!is_dir($path)) {
        if (!mkdir($path, 0775, true) && !is_dir($path)) {
            throw new \RuntimeException(sprintf('Unable to create directory: %s', $path));
        }
    }
}

function generate_code(int $length = 6): string
{
    $alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
    $bytes = random_bytes($length);
    $result = '';

    for ($i = 0; $i < $length; $i++) {
        $index = ord($bytes[$i]) % strlen($alphabet);
        $result .= $alphabet[$index];
    }

    return $result;
}

function format_duration(int $seconds): string
{
    $seconds = max(0, $seconds);

    $units = [
        'd' => 86_400,
        'h' => 3_600,
        'm' => 60,
        's' => 1,
    ];

    $parts = [];
    foreach ($units as $suffix => $unitSeconds) {
        if ($seconds < $unitSeconds) {
            continue;
        }

        $value = intdiv($seconds, $unitSeconds);
        $seconds -= $value * $unitSeconds;
        $parts[] = $value . $suffix;

        if (count($parts) === 2) {
            break;
        }
    }

    if ($parts === []) {
        return '0s';
    }

    return implode(' ', $parts);
}
