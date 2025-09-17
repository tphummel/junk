<?php
ini_set('display_errors', '1');
error_reporting(E_ALL);

const RPS_ALLOWED_MOVES = ['rock', 'paper', 'scissors'];

function rps_db_path(): string
{
    $envPath = getenv('RPS_DB');
    if ($envPath && trim($envPath) !== '') {
        return $envPath;
    }
    return __DIR__ . '/data/rps.sqlite';
}

function rps_db(): SQLite3
{
    if (!isset($GLOBALS['rps_db'])) {
        $path = rps_db_path();
        if (strpos($path, 'file:') !== 0 && strpos($path, ':memory:') !== 0) {
            $dir = dirname($path);
            if (!is_dir($dir)) {
                mkdir($dir, 0777, true);
            }
        }

        $GLOBALS['rps_db'] = new SQLite3($path);
        $GLOBALS['rps_db']->exec('PRAGMA foreign_keys = ON');
        rps_ensure_schema($GLOBALS['rps_db']);
    }

    return $GLOBALS['rps_db'];
}

function rps_ensure_schema(SQLite3 $db): void
{
    $db->exec('CREATE TABLE IF NOT EXISTS players (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        name TEXT UNIQUE COLLATE NOCASE,
        created_at TEXT DEFAULT CURRENT_TIMESTAMP
    )');

    $db->exec('CREATE TABLE IF NOT EXISTS venues (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        name TEXT UNIQUE COLLATE NOCASE,
        created_at TEXT DEFAULT CURRENT_TIMESTAMP
    )');

    $db->exec('CREATE TABLE IF NOT EXISTS matches (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        played_at TEXT DEFAULT CURRENT_TIMESTAMP,
        player_one_id INTEGER NOT NULL,
        player_two_id INTEGER NOT NULL,
        venue_id INTEGER NOT NULL,
        move_one TEXT NOT NULL,
        move_two TEXT NOT NULL,
        outcome TEXT NOT NULL,
        FOREIGN KEY(player_one_id) REFERENCES players(id) ON DELETE RESTRICT,
        FOREIGN KEY(player_two_id) REFERENCES players(id) ON DELETE RESTRICT,
        FOREIGN KEY(venue_id) REFERENCES venues(id) ON DELETE RESTRICT,
        CHECK(player_one_id <> player_two_id)
    )');
}

function rps_status(): void
{
    $db = rps_db();
    $check = $db->query('SELECT 1');
    if ($check === false) {
        http_response_code(500);
        header('Content-Type: text/plain');
        echo 'error';
    } else {
        header('Content-Type: text/plain');
        echo 'ok';
    }
    exit;
}

function rps_find_or_create_player(SQLite3 $db, string $name): int
{
    $stmt = $db->prepare('SELECT id FROM players WHERE name = :name COLLATE NOCASE');
    $stmt->bindValue(':name', $name, SQLITE3_TEXT);
    $result = $stmt->execute();
    $row = $result->fetchArray(SQLITE3_ASSOC);
    if ($row && isset($row['id'])) {
        return (int)$row['id'];
    }

    $insert = $db->prepare('INSERT INTO players (name) VALUES (:name)');
    $insert->bindValue(':name', $name, SQLITE3_TEXT);
    $insert->execute();
    return (int)$db->lastInsertRowID();
}

function rps_find_or_create_venue(SQLite3 $db, string $name): int
{
    $stmt = $db->prepare('SELECT id FROM venues WHERE name = :name COLLATE NOCASE');
    $stmt->bindValue(':name', $name, SQLITE3_TEXT);
    $result = $stmt->execute();
    $row = $result->fetchArray(SQLITE3_ASSOC);
    if ($row && isset($row['id'])) {
        return (int)$row['id'];
    }

    $insert = $db->prepare('INSERT INTO venues (name) VALUES (:name)');
    $insert->bindValue(':name', $name, SQLITE3_TEXT);
    $insert->execute();
    return (int)$db->lastInsertRowID();
}

function rps_determine_outcome(string $moveOne, string $moveTwo): string
{
    if ($moveOne === $moveTwo) {
        return 'draw';
    }

    $beats = [
        'rock' => 'scissors',
        'paper' => 'rock',
        'scissors' => 'paper',
    ];

    if ($beats[$moveOne] === $moveTwo) {
        return 'player_one';
    }

    return 'player_two';
}

