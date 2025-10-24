<?php

declare(strict_types=1);

namespace Jigseer;

use Jigseer\Http\Request;
use Jigseer\Http\Response;
use function Jigseer\ensure_directory;

class Application
{
    public function __construct(
        private readonly Database $database,
        private readonly TemplateRenderer $renderer
    ) {
    }

    public function handle(Request $request): Response
    {
        $method = $request->method();
        $path = rtrim($request->path(), '/') ?: '/';

        if ($method === 'GET' && $path === '/') {
            return $this->home($request);
        }

        if ($method === 'POST' && $path === '/puzzles') {
            return $this->createPuzzle($request);
        }

        if ($method === 'GET' && $path === '/status') {
            return Response::json(['status' => 'ok']);
        }

        $segments = array_values(array_filter(explode('/', $path)));
        if (($segments[0] ?? null) === 'p' && isset($segments[1])) {
            $puzzleId = $segments[1];
            $puzzle = $this->database->findPuzzle($puzzleId);
            if ($puzzle === null) {
                return Response::html($this->renderer->render('404.php', ['puzzleId' => $puzzleId]), 404);
            }

            $tail = array_slice($segments, 2);
            return $this->handlePuzzleRequest($request, $puzzle, $tail);
        }

        return Response::html($this->renderer->render('404.php'), 404);
    }

    private function home(Request $request): Response
    {
        $code = trim((string) $request->query('code', ''));
        if ($code !== '') {
            return Response::redirect('/p/' . rawurlencode($code) . '/play');
        }

        return Response::html($this->renderer->render('home.php'));
    }

    private function createPuzzle(Request $request): Response
    {
        $name = trim((string) $request->body('name', '')); 
        if ($name === '') {
            return Response::html($this->renderer->render('home.php', [
                'error' => 'Please provide a puzzle name.',
            ]), 400);
        }

        $totalPieces = $request->body('total_pieces');
        $totalPieces = $totalPieces !== null && $totalPieces !== '' ? max((int) $totalPieces, 0) : null;
        $puzzleId = $this->database->createPuzzle($name, $totalPieces);

        return Response::redirect('/p/' . $puzzleId);
    }

    private function handlePuzzleRequest(Request $request, array $puzzle, array $tail): Response
    {
        $method = $request->method();
        $tab = $tail[0] ?? 'play';
        $action = $tail[1] ?? null;

        if ($method === 'POST' && $tab === 'hits') {
            return $this->storeHit($request, $puzzle);
        }

        if ($method === 'POST' && $tab === 'settings') {
            return $this->updateSettings($request, $puzzle);
        }

        if ($method === 'GET' && $tab === 'settings' && $action === 'export') {
            return $this->exportPuzzleData($puzzle);
        }

        if ($method === 'GET' && $tab === 'qr') {
            return $this->servePuzzleQr($request, $puzzle);
        }

        if ($method === 'GET' && $tab === 'events') {
            return $this->streamPuzzleEvents($request, $puzzle);
        }

        return match ($tab) {
            'play' => $this->renderPlay($request, $puzzle),
            'leaderboard' => $this->renderLeaderboard($puzzle),
            'transcript' => $this->renderTranscript($puzzle),
            'settings' => $this->renderSettings($request, $puzzle),
            default => Response::html($this->renderer->render('404.php'), 404),
        };
    }

    private function renderPlay(Request $request, array $puzzle): Response
    {
        $progress = $this->database->completionProgress($puzzle['id']);
        $leaderboard = $this->database->leaderboard($puzzle['id']);

        return Response::html($this->renderer->render('play.php', [
            'puzzle' => $puzzle,
            'progress' => $progress,
            'leaderboard' => $leaderboard,
            'puzzleUrl' => $this->puzzleUrl($request, $puzzle),
            'qrPath' => '/p/' . rawurlencode($puzzle['id']) . '/qr',
        ]));
    }

    private function renderLeaderboard(array $puzzle): Response
    {
        $leaderboard = $this->database->leaderboard($puzzle['id']);

        return Response::html($this->renderer->render('leaderboard.php', [
            'puzzle' => $puzzle,
            'leaderboard' => $leaderboard,
        ]));
    }

