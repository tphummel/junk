<?php

declare(strict_types=1);

require_once __DIR__ . '/support.php';
require_once __DIR__ . '/Database.php';
require_once __DIR__ . '/Http/Request.php';
require_once __DIR__ . '/Http/Response.php';
require_once __DIR__ . '/TemplateRenderer.php';
require_once __DIR__ . '/Application.php';

use Jigseer\Application;
use Jigseer\Database;
use Jigseer\TemplateRenderer;

function jigseer_bootstrap(): Application
{
    $databasePath = getenv('JIGSEER_DB_PATH') ?: dirname(__DIR__) . '/var/database.sqlite';
    $renderer = new TemplateRenderer(dirname(__DIR__) . '/templates');
    $database = new Database($databasePath);
    $version = getenv('JIGSEER_VERSION');
    if (is_string($version)) {
        $version = trim($version);
    }

    if (!is_string($version) || $version === '') {
        $versionFile = dirname(__DIR__) . '/VERSION';
        if (is_file($versionFile)) {
            $version = trim((string) file_get_contents($versionFile));
        }
    }

    if (!is_string($version) || $version === '') {
        $version = 'dev';
    }

    return new Application($database, $renderer, $version);
}
