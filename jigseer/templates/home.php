<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="utf-8">
    <meta name="viewport" content="width=device-width, initial-scale=1">
    <title>Jigseer</title>
    <link rel="stylesheet" href="/assets/styles/main.css">
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
        <?php if (!empty($_GET['code'])): ?>
            <p>Open <a href="<?= '/p/' . urlencode($_GET['code']) ?>">/p/<?= htmlspecialchars($_GET['code'], ENT_QUOTES) ?></a></p>
        <?php endif; ?>
    </section>
</body>
</html>
