<?php

declare(strict_types=1);

require __DIR__ . '/../src/bootstrap.php';

use Jigseer\Http\Request;

$app = jigseer_bootstrap();
$request = Request::fromGlobals();
$response = $app->handle($request);

http_response_code($response->status());
foreach ($response->headers() as $name => $value) {
    header($name . ': ' . $value);
}

$emitter = $response->emitter();
if ($emitter !== null) {
    $emitter();
    return;
}

echo $response->body();
