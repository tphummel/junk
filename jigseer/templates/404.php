<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="utf-8">
    <meta name="viewport" content="width=device-width, initial-scale=1">
    <link rel="icon" href="data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 100 100'%3E%3Ctext y='.9em' font-size='90'%3E🧩%3C/text%3E%3C/svg%3E">
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
