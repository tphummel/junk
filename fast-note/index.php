<?php
// Fast Note - simple shared text pad

ini_set('display_errors', 1);
error_reporting(E_ALL);

$dbPath = getenv('FASTNOTE_DB') ?: __DIR__ . '/notes.sqlite';
if (!isset($GLOBALS['db'])) {
    $GLOBALS['db'] = new SQLite3($dbPath);
    $GLOBALS['db']->exec('CREATE TABLE IF NOT EXISTS notes (id TEXT PRIMARY KEY, content TEXT)');
}
$db = $GLOBALS['db'];

$id = $_GET['note'] ?? 'home';
if (!preg_match('/^[A-Za-z0-9_-]+$/', $id)) {
    http_response_code(400);
    echo 'Invalid note id';
    exit;
}

if ($_SERVER['REQUEST_METHOD'] === 'POST') {
    $content = $_POST['content'] ?? '';
    $stmt = $db->prepare('REPLACE INTO notes (id, content) VALUES (:id, :content)');
    $stmt->bindValue(':id', $id, SQLITE3_TEXT);
    $stmt->bindValue(':content', $content, SQLITE3_TEXT);
    $stmt->execute();
    $saved = true;
}

$stmt = $db->prepare('SELECT content FROM notes WHERE id = :id');
$stmt->bindValue(':id', $id, SQLITE3_TEXT);
$result = $stmt->execute();
$row = $result->fetchArray(SQLITE3_ASSOC);
$content = $row['content'] ?? '';
?>
<!doctype html>
<html>
<head>
    <meta charset="utf-8">
    <title>Fast Note - <?php echo htmlspecialchars($id, ENT_QUOTES); ?></title>
    <style>
        textarea { width:100%; height:90vh; font-family: monospace; }
        body { margin:0; }
        form { height:100%; }
        .notice { position: fixed; top:10px; right:10px; color: green; }
        button { position: fixed; top:10px; right:10px; }
    </style>
</head>
<body>
    <?php if (!empty($saved)): ?>
        <div class="notice">Saved!</div>
    <?php endif; ?>
    <form method="post">
        <textarea name="content"><?php echo htmlspecialchars($content, ENT_QUOTES); ?></textarea>
        <button type="submit">Save</button>
    </form>
</body>
</html>
