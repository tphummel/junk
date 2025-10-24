<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="utf-8">
    <meta name="viewport" content="width=device-width, initial-scale=1">
    <link rel="icon" href="data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 100 100'%3E%3Ctext y='.9em' font-size='90'%3E🧩%3C/text%3E%3C/svg%3E">
    <title>Jigseer</title>
    <link rel="stylesheet" href="https://unpkg.com/sakura.css/css/sakura.css" integrity="sha384-T7n0ANKPOuUMGAfJOyrUo9qeycGQ21MCH2RKDWEUtNdz/BPZt6r9Ga6IpiOb8t6V" crossorigin="anonymous">
    <style>
        body { max-width: 720px; margin: 0 auto; padding: 1.5rem; }
        form { margin-bottom: 2rem; }
        label { display: block; margin-bottom: 0.5rem; }
        input[type="text"], input[type="number"] { width: 100%; padding: 0.75rem; margin-bottom: 1rem; }
        button { width: 100%; padding: 1rem; font-size: 1.1rem; }
        .error { background: #ffe6e6; color: #980000; padding: 1rem; border-radius: 0.5rem; margin-bottom: 1.5rem; }
        .app-footer { margin-top: 3rem; text-align: center; color: #777; font-size: 0.85rem; }
    </style>
</head>
<body>
    <h1>Jigseer</h1>
    <p class="lead">Track connections for collaborative jigsaw puzzles.</p>

    <?php if (!empty($error)): ?>
        <div class="error" role="alert"><?= htmlspecialchars($error, ENT_QUOTES) ?></div>
    <?php endif; ?>

    <section>
        <h2>Create a puzzle</h2>
        <form method="post" action="/puzzles">
            <label for="name">Puzzle name</label>
            <input id="name" name="name" type="text" required placeholder="Rainy day 1000-piece" />

            <label for="total_pieces">Total pieces (optional)</label>
            <input id="total_pieces" name="total_pieces" type="number" min="0" placeholder="1000" />

            <button type="submit">Create puzzle</button>
        </form>
    </section>

    <section>
        <h2>Load an existing puzzle</h2>
        <form method="get" action="">
            <label for="puzzle_id">Puzzle code</label>
            <input id="puzzle_id" name="code" type="text" placeholder="Enter code" />
            <button type="submit">Open puzzle</button>
        </form>
    </section>
    <?php require __DIR__ . '/partials/footer.php'; ?>
</body>
</html>
