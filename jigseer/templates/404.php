<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="utf-8">
    <meta name="viewport" content="width=device-width, initial-scale=1">
    <title>Not found &middot; Jigseer</title>
    <link rel="stylesheet" href="https://unpkg.com/sakura.css/css/sakura.css" integrity="sha384-T7n0ANKPOuUMGAfJOyrUo9qeycGQ21MCH2RKDWEUtNdz/BPZt6r9Ga6IpiOb8t6V" crossorigin="anonymous">
</head>
<body>
    <h1>Not found</h1>
    <?php if (!empty($puzzleId)): ?>
        <p>Puzzle <strong><?= htmlspecialchars($puzzleId, ENT_QUOTES) ?></strong> could not be found.</p>
    <?php else: ?>
        <p>The page you were looking for could not be located.</p>
    <?php endif; ?>
    <p><a href="/">Return home</a></p>
</body>
</html>
