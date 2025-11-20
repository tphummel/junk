<?php

declare(strict_types=1);

namespace Jigseer;

use PDO;
use PDOException;

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

    public function path(): string
    {
        return $this->path;
    }

    public function isHealthy(): bool
    {
        try {
            $statement = $this->pdo->query('SELECT 1');

            return $statement !== false;
        } catch (PDOException) {
            return false;
        }
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

    public function allPuzzlesWithStats(): array
    {
        $statement = $this->pdo->query(
            'SELECT
                p.id,
                p.name,
                p.created_at,
                p.updated_at AS puzzle_updated_at,
                COALESCE(aggregated.total_hits, 0) AS total_hits,
                COALESCE(aggregated.player_count, 0) AS player_count,
                aggregated.last_hit_at
            FROM puzzles p
            LEFT JOIN (
                SELECT
                    puzzle_id,
                    SUM(connection_count) AS total_hits,
                    COUNT(DISTINCT player_name) AS player_count,
                    MAX(updated_at) AS last_hit_at
                FROM hits
                GROUP BY puzzle_id
            ) AS aggregated ON aggregated.puzzle_id = p.id
            ORDER BY p.created_at DESC, p.id ASC'
        );

        $rows = $statement->fetchAll(PDO::FETCH_ASSOC);

        return array_map(
            static function (array $row): array {
                $updatedAt = $row['puzzle_updated_at'];
                $lastHitAt = $row['last_hit_at'] ?? null;

                if ($lastHitAt !== null && $lastHitAt > $updatedAt) {
                    $updatedAt = $lastHitAt;
                }

                return [
                    'id' => $row['id'],
                    'name' => $row['name'],
                    'created_at' => $row['created_at'],
                    'updated_at' => $updatedAt,
                    'total_hits' => (int) ($row['total_hits'] ?? 0),
                    'player_count' => (int) ($row['player_count'] ?? 0),
                ];
            },
            $rows
        );
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
            'WITH player_hits AS (
                SELECT
                    player_name,
                    connection_count,
                    created_at,
                    id,
                    CAST(strftime(\'%s\', created_at) AS INTEGER) AS created_epoch,
                    LAG(CAST(strftime(\'%s\', created_at) AS INTEGER)) OVER (
                        PARTITION BY player_name
                        ORDER BY created_at ASC, id ASC
                    ) AS previous_epoch
                FROM hits
                WHERE puzzle_id = :puzzle_id
            ), totals AS (
                SELECT
                    player_name,
                    SUM(connection_count) AS hits,
                    MIN(created_at) AS first_hit,
                    MAX(created_at) AS last_hit,
                    COALESCE(SUM(
                        CASE
                            WHEN previous_epoch IS NULL THEN 0
                            WHEN created_epoch - previous_epoch > 1200 THEN 0
                            ELSE created_epoch - previous_epoch
                        END
                    ), 0) AS active_seconds
                FROM player_hits
                GROUP BY player_name
            ), recent_source AS (
                SELECT player_name, connection_count
                FROM hits
                WHERE puzzle_id = :puzzle_id_recent
                ORDER BY created_at DESC, id DESC
                LIMIT 100
            ), recent AS (
                SELECT player_name, SUM(connection_count) AS recent_hits
                FROM recent_source
                GROUP BY player_name
            )
            SELECT totals.player_name,
                   totals.hits,
                   totals.first_hit,
                   totals.last_hit,
                   totals.active_seconds,
                   COALESCE(recent.recent_hits, 0) AS recent_hits
            FROM totals
            LEFT JOIN recent ON recent.player_name = totals.player_name
            ORDER BY totals.hits DESC, totals.player_name ASC'
        );
        $statement->execute([
            'puzzle_id' => $puzzleId,
            'puzzle_id_recent' => $puzzleId,
        ]);

        return $statement->fetchAll(PDO::FETCH_ASSOC);
    }

    public function transcript(string $puzzleId): array
    {
        $statement = $this->pdo->prepare('SELECT * FROM hits WHERE puzzle_id = :puzzle_id ORDER BY created_at DESC, id DESC');
        $statement->execute(['puzzle_id' => $puzzleId]);

        return $statement->fetchAll(PDO::FETCH_ASSOC);
    }

    public function connectionEvents(string $puzzleId): array
    {
        return array_reverse($this->transcript($puzzleId));
    }

    public function deleteHit(string $puzzleId, int $hitId): void
    {
        $statement = $this->pdo->prepare('DELETE FROM hits WHERE puzzle_id = :puzzle_id AND id = :id');
        $statement->execute([
            'puzzle_id' => $puzzleId,
            'id' => $hitId,
        ]);
    }

    public function latestHitUpdatedAt(string $puzzleId): ?string
    {
        $statement = $this->pdo->prepare('SELECT MAX(updated_at) FROM hits WHERE puzzle_id = :puzzle_id');
        $statement->execute(['puzzle_id' => $puzzleId]);

        $value = $statement->fetchColumn();
        if ($value === false) {
            return null;
        }

        $stringValue = is_string($value) ? $value : null;

        return $stringValue !== null && $stringValue !== '' ? $stringValue : null;
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

    public function deletePuzzle(string $id): void
    {
        $statement = $this->pdo->prepare('DELETE FROM puzzles WHERE id = :id');
        $statement->execute(['id' => $id]);
    }
}
