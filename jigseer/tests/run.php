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

const TEST_VERSION = 'test-version';

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

function assertNotEmpty(mixed $value, string $message = 'Failed asserting that value is not empty'): void
{
    if (empty($value)) {
        throw new RuntimeException($message);
    }
}

function makeApp(string $dbPath): Application
{
    $renderer = new TemplateRenderer(__DIR__ . '/../templates');
    $database = new Database($dbPath);

    return new Application($database, $renderer, TEST_VERSION);
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
    $app = new Application($database, new TemplateRenderer(__DIR__ . '/../templates'), TEST_VERSION);

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

test('health endpoint reports ok status with database metadata', function (): void {
    $dbPath = sys_get_temp_dir() . '/jigseer-tests-' . bin2hex(random_bytes(3)) . '.sqlite';
    $app = makeApp($dbPath);

    $response = $app->handle(new Request('GET', '/health', [], [], []));
    assertSame(200, $response->status(), 'Health check should return HTTP 200 when healthy');

    $payload = json_decode($response->body(), true);
    assertTrue(is_array($payload), 'Health response must be valid JSON');
    assertSame('ok', $payload['status'] ?? null);
    assertSame(TEST_VERSION, $payload['version'] ?? null);
    assertTrue(($payload['database']['healthy'] ?? false) === true, 'Database health flag should be true');
    assertSame($dbPath, $payload['database']['path'] ?? null);
});

test('health endpoint includes Fly environment metadata when available', function (): void {
    $dbPath = sys_get_temp_dir() . '/jigseer-tests-' . bin2hex(random_bytes(3)) . '.sqlite';
    $app = makeApp($dbPath);

    $variables = [
        'FLY_APP_NAME' => 'demo-app',
        'FLY_REGION' => 'iad',
        'PRIMARY_REGION' => 'iad',
    ];

    $originals = [];
    foreach ($variables as $name => $value) {
        $originals[$name] = getenv($name);
        putenv($name . '=' . $value);
        $_ENV[$name] = $value;
    }

    try {
        $response = $app->handle(new Request('GET', '/health', [], [], []));
        $payload = json_decode($response->body(), true);

        assertTrue(is_array($payload), 'Health response must be valid JSON');
        foreach ($variables as $name => $value) {
            assertSame($value, $payload['environment'][$name] ?? null, sprintf('Expected %s to be reported', $name));
        }
    } finally {
        foreach ($variables as $name => $_) {
            $original = $originals[$name];
            if ($original === false) {
                putenv($name);
                unset($_ENV[$name]);
            } else {
                putenv($name . '=' . $original);
                $_ENV[$name] = $original;
            }
        }
    }
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

test('puzzle share url omits default ports on play and settings pages', function (): void {
    $dbPath = sys_get_temp_dir() . '/jigseer-tests-' . bin2hex(random_bytes(3)) . '.sqlite';
    $database = new Database($dbPath);
    $puzzleId = $database->createPuzzle('Share URL Test');
    $app = new Application($database, new TemplateRenderer(__DIR__ . '/../templates'), TEST_VERSION);

    $response = $app->handle(new Request('GET', '/p/' . $puzzleId . '/play', [], [], [
        'HTTP_HOST' => 'example.com:80',
        'SERVER_PORT' => '80',
    ]));

    assertSame(200, $response->status());
    $body = $response->body();
    $expectedUrl = 'http://example.com/p/' . $puzzleId . '/play';
    assertTrue(str_contains($body, $expectedUrl), 'Expected sanitized HTTP share URL');
    assertTrue(!str_contains($body, 'http://example.com:80'), 'HTTP default port should be hidden');

    $response = $app->handle(new Request('GET', '/p/' . $puzzleId . '/settings', [], [], [
        'HTTP_HOST' => 'example.com:443',
        'SERVER_PORT' => '443',
        'HTTPS' => 'on',
    ]));

    assertSame(200, $response->status());
    $body = $response->body();
    $expectedUrl = 'https://example.com/p/' . $puzzleId . '/play';
    assertTrue(str_contains($body, $expectedUrl), 'Expected sanitized HTTPS share URL');
    assertTrue(!str_contains($body, 'https://example.com:443'), 'HTTPS default port should be hidden');

    $response = $app->handle(new Request('GET', '/p/' . $puzzleId . '/settings', [], [], [
        'HTTP_HOST' => 'example.com',
        'SERVER_PORT' => '80',
        'HTTP_X_FORWARDED_PROTO' => 'https',
    ]));

    assertSame(200, $response->status());
    $body = $response->body();
    $expectedForwardedUrl = 'https://example.com/p/' . $puzzleId . '/play';
    assertTrue(str_contains($body, $expectedForwardedUrl), 'Expected forwarded HTTPS share URL without backend port');
    assertTrue(!str_contains($body, 'https://example.com:80'), 'Forwarded HTTPS port 80 should be hidden');

    $response = $app->handle(new Request('GET', '/p/' . $puzzleId . '/play', [], [], [
        'HTTP_HOST' => 'example.com:8080',
        'SERVER_PORT' => '8080',
    ]));

    assertSame(200, $response->status());
    assertTrue(str_contains($response->body(), 'http://example.com:8080/p/' . $puzzleId . '/play'), 'Non-default ports must remain visible');
});

test('leaderboard view renders the player name', function (): void {
    $dbPath = sys_get_temp_dir() . '/jigseer-tests-' . bin2hex(random_bytes(3)) . '.sqlite';
    $database = new Database($dbPath);
    $puzzleId = $database->createPuzzle('Leaderboard Test');
    $database->recordHit($puzzleId, 'Morgan', 2);
    $app = new Application($database, new TemplateRenderer(__DIR__ . '/../templates'), TEST_VERSION);

    $response = $app->handle(new Request('GET', '/p/' . $puzzleId . '/leaderboard', [], [], []));
    assertSame(200, $response->status());
    assertTrue(str_contains($response->body(), 'Morgan'));
});

test('transcript entries can be deleted', function (): void {
    $dbPath = sys_get_temp_dir() . '/jigseer-tests-' . bin2hex(random_bytes(3)) . '.sqlite';
    $database = new Database($dbPath);
    $puzzleId = $database->createPuzzle('Transcript Delete Test');
    $database->recordHit($puzzleId, 'Alex', 1);
    $database->recordHit($puzzleId, 'Bryn', 2);

    $ids = $database->connection()->query(
        'SELECT id FROM hits WHERE puzzle_id = ' . $database->connection()->quote($puzzleId) . ' ORDER BY id ASC'
    )->fetchAll(PDO::FETCH_COLUMN);
    assertSame(2, count($ids), 'Expected two hits before deletion');

    $app = new Application($database, new TemplateRenderer(__DIR__ . '/../templates'), TEST_VERSION);
    $hitIdToDelete = (string) $ids[0];

    $response = $app->handle(new Request('POST', '/p/' . $puzzleId . '/transcript/delete', [], [
        'hit_id' => $hitIdToDelete,
    ], []));

    assertSame(302, $response->status());
    assertSame('/p/' . $puzzleId . '/transcript', $response->headers()['Location'] ?? '');

    $remainingIds = $database->connection()->query(
        'SELECT id FROM hits WHERE puzzle_id = ' . $database->connection()->quote($puzzleId)
    )->fetchAll(PDO::FETCH_COLUMN);

    assertSame([ (int) $ids[1] ], array_map('intval', $remainingIds), 'Only the second hit should remain');
});

test('deleting a puzzle requires typing delete as confirmation', function (): void {
    $dbPath = sys_get_temp_dir() . '/jigseer-tests-' . bin2hex(random_bytes(3)) . '.sqlite';
    $database = new Database($dbPath);
    $puzzleId = $database->createPuzzle('Delete Me');
    $app = new Application($database, new TemplateRenderer(__DIR__ . '/../templates'), TEST_VERSION);

    $response = $app->handle(new Request('POST', '/p/' . $puzzleId . '/settings/delete', [], [
        'delete_confirmation' => 'nope',
    ], []));

    assertSame(200, $response->status(), 'Deletion without confirmation should re-render settings.');
    assertTrue(str_contains($response->body(), 'Type “delete” to confirm puzzle removal.'), 'Expected delete error message.');
    assertNotEmpty($database->findPuzzle($puzzleId), 'Puzzle should still exist when confirmation fails.');
});

test('confirming delete removes the puzzle and its hits', function (): void {
    $dbPath = sys_get_temp_dir() . '/jigseer-tests-' . bin2hex(random_bytes(3)) . '.sqlite';
    $database = new Database($dbPath);
    $puzzleId = $database->createPuzzle('Danger Zone');
    $database->recordHit($puzzleId, 'Taylor', 1);
    $app = new Application($database, new TemplateRenderer(__DIR__ . '/../templates'), TEST_VERSION);

    $response = $app->handle(new Request('POST', '/p/' . $puzzleId . '/settings/delete', [], [
        'delete_confirmation' => 'delete',
    ], []));

    assertSame(302, $response->status(), 'Successful deletion should redirect.');
    assertSame('/', $response->headers()['Location'] ?? null);
    assertSame(null, $database->findPuzzle($puzzleId), 'Puzzle should be deleted.');

    $statement = $database->connection()->prepare('SELECT COUNT(*) FROM hits WHERE puzzle_id = :id');
    $statement->execute(['id' => $puzzleId]);
    $remainingHits = (int) $statement->fetchColumn();
    assertSame(0, $remainingHits, 'Associated hits should be removed.');
});

test('exporting puzzle data produces a zip containing puzzle and hits csv files', function (): void {
    $dbPath = sys_get_temp_dir() . '/jigseer-tests-' . bin2hex(random_bytes(3)) . '.sqlite';
    $database = new Database($dbPath);
    $puzzleId = $database->createPuzzle('Export Test', 1000);
    $database->recordHit($puzzleId, 'Avery', 2, '127.0.0.1', 'phpunit');
    $database->recordHit($puzzleId, 'Blake', 1, '127.0.0.2', 'phpunit');
    $app = new Application($database, new TemplateRenderer(__DIR__ . '/../templates'), TEST_VERSION);

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
    $app = new Application($database, new TemplateRenderer(__DIR__ . '/../templates'), TEST_VERSION);

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
    assertSame('public, max-age=31536000, immutable', $headers['Cache-Control'] ?? '');
    assertNotEmpty($headers['ETag'] ?? '', 'QR response should include an ETag header.');
    assertNotEmpty($headers['Last-Modified'] ?? '', 'QR response should include a Last-Modified header.');
    assertTrue(strlen($response->body()) > 0, 'QR response body should not be empty.');
    assertTrue(file_exists($qrPath), 'QR image was not stored on disk.');

    $etag = $headers['ETag'];

    $notModified = $app->handle(new Request('GET', '/p/' . $puzzleId . '/qr', [], [], [
        'HTTP_HOST' => 'example.com',
        'HTTP_IF_NONE_MATCH' => $etag,
    ]));

    assertSame(304, $notModified->status());
    assertSame('', $notModified->body(), '304 QR response should not include a body.');
    $notModifiedHeaders = $notModified->headers();
    assertSame($etag, $notModifiedHeaders['ETag'] ?? '', '304 response should echo original ETag.');
    assertSame('public, max-age=31536000, immutable', $notModifiedHeaders['Cache-Control'] ?? '');

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
