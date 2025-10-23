<?php

declare(strict_types=1);

namespace Jigseer;

use Jigseer\Http\Request;
use Jigseer\Http\Response;

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
            return $this->home();
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

    private function home(): Response
    {
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

        return match ($tab) {
            'play' => $this->renderPlay($puzzle),
            'leaderboard' => $this->renderLeaderboard($puzzle),
            'transcript' => $this->renderTranscript($puzzle),
            'settings' => $this->renderSettings($puzzle),
            default => Response::html($this->renderer->render('404.php'), 404),
        };
    }

    private function renderPlay(array $puzzle): Response
    {
        $progress = $this->database->completionProgress($puzzle['id']);
        $leaderboard = $this->database->leaderboard($puzzle['id']);

        return Response::html($this->renderer->render('play.php', [
            'puzzle' => $puzzle,
            'progress' => $progress,
            'leaderboard' => $leaderboard,
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

    private function renderSettings(array $puzzle): Response
    {
        return Response::html($this->renderer->render('settings.php', [
            'puzzle' => $puzzle,
        ]));
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

    private function exportPuzzleData(array $puzzle): Response
    {
        $puzzleColumns = ['id', 'name', 'total_pieces', 'notes', 'image_path', 'created_at', 'updated_at'];
        $hitsColumns = ['id', 'puzzle_id', 'player_name', 'connection_count', 'ip_address', 'user_agent', 'created_at', 'updated_at'];

        $puzzleCsv = $this->buildCsv([$puzzle], $puzzleColumns);
        $hits = $this->database->transcript($puzzle['id']);
        $hitsCsv = $this->buildCsv($hits, $hitsColumns);

        $tempFile = tempnam(sys_get_temp_dir(), 'jigseer_export_');
        if ($tempFile === false) {
            return Response::html('Failed to create export archive.', 500);
        }

        $zip = new \ZipArchive();
        $openResult = $zip->open($tempFile, \ZipArchive::CREATE | \ZipArchive::OVERWRITE);
        if ($openResult !== true) {
            @unlink($tempFile);

            return Response::html('Failed to create export archive.', 500);
        }

        $zip->addFromString('puzzle.csv', $puzzleCsv);
        $zip->addFromString('hits.csv', $hitsCsv);
        $zip->close();

        $contents = file_get_contents($tempFile);
        @unlink($tempFile);

        if ($contents === false) {
            return Response::html('Failed to read export archive.', 500);
        }

        $filename = sprintf('puzzle-%s-export.zip', $puzzle['id']);

        return Response::download($filename, $contents, 'application/zip');
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
