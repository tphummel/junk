<?php
$cmd = 'FASTNOTE_DB=:memory: REQUEST_METHOD=GET REQUEST_URI=/status php ' . escapeshellarg(__DIR__ . '/../index.php');
$out = shell_exec($cmd);

if (trim($out) !== 'ok') {
    throw new Exception('status not ok');
}

echo "status test passed\n";