    private function renderTranscript(array $puzzle): Response
    {
        $hits = $this->database->transcript($puzzle['id']);

        return Response::html($this->renderer->render('transcript.php', [
            'puzzle' => $puzzle,
            'hits' => $hits,
        ]));
    }

    private function renderSettings(Request $request, array $puzzle): Response
    {
        return Response::html($this->renderer->render('settings.php', [
            'puzzle' => $puzzle,
            'puzzleUrl' => $this->puzzleUrl($request, $puzzle),
            'qrPath' => '/p/' . rawurlencode($puzzle['id']) . '/qr',
        ]));
    }

    private function streamPuzzleEvents(Request $request, array $puzzle): Response
    {
        $lastEventId = $request->header('Last-Event-ID');
        if ($lastEventId === null) {
            $querySince = $request->query('since');
            if (is_string($querySince) && trim($querySince) !== '') {
                $lastEventId = $querySince;
            }
        }

        $knownTimestamp = $this->parseEventId($lastEventId);
        $deadline = microtime(true) + 25;
        $latestValue = null;
        $latestTimestamp = null;

        do {
            $latestValue = $this->database->latestHitUpdatedAt($puzzle['id']);
            $latestTimestamp = $this->parseEventId($latestValue);

            if ($latestTimestamp !== null && ($knownTimestamp === null || $latestTimestamp > $knownTimestamp)) {
                break;
            }

            usleep(250000);
        } while (microtime(true) < $deadline);

        if ($latestValue !== null && $latestTimestamp !== null && ($knownTimestamp === null || $latestTimestamp > $knownTimestamp)) {
            $body = "retry: 2000\n"
                . 'id: ' . $latestValue . "\n"
                . "event: hit\n"
                . "data: refresh\n\n";

            return Response::eventStream($body);
        }

        return Response::eventStream("retry: 5000\n: keep-alive\n\n");
    }

    private function storeHit(Request $request, array $puzzle): Response
    {
        $player = trim((string) $request->body('player_name', ''));
        if ($player === '') {
            return Response::redirect('/p/' . $puzzle['id'] . '/play');
        }

        $connections = (int) ($request->body('connection_count', 1));
        $connections = max($connections, 1);
        $this->database->recordHit(
            $puzzle['id'],
            $player,
            $connections,
            $request->ipAddress(),
            $request->userAgent(),
        );

        return Response::redirect('/p/' . $puzzle['id'] . '/play');
    }

    private function updateSettings(Request $request, array $puzzle): Response
    {
        $totalPiecesRaw = $request->body('total_pieces');
        $totalPieces = $totalPiecesRaw !== null && $totalPiecesRaw !== '' ? max((int) $totalPiecesRaw, 0) : null;
        $notes = trim((string) $request->body('notes', ''));
        $statement = $this->database->connection()->prepare('UPDATE puzzles SET total_pieces = :total_pieces, notes = :notes, updated_at = :updated_at WHERE id = :id');
        $statement->execute([
            'total_pieces' => $totalPieces,
            'notes' => $notes !== '' ? $notes : null,
            'updated_at' => (new \DateTimeImmutable())->format(DATE_ATOM),
            'id' => $puzzle['id'],
        ]);

        return Response::redirect('/p/' . $puzzle['id'] . '/settings');
    }

    private function parseEventId(?string $value): ?int
    {
        if ($value === null) {
            return null;
        }

        $value = trim($value);
        if ($value === '') {
            return null;
        }

        $timestamp = strtotime($value);
        if ($timestamp === false) {
            return null;
        }

        return $timestamp;
    }

    private function exportPuzzleData(array $puzzle): Response
    {
        $puzzleColumns = ['id', 'name', 'total_pieces', 'notes', 'image_path', 'created_at', 'updated_at'];
        $hitsColumns = ['id', 'puzzle_id', 'player_name', 'connection_count', 'ip_address', 'user_agent', 'created_at', 'updated_at'];

        $puzzleCsv = $this->buildCsv([$puzzle], $puzzleColumns);
        $hits = $this->database->transcript($puzzle['id']);
        $hitsCsv = $this->buildCsv($hits, $hitsColumns);

        $archiveContents = $this->createZipArchive([
            'puzzle.csv' => $puzzleCsv,
            'hits.csv' => $hitsCsv,
        ]);

        if ($archiveContents === null) {
            return Response::html('Failed to create export archive.', 500);
        }

        if ($archiveContents === '') {
            return Response::html('Failed to read export archive.', 500);
        }

        $filename = sprintf('puzzle-%s-export.zip', $puzzle['id']);

        return Response::download($filename, $archiveContents, 'application/zip');
    }

