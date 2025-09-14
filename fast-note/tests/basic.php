<?php
$GLOBALS['db'] = new SQLite3(':memory:');
$GLOBALS['db']->exec('CREATE TABLE IF NOT EXISTS notes (id TEXT PRIMARY KEY, content TEXT)');

// First request: save note
$_SERVER['REQUEST_METHOD'] = 'POST';
$_SERVER['REQUEST_URI'] = '/notes/test';
$_POST['content'] = 'hello';
ob_start();
include __DIR__ . '/../index.php';
ob_end_clean();

// Second request: read note back
$_SERVER['REQUEST_METHOD'] = 'GET';
$_SERVER['REQUEST_URI'] = '/notes/test';
$_POST = [];
ob_start();
include __DIR__ . '/../index.php';
$out = ob_get_clean();

if (strpos($out, '<p>hello</p>') === false) {
    throw new Exception('content mismatch');
}

echo "basic test passed\n";