function rps_recent_matches(SQLite3 $db): array
{
    $query = $db->prepare('SELECT m.played_at, p1.name AS player_one, p2.name AS player_two, v.name AS venue, m.move_one, m.move_two, m.outcome
        FROM matches m
        JOIN players p1 ON m.player_one_id = p1.id
        JOIN players p2 ON m.player_two_id = p2.id
        JOIN venues v ON m.venue_id = v.id
        ORDER BY m.played_at DESC, m.id DESC
        LIMIT 10');
    $result = $query->execute();

    $rows = [];
    while ($row = $result->fetchArray(SQLITE3_ASSOC)) {
        $rows[] = $row;
    }
    return $rows;
}

function rps_all_names(SQLite3 $db, string $table): array
{
    $query = $db->prepare("SELECT name FROM {$table} ORDER BY name COLLATE NOCASE ASC");
    $result = $query->execute();

    $names = [];
    while ($row = $result->fetchArray(SQLITE3_ASSOC)) {
        $names[] = $row['name'];
    }
    return $names;
}

$uri = $_SERVER['REQUEST_URI'] ?? '/';
$path = parse_url($uri, PHP_URL_PATH) ?: '/';

if ($path === '/status') {
    rps_status();
}

if ($path !== '/') {
    http_response_code(404);
    header('Content-Type: text/plain');
    echo 'Not Found';
    exit;
}

$db = rps_db();

$form = [
    'player_one' => '',
    'player_two' => '',
    'venue' => '',
    'move_one' => RPS_ALLOWED_MOVES[0],
    'move_two' => RPS_ALLOWED_MOVES[0],
];
$errors = [];
$saved = false;

if ($_SERVER['REQUEST_METHOD'] === 'POST') {
    $form['player_one'] = trim($_POST['player_one'] ?? '');
    $form['player_two'] = trim($_POST['player_two'] ?? '');
    $form['venue'] = trim($_POST['venue'] ?? '');
    $form['move_one'] = $_POST['move_one'] ?? RPS_ALLOWED_MOVES[0];
    $form['move_two'] = $_POST['move_two'] ?? RPS_ALLOWED_MOVES[0];

    if ($form['player_one'] === '') {
        $errors[] = 'Player 1 name is required.';
    }
    if ($form['player_two'] === '') {
        $errors[] = 'Player 2 name is required.';
    }
    if ($form['player_one'] !== '' && $form['player_two'] !== '' && strcasecmp($form['player_one'], $form['player_two']) === 0) {
        $errors[] = 'Players must be different people.';
    }
    if ($form['venue'] === '') {
        $errors[] = 'Venue name is required.';
    }
    if (!in_array($form['move_one'], RPS_ALLOWED_MOVES, true)) {
        $errors[] = 'Invalid move for Player 1.';
    }
    if (!in_array($form['move_two'], RPS_ALLOWED_MOVES, true)) {
        $errors[] = 'Invalid move for Player 2.';
    }

    if (empty($errors)) {
        $db->exec('BEGIN');
        try {
            $playerOneId = rps_find_or_create_player($db, $form['player_one']);
            $playerTwoId = rps_find_or_create_player($db, $form['player_two']);
            $venueId = rps_find_or_create_venue($db, $form['venue']);
            if ($playerOneId === $playerTwoId) {
                throw new RuntimeException('Players must be different.');
            }

            $outcome = rps_determine_outcome($form['move_one'], $form['move_two']);
            $insert = $db->prepare('INSERT INTO matches (player_one_id, player_two_id, venue_id, move_one, move_two, outcome) VALUES (:p1, :p2, :venue, :move_one, :move_two, :outcome)');
            $insert->bindValue(':p1', $playerOneId, SQLITE3_INTEGER);
            $insert->bindValue(':p2', $playerTwoId, SQLITE3_INTEGER);
            $insert->bindValue(':venue', $venueId, SQLITE3_INTEGER);
            $insert->bindValue(':move_one', $form['move_one'], SQLITE3_TEXT);
            $insert->bindValue(':move_two', $form['move_two'], SQLITE3_TEXT);
            $insert->bindValue(':outcome', $outcome, SQLITE3_TEXT);
            $insert->execute();

            $db->exec('COMMIT');
            $saved = true;
            $form = [
                'player_one' => '',
                'player_two' => '',
                'venue' => '',
                'move_one' => RPS_ALLOWED_MOVES[0],
                'move_two' => RPS_ALLOWED_MOVES[0],
            ];
        } catch (Throwable $e) {
            $db->exec('ROLLBACK');
            $errors[] = 'Failed to save match: ' . $e->getMessage();
        }
    }
}

$players = rps_all_names($db, 'players');
$venues = rps_all_names($db, 'venues');
$matches = rps_recent_matches($db);

function rps_escape(string $value): string
{
    return htmlspecialchars($value, ENT_QUOTES, 'UTF-8');
}

function rps_outcome_label(string $outcome): string
{
    switch ($outcome) {
        case 'player_one':
            return 'Player 1';
        case 'player_two':
            return 'Player 2';
        default:
            return 'Draw';
    }
}
?>
<!doctype html>
<html lang="en">
<head>
    <meta charset="utf-8">
    <title>Rock Paper Scissors Tracker</title>
    <style>
        body {
            font-family: Arial, sans-serif;
            max-width: 720px;
            margin: 0 auto;
            padding: 20px;
            background: #f9f9f9;
        }
        h1 {
            font-size: 1.8rem;
            margin-bottom: 0.5rem;
        }
        form {
            background: #fff;
            padding: 16px;
            border: 1px solid #ddd;
            border-radius: 4px;
            margin-bottom: 24px;
        }
        label {
            display: block;
            font-weight: bold;
            margin-bottom: 4px;
        }
        input[type="text"], select {
            width: 100%;
            padding: 8px;
            margin-bottom: 12px;
            border: 1px solid #ccc;
            border-radius: 4px;
        }
        button {
            padding: 10px 16px;
            border: none;
            background: #333;
            color: #fff;
            border-radius: 4px;
            cursor: pointer;
        }
        .notice {
            margin-bottom: 12px;
            padding: 10px;
            border-radius: 4px;
        }
        .success {
            background: #e0f6e9;
            color: #1a7f3b;
        }
        .errors {
            background: #fdecea;
            color: #c0392b;
        }
        table {
            width: 100%;
            border-collapse: collapse;
            background: #fff;
        }
        th, td {
            padding: 8px;
            border: 1px solid #ddd;
            text-align: left;
        }
        th {
            background: #f0f0f0;
        }
    </style>
</head>
<body>
    <h1>Rock Paper Scissors Tracker</h1>
    <p>Log the next match result between two players. All entries are stored in SQLite.</p>

    <?php if (!empty($errors)): ?>
        <div class="notice errors">
            <ul>
                <?php foreach ($errors as $error): ?>
                    <li><?php echo rps_escape($error); ?></li>
                <?php endforeach; ?>
            </ul>
        </div>
    <?php elseif ($saved): ?>
        <div class="notice success">Match recorded!</div>
    <?php endif; ?>

    <form method="post">
        <label for="player_one">Player 1</label>
        <input type="text" name="player_one" id="player_one" list="players" value="<?php echo rps_escape($form['player_one']); ?>" autocomplete="off" required>

        <label for="move_one">Player 1 move</label>
        <select name="move_one" id="move_one">
            <?php foreach (RPS_ALLOWED_MOVES as $move): ?>
                <option value="<?php echo rps_escape($move); ?>" <?php echo $form['move_one'] === $move ? 'selected' : ''; ?>><?php echo ucfirst($move); ?></option>
            <?php endforeach; ?>
        </select>

        <label for="player_two">Player 2</label>
        <input type="text" name="player_two" id="player_two" list="players" value="<?php echo rps_escape($form['player_two']); ?>" autocomplete="off" required>

        <label for="move_two">Player 2 move</label>
        <select name="move_two" id="move_two">
            <?php foreach (RPS_ALLOWED_MOVES as $move): ?>
                <option value="<?php echo rps_escape($move); ?>" <?php echo $form['move_two'] === $move ? 'selected' : ''; ?>><?php echo ucfirst($move); ?></option>
            <?php endforeach; ?>
        </select>

        <label for="venue">Venue</label>
        <input type="text" name="venue" id="venue" list="venues" value="<?php echo rps_escape($form['venue']); ?>" autocomplete="off" required>

        <button type="submit">Record match</button>
    </form>

    <datalist id="players">
        <?php foreach ($players as $player): ?>
            <option value="<?php echo rps_escape($player); ?>"></option>
        <?php endforeach; ?>
    </datalist>

    <datalist id="venues">
        <?php foreach ($venues as $venue): ?>
            <option value="<?php echo rps_escape($venue); ?>"></option>
        <?php endforeach; ?>
    </datalist>

    <h2>Recent matches</h2>
    <?php if (empty($matches)): ?>
        <p>No matches recorded yet.</p>
    <?php else: ?>
        <table>
            <thead>
                <tr>
                    <th>Played at</th>
                    <th>Player 1</th>
                    <th>Move</th>
                    <th>Player 2</th>
                    <th>Move</th>
                    <th>Venue</th>
                    <th>Winner</th>
                </tr>
            </thead>
            <tbody>
                <?php foreach ($matches as $match): ?>
                    <tr>
                        <td><?php echo rps_escape($match['played_at']); ?></td>
                        <td><?php echo rps_escape($match['player_one']); ?></td>
                        <td><?php echo rps_escape(ucfirst($match['move_one'])); ?></td>
                        <td><?php echo rps_escape($match['player_two']); ?></td>
                        <td><?php echo rps_escape(ucfirst($match['move_two'])); ?></td>
                        <td><?php echo rps_escape($match['venue']); ?></td>
                        <td><?php echo rps_escape(rps_outcome_label($match['outcome'])); ?></td>
                    </tr>
                <?php endforeach; ?>
            </tbody>
        </table>
    <?php endif; ?>
</body>
</html>
