<?php

declare(strict_types=1);

require __DIR__ . '/../src/bootstrap.php';
require_once __DIR__ . '/../src/support.php';
require_once __DIR__ . '/../src/Database.php';
require_once __DIR__ . '/../src/TemplateRenderer.php';
require_once __DIR__ . '/../src/Application.php';
require_once __DIR__ . '/../src/Http/Request.php';
require_once __DIR__ . '/../src/Http/Response.php';

use Jigseer\Application;
use Jigseer\Database;
use Jigseer\TemplateRenderer;
use Jigseer\Http\Request;

$tests = [];

function test(string $description, callable $callback): void
{
    global $tests;
    $tests[] = [$description, $callback];
}

function assertTrue(bool $condition, string $message = 'Failed asserting that condition is true'): void
{
    if (!$condition) {
        throw new RuntimeException($message);
    }
}

function assertSame(mixed $expected, mixed $actual, string $message = ''): void
{
    if ($expected !== $actual) {
        $text = $message ?: sprintf('Expected %s, got %s', var_export($expected, true), var_export($actual, true));
        throw new RuntimeException($text);
    }
}

function makeApp(string $dbPath): Application
{
    $renderer = new TemplateRenderer(__DIR__ . '/../templates');
    $database = new Database($dbPath);

    return new Application($database, $renderer);
}

test('creating a puzzle persists a record and redirects to the puzzle page', function (): void {
    $dbPath = sys_get_temp_dir() . '/jigseer-tests-' . bin2hex(random_bytes(3)) . '.sqlite';
    $app = makeApp($dbPath);

    $request = new Request('POST', '/puzzles', [], [
        'name' => 'Test Puzzle',
        'total_pieces' => '1000',
    ], []);

    $response = $app->handle($request);
    assertSame(302, $response->status(), 'Expected a redirect after creating a puzzle');
    $location = $response->headers()['Location'] ?? '';
    assertTrue(str_starts_with($location, '/p/'), 'Redirect must point to the puzzle route');

    $database = new Database($dbPath);
    $count = (int) $database->connection()->query('SELECT COUNT(*) FROM puzzles')->fetchColumn();
    assertSame(1, $count, 'Puzzle was not persisted');
});

test('recording a hit stores the entry and redirects back to play tab', function (): void {
    $dbPath = sys_get_temp_dir() . '/jigseer-tests-' . bin2hex(random_bytes(3)) . '.sqlite';
    $database = new Database($dbPath);
    $puzzleId = $database->createPuzzle('Hit Test');
    $app = new Application($database, new TemplateRenderer(__DIR__ . '/../templates'));

    $request = new Request('POST', '/p/' . $puzzleId . '/hits', [], [
        'player_name' => 'Jamie',
        'connection_count' => '3',
    ], ['REMOTE_ADDR' => '127.0.0.1']);

    $response = $app->handle($request);
    assertSame(302, $response->status());
    assertSame('/p/' . $puzzleId . '/play', $response->headers()['Location'] ?? '');

    $count = (int) $database->connection()->query('SELECT COUNT(*) FROM hits WHERE puzzle_id = ' . $database->connection()->quote($puzzleId))->fetchColumn();
    assertSame(1, $count, 'Hit was not persisted');
});

test('request ipAddress prefers forwarded headers when present', function (): void {
    $request = new Request('POST', '/example', [], [], [
        'HTTP_X_FORWARDED_FOR' => '203.0.113.4, 198.51.100.7',
        'REMOTE_ADDR' => '192.0.2.1',
    ]);

    assertSame('203.0.113.4', $request->ipAddress());

    $request = new Request('POST', '/example', [], [], [
        'HTTP_X_REAL_IP' => '198.51.100.42',
    ]);

    assertSame('198.51.100.42', $request->ipAddress());
});

test('leaderboard view renders the player name', function (): void {
    $dbPath = sys_get_temp_dir() . '/jigseer-tests-' . bin2hex(random_bytes(3)) . '.sqlite';
    $database = new Database($dbPath);
    $puzzleId = $database->createPuzzle('Leaderboard Test');
    $database->recordHit($puzzleId, 'Morgan', 2);
    $app = new Application($database, new TemplateRenderer(__DIR__ . '/../templates'));

    $response = $app->handle(new Request('GET', '/p/' . $puzzleId . '/leaderboard', [], [], []));
    assertSame(200, $response->status());
    assertTrue(str_contains($response->body(), 'Morgan'));
});

