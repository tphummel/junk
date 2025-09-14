<?php
// Fast Note - simple shared text pad with Markdown rendering

ini_set('display_errors', 1);
error_reporting(E_ALL);

$dbPath = getenv('FASTNOTE_DB') ?: __DIR__ . '/notes.sqlite';
if (!isset($GLOBALS['db'])) {
    $GLOBALS['db'] = new SQLite3($dbPath);
    $GLOBALS['db']->exec('CREATE TABLE IF NOT EXISTS notes (id TEXT PRIMARY KEY, content TEXT)');
}
$db = $GLOBALS['db'];

if (!function_exists("render_markdown")) {
    // Defined inside a guard so tests can include this file multiple times.
    function render_markdown(string $text): string {
        // Escape HTML first
        $text = htmlspecialchars($text, ENT_QUOTES, 'UTF-8');
        // Headings
        $text = preg_replace('/^### (.+)$/m', '<h3>$1</h3>', $text);
        $text = preg_replace('/^## (.+)$/m', '<h2>$1</h2>', $text);
        $text = preg_replace('/^# (.+)$/m', '<h1>$1</h1>', $text);
        // Bold and italic
        $text = preg_replace('/\*\*(.+?)\*\*/s', '<strong>$1</strong>', $text);
        $text = preg_replace('/\*(.+?)\*/s', '<em>$1</em>', $text);
        // Paragraphs
        $lines = explode("\n", $text);
        $html = '';
        foreach ($lines as $line) {
            if ($line === '') { continue; }
            if (preg_match('/^<h[1-3]>/', $line)) {
                $html .= $line . "\n";
            } else {
                $html .= '<p>' . $line . '</p>' . "\n";
            }
        }
        return $html;
    }
}

$uri = $_SERVER['REQUEST_URI'] ?? '/';
$path = parse_url($uri, PHP_URL_PATH);
parse_str(parse_url($uri, PHP_URL_QUERY) ?? '', $query);

// Health check endpoint
if ($_SERVER['REQUEST_METHOD'] === 'GET' && $path === '/status') {
    $check = $db->query('SELECT 1');
    if ($check === false) {
        http_response_code(500);
        header('Content-Type: text/plain');
        echo 'error';
    } else {
        header('Content-Type: text/plain');
        echo 'ok';
    }
    return;
}

// Only root path serves notes
if ($path !== '/') {
    http_response_code(404);
    header('Content-Type: text/plain');
    echo 'Not Found';
    return;
}

if (!isset($query['note'])) {
    http_response_code(404);
    header('Content-Type: text/plain');
    echo 'Not Found';
    return;
}

$id = $query['note'];
if (!preg_match('/^[A-Za-z0-9_-]+$/', $id)) {
    http_response_code(400);
    header('Content-Type: text/plain');
    echo 'Invalid note id';
    return;
}

if ($_SERVER['REQUEST_METHOD'] === 'POST') {
    $content = $_POST['content'] ?? '';
    $stmt = $db->prepare('REPLACE INTO notes (id, content) VALUES (:id, :content)');
    $stmt->bindValue(':id', $id, SQLITE3_TEXT);
    $stmt->bindValue(':content', $content, SQLITE3_TEXT);
    $stmt->execute();
    // After saving, show view mode
}

$stmt = $db->prepare('SELECT content FROM notes WHERE id = :id');
$stmt->bindValue(':id', $id, SQLITE3_TEXT);
$result = $stmt->execute();
$row = $result->fetchArray(SQLITE3_ASSOC);
$content = $row['content'] ?? '';

$editing = ($_SERVER['REQUEST_METHOD'] === 'GET' && isset($query['edit']));

?>
<!doctype html>
<html>
<head>
    <meta charset="utf-8">
    <title>Fast Note - <?php echo htmlspecialchars($id, ENT_QUOTES); ?></title>
<?php if ($editing): ?>
    <link rel="stylesheet" href="https://cdn.jsdelivr.net/npm/easymde/dist/easymde.min.css">
<?php endif; ?>
    <style>
        body { margin:0; font-family: sans-serif; padding: 1rem; }
        textarea { width:100%; height:80vh; font-family: monospace; }
        article { max-width: 40em; }
    </style>
</head>
<body>
<?php if ($editing): ?>
    <form method="post" action="?note=<?php echo htmlspecialchars($id, ENT_QUOTES); ?>">
        <textarea id="editor" name="content"><?php echo htmlspecialchars($content, ENT_QUOTES); ?></textarea>
        <p><button type="submit">Save</button> <a href="?note=<?php echo htmlspecialchars($id, ENT_QUOTES); ?>">Cancel</a></p>
    </form>
    <script src="https://cdn.jsdelivr.net/npm/easymde/dist/easymde.min.js"></script>
    <script>new EasyMDE({ element: document.getElementById('editor') });</script>
<?php else: ?>
    <article>
        <?php echo render_markdown($content); ?>
    </article>
    <p><a href="?note=<?php echo htmlspecialchars($id, ENT_QUOTES); ?>&edit=1">Edit</a></p>
<?php endif; ?>
</body>
</html>
