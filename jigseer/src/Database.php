<?php

declare(strict_types=1);

namespace Jigseer;

use PDO;

class Database
{
    private PDO $pdo;

    public function __construct(private readonly string $path)
    {
        $directory = dirname($this->path);
        ensure_directory($directory);
        $this->pdo = new PDO('sqlite:' . $this->path);
        $this->pdo->setAttribute(PDO::ATTR_ERRMODE, PDO::ERRMODE_EXCEPTION);
        $this->pdo->exec('PRAGMA foreign_keys = ON');
        $this->pdo->exec('PRAGMA busy_timeout = 5000');

        $this->initialiseSchema();
    }

    public function connection(): PDO
    {
        return $this->pdo;
    }

    private function initialiseSchema(): void
    {
        $this->pdo->exec(
            'CREATE TABLE IF NOT EXISTS puzzles (
                id TEXT PRIMARY KEY,
                name TEXT NOT NULL,
                total_pieces INTEGER,
                notes TEXT,
                image_path TEXT,
                created_at TEXT NOT NULL,
                updated_at TEXT NOT NULL
            )'
        );

        $this->pdo->exec(
            'CREATE TABLE IF NOT EXISTS hits (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                puzzle_id TEXT NOT NULL REFERENCES puzzles(id) ON DELETE CASCADE,
                player_name TEXT NOT NULL,
                connection_count INTEGER NOT NULL DEFAULT 1,
                ip_address TEXT,
                user_agent TEXT,
                created_at TEXT NOT NULL,
                updated_at TEXT NOT NULL
            )'
        );
    }

    public function createPuzzle(string $name, ?int $totalPieces = null): string
    {
        $id = generate_code();
        $now = (new \DateTimeImmutable())->format(DATE_ATOM);

        $statement = $this->pdo->prepare('INSERT INTO puzzles (id, name, total_pieces, notes, image_path, created_at, updated_at) VALUES (:id, :name, :total_pieces, :notes, :image_path, :created_at, :updated_at)');
        $statement->execute([
            'id' => $id,
            'name' => $name,
            'total_pieces' => $totalPieces,
            'notes' => null,
            'image_path' => null,
            'created_at' => $now,
            'updated_at' => $now,
        ]);

        return $id;
    }

    public function findPuzzle(string $id): ?array
    {
        $statement = $this->pdo->prepare('SELECT * FROM puzzles WHERE id = :id');
        $statement->execute(['id' => $id]);
        $row = $statement->fetch(PDO::FETCH_ASSOC);

        return $row ?: null;
    }

    public function recordHit(string $puzzleId, string $playerName, int $connections, ?string $ipAddress = null, ?string $userAgent = null): void
    {
        $now = (new \DateTimeImmutable())->format(DATE_ATOM);
        $statement = $this->pdo->prepare('INSERT INTO hits (puzzle_id, player_name, connection_count, ip_address, user_agent, created_at, updated_at) VALUES (:puzzle_id, :player_name, :connection_count, :ip_address, :user_agent, :created_at, :updated_at)');
        $statement->execute([
            'puzzle_id' => $puzzleId,
            'player_name' => $playerName,
            'connection_count' => $connections,
            'ip_address' => $ipAddress,
            'user_agent' => $userAgent,
            'created_at' => $now,
            'updated_at' => $now,
        ]);
    }

    public function leaderboard(string $puzzleId): array
    {
        $statement = $this->pdo->prepare(
            'SELECT player_name, SUM(connection_count) AS hits, MIN(created_at) AS first_hit, MAX(created_at) AS last_hit
             FROM hits
             WHERE puzzle_id = :puzzle_id
             GROUP BY player_name
             ORDER BY hits DESC, player_name ASC'
        );
        $statement->execute(['puzzle_id' => $puzzleId]);

        return $statement->fetchAll(PDO::FETCH_ASSOC);
    }

    public function transcript(string $puzzleId): array
    {
        $statement = $this->pdo->prepare('SELECT * FROM hits WHERE puzzle_id = :puzzle_id ORDER BY created_at DESC, id DESC');
        $statement->execute(['puzzle_id' => $puzzleId]);

        return $statement->fetchAll(PDO::FETCH_ASSOC);
    }

    public function completionProgress(string $puzzleId): array
    {
        $puzzle = $this->findPuzzle($puzzleId);
        if (!$puzzle) {
            return ['total' => null, 'completed' => 0, 'percentage' => 0.0];
        }

        $statement = $this->pdo->prepare('SELECT COALESCE(SUM(connection_count), 0) AS total_hits FROM hits WHERE puzzle_id = :puzzle_id');
        $statement->execute(['puzzle_id' => $puzzleId]);
        $hits = (int) $statement->fetchColumn();

        $total = $puzzle['total_pieces'] !== null ? max(((int) $puzzle['total_pieces']) - 1, 0) : null;
        $percentage = $total ? min(($hits / $total) * 100, 100) : 0.0;

        return [
            'total' => $total,
            'completed' => $hits,
            'percentage' => $percentage,
        ];
    }
}
