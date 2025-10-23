<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="utf-8">
    <meta name="viewport" content="width=device-width, initial-scale=1">
    <title>Transcript &middot; <?= htmlspecialchars($puzzle['name'], ENT_QUOTES) ?></title>
    <link rel="stylesheet" href="/assets/styles/main.css">
</head>
<body>
    <h1><?= htmlspecialchars($puzzle['name'], ENT_QUOTES) ?></h1>
    <?php $activeTab = 'transcript'; require __DIR__ . '/partials/nav.php'; ?>

    <section>
        <h2>Transcript</h2>
        <?php if (empty($hits)): ?>
            <p>No entries yet.</p>
        <?php else: ?>
            <?php foreach ($hits as $hit): ?>
                <article class="hit">
                    <strong><?= htmlspecialchars($hit['player_name'], ENT_QUOTES) ?></strong>
                    recorded <strong><?= (int) $hit['connection_count'] ?></strong> connection(s)
                    <time datetime="<?= htmlspecialchars($hit['created_at'], ENT_QUOTES) ?>">on <?= htmlspecialchars($hit['created_at'], ENT_QUOTES) ?></time>
                </article>
            <?php endforeach; ?>
        <?php endif; ?>
    </section>
</body>
</html>