test('exporting puzzle data produces a zip containing puzzle and hits csv files', function (): void {
    $dbPath = sys_get_temp_dir() . '/jigseer-tests-' . bin2hex(random_bytes(3)) . '.sqlite';
    $database = new Database($dbPath);
    $puzzleId = $database->createPuzzle('Export Test', 1000);
    $database->recordHit($puzzleId, 'Avery', 2, '127.0.0.1', 'phpunit');
    $database->recordHit($puzzleId, 'Blake', 1, '127.0.0.2', 'phpunit');
    $app = new Application($database, new TemplateRenderer(__DIR__ . '/../templates'));

    $response = $app->handle(new Request('GET', '/p/' . $puzzleId . '/settings/export', [], [], []));

    assertSame(200, $response->status());
    $headers = $response->headers();
    assertSame('application/zip', $headers['Content-Type'] ?? '');
    assertTrue(isset($headers['Content-Disposition']) && str_contains($headers['Content-Disposition'], 'attachment'));

    $temp = tempnam(sys_get_temp_dir(), 'jigseer_export_test_');
    if ($temp === false) {
        throw new RuntimeException('Unable to create temp file for zip test');
    }

    file_put_contents($temp, $response->body());
    $zip = new ZipArchive();
    assertTrue($zip->open($temp) === true, 'Unable to open export zip');

    $puzzleCsv = $zip->getFromName('puzzle.csv');
    $hitsCsv = $zip->getFromName('hits.csv');
    $zip->close();
    unlink($temp);

    assertTrue($puzzleCsv !== false, 'puzzle.csv missing from export');
    assertTrue($hitsCsv !== false, 'hits.csv missing from export');

    $puzzleLines = array_map(
        fn (string $line) => str_getcsv($line, ',', '"', '\\'),
        array_filter(explode("\n", trim($puzzleCsv)))
    );
    assertSame('name', $puzzleLines[0][1] ?? null);
    assertSame('Export Test', $puzzleLines[1][1] ?? null);

    $hitsLines = array_map(
        fn (string $line) => str_getcsv($line, ',', '"', '\\'),
        array_filter(explode("\n", trim($hitsCsv)))
    );
    assertSame('player_name', $hitsLines[0][2] ?? null);
    $players = [$hitsLines[1][2] ?? null, $hitsLines[2][2] ?? null];
    sort($players);
    assertSame(['Avery', 'Blake'], $players);
});

test('qr endpoint caches generated images and serves them as png', function (): void {
    $dbPath = sys_get_temp_dir() . '/jigseer-tests-' . bin2hex(random_bytes(3)) . '.sqlite';
    $database = new Database($dbPath);
    $puzzleId = $database->createPuzzle('QR Test');
    $app = new Application($database, new TemplateRenderer(__DIR__ . '/../templates'));

    $qrPath = dirname(__DIR__) . '/var/qr/' . $puzzleId . '.png';
    if (is_file($qrPath)) {
        unlink($qrPath);
    }

    $response = $app->handle(new Request('GET', '/p/' . $puzzleId . '/qr', [], [], [
        'HTTP_HOST' => 'example.com',
    ]));

    assertSame(200, $response->status());
    $headers = $response->headers();
    assertSame('image/png', $headers['Content-Type'] ?? '');
    assertTrue(strlen($response->body()) > 0, 'QR response body should not be empty.');
    assertTrue(file_exists($qrPath), 'QR image was not stored on disk.');

    @unlink($qrPath);
});

$passed = 0;
$total = count($tests);
$failures = [];

foreach ($tests as [$description, $callback]) {
    try {
        $callback();
        $passed++;
        echo "✓ $description\n";
    } catch (Throwable $exception) {
        $failures[] = [$description, $exception];
        echo "𐄂 $description\n";
        echo '    ' . $exception->getMessage() . "\n";
    }
}

echo "\n$passed / $total tests passed\n";

if (!empty($failures)) {
    exit(1);
}
