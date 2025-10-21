<?php

declare(strict_types=1);

namespace Jigseer;

use RuntimeException;

class TemplateRenderer
{
    public function __construct(private readonly string $basePath)
    {
    }

    public function render(string $template, array $data = []): string
    {
        $path = rtrim($this->basePath, DIRECTORY_SEPARATOR) . DIRECTORY_SEPARATOR . $template;
        if (!is_file($path)) {
            throw new RuntimeException(sprintf('Template not found: %s', $template));
        }

        extract($data, EXTR_SKIP);
        ob_start();
        require $path;

        return (string) ob_get_clean();
    }
}
