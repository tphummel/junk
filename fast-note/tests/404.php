<?php
$cmd = 'FASTNOTE_DB=:memory: REQUEST_METHOD=GET REQUEST_URI=/unknown php ' . escapeshellarg(__DIR__ . '/../index.php');
$out = shell_exec($cmd);
if (trim($out) !== 'Not Found') {
    throw new Exception('expected 404 for unknown path');
}
echo "404 test passed\n";