    /**
     * @param array<string, string> $files
     */
    private function createZipArchive(array $files): ?string
    {
        $localFileData = '';
        $centralDirectory = '';
        $offset = 0;

        foreach ($files as $name => $contents) {
            $name = str_replace('\\', '/', $name);
            $contentLength = strlen($contents);
            $crc = crc32($contents);
            if ($crc < 0) {
                $crc = (int) sprintf('%u', $crc);
            }

            $fileNameLength = strlen($name);

            $dosTime = 0;
            $dosDate = 0;

            $localHeader = pack('VvvvvvVVVvv',
                0x04034b50,
                20,
                0,
                0,
                $dosTime,
                $dosDate,
                $crc,
                $contentLength,
                $contentLength,
                $fileNameLength,
                0,
            );

            $localRecord = $localHeader . $name . $contents;
            $localFileData .= $localRecord;

            $centralDirectory .= pack('VvvvvvvVVVvvvvvVV',
                0x02014b50,
                20,
                20,
                0,
                0,
                $dosTime,
                $dosDate,
                $crc,
                $contentLength,
                $contentLength,
                $fileNameLength,
                0,
                0,
                0,
                0,
                32,
                $offset,
            ) . $name;

            $offset += strlen($localRecord);
        }

        $endOfCentralDirectory = pack('VvvvvVVv',
            0x06054b50,
            0,
            0,
            count($files),
            count($files),
            strlen($centralDirectory),
            strlen($localFileData),
            0,
        );

        return $localFileData . $centralDirectory . $endOfCentralDirectory;
    }

    private function servePuzzleQr(Request $request, array $puzzle): Response
    {
        try {
            $filePath = $this->ensureQrCodeImage($request, $puzzle);
        } catch (\Throwable $exception) {
            return Response::html('Failed to prepare QR code image.', 500);
        }

        $stat = @stat($filePath);
        if ($stat === false) {
            return Response::html('Failed to inspect QR code image.', 500);
        }

        $lastModified = gmdate('D, d M Y H:i:s', (int) $stat['mtime']) . ' GMT';
        $weakEtag = sprintf('%x-%x', (int) $stat['mtime'], (int) $stat['size']);
        $etag = sprintf('W/"%s"', $weakEtag);

        $cacheHeaders = [
            'Cache-Control' => 'public, max-age=31536000, immutable',
            'ETag' => $etag,
            'Last-Modified' => $lastModified,
        ];

        $ifNoneMatch = $request->header('If-None-Match');
        if ($ifNoneMatch !== null) {
            $clientEtags = array_map('trim', explode(',', $ifNoneMatch));
            if (in_array('*', $clientEtags, true) || in_array($etag, $clientEtags, true)) {
                return new Response(304, $cacheHeaders, '');
            }
        }

        $ifModifiedSince = $request->header('If-Modified-Since');
        if ($ifModifiedSince !== null) {
            $since = strtotime($ifModifiedSince);
            if ($since !== false && (int) $stat['mtime'] <= $since) {
                return new Response(304, $cacheHeaders, '');
            }
        }

        $contents = @file_get_contents($filePath);
        if ($contents === false) {
            return Response::html('Failed to read QR code image.', 500);
        }

        return Response::file($contents, 'image/png', $cacheHeaders);
    }

    private function ensureQrCodeImage(Request $request, array $puzzle): string
    {
        $directory = $this->qrStorageDirectory();
        ensure_directory($directory);

        $filePath = $directory . '/' . $puzzle['id'] . '.png';
        if (!is_file($filePath)) {
            $this->writeQrCode($this->puzzleUrl($request, $puzzle), $filePath);
        }

        return $filePath;
    }

    private function qrStorageDirectory(): string
    {
        return dirname(__DIR__) . '/var/qr';
    }

    private function puzzleUrl(Request $request, array $puzzle): string
    {
        $path = '/p/' . rawurlencode($puzzle['id']) . '/play';

        return $this->withoutDefaultPort($request->absoluteUrl($path));
    }

    private function withoutDefaultPort(string $url): string
    {
        $components = parse_url($url);

        if ($components === false) {
            return $url;
        }

        $port = $components['port'] ?? null;

        if ($port === null) {
            return $url;
        }

        $portNumber = is_int($port) ? $port : (int) $port;

        if ($portNumber !== 80 && $portNumber !== 443) {
            return $url;
        }

        unset($components['port']);

        return $this->buildUrl($components);
    }

    private function buildUrl(array $components): string
    {
        $scheme = isset($components['scheme']) ? $components['scheme'] . '://' : '';
        $user = $components['user'] ?? '';
        $pass = $components['pass'] ?? '';
        $auth = $user !== '' ? $user . ($pass !== '' ? ':' . $pass : '') . '@' : '';
        $host = $components['host'] ?? '';
        $port = isset($components['port']) ? ':' . $components['port'] : '';
        $path = $components['path'] ?? '';
        $query = isset($components['query']) ? '?' . $components['query'] : '';
        $fragment = isset($components['fragment']) ? '#' . $components['fragment'] : '';

        return $scheme . $auth . $host . $port . $path . $query . $fragment;
    }

    private function writeQrCode(string $puzzleUrl, string $filePath): void
    {
        $endpoint = 'https://api.qrserver.com/v1/create-qr-code/?size=300x300&data=' . rawurlencode($puzzleUrl);
        $context = stream_context_create([
            'http' => ['timeout' => 5],
        ]);

        $qrImage = @file_get_contents($endpoint, false, $context);
        if ($qrImage !== false) {
            if (@file_put_contents($filePath, $qrImage) === false) {
                throw new \RuntimeException('Unable to store QR code image.');
            }

            return;
        }

        $this->createPlaceholderQr($filePath, $puzzleUrl);
    }

    private function createPlaceholderQr(string $filePath, string $puzzleUrl): void
    {
        $size = 200;
        $image = imagecreatetruecolor($size, $size);
        if ($image === false) {
            throw new \RuntimeException('Unable to allocate placeholder image resource.');
        }

        $background = imagecolorallocate($image, 255, 255, 255);
        $border = imagecolorallocate($image, 200, 200, 200);
        $textColor = imagecolorallocate($image, 60, 60, 60);

        imagefilledrectangle($image, 0, 0, $size - 1, $size - 1, $background);
        imagerectangle($image, 0, 0, $size - 1, $size - 1, $border);

        $message = 'QR unavailable';
        $font = 3;
        $messageWidth = imagefontwidth($font) * strlen($message);
        $messageHeight = imagefontheight($font);
        $messageX = max(0, (int) (($size - $messageWidth) / 2));
        $messageY = (int) (($size - $messageHeight) / 2) - 8;
        imagestring($image, $font, $messageX, max(0, $messageY), $message, $textColor);

        $fontSmall = 2;
        $maxChars = 24;
        $displayUrl = strlen($puzzleUrl) > $maxChars ? substr($puzzleUrl, 0, $maxChars - 1) . '…' : $puzzleUrl;
        $urlWidth = imagefontwidth($fontSmall) * strlen($displayUrl);
        $urlHeight = imagefontheight($fontSmall);
        $urlX = max(0, (int) (($size - $urlWidth) / 2));
        $urlY = min($size - $urlHeight - 4, (int) (($size + $messageHeight) / 2));
        imagestring($image, $fontSmall, $urlX, max(0, $urlY), $displayUrl, $textColor);

        if (!imagepng($image, $filePath)) {
            imagedestroy($image);
            throw new \RuntimeException('Unable to write placeholder QR image.');
        }

        imagedestroy($image);
    }

    /**
     * @param array<int, array<string, mixed>> $rows
     * @param string[] $columns
     */
    private function buildCsv(array $rows, array $columns): string
    {
        $handle = fopen('php://temp', 'r+');
        if ($handle === false) {
            return '';
        }

        fputcsv($handle, $columns, ',', '"', '\\');

        foreach ($rows as $row) {
            $line = [];
            foreach ($columns as $column) {
                $value = $row[$column] ?? null;
                $line[] = is_bool($value) ? ($value ? '1' : '0') : $value;
            }
            fputcsv($handle, $line, ',', '"', '\\');
        }

        rewind($handle);
        $contents = stream_get_contents($handle);
        fclose($handle);

        return $contents === false ? '' : $contents;
    }
}
