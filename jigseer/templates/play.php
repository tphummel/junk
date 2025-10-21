<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="utf-8">
    <meta name="viewport" content="width=device-width, initial-scale=1">
    <title><?= htmlspecialchars($puzzle['name'], ENT_QUOTES) ?> &middot; Jigseer</title>
    <link rel="stylesheet" href="https://unpkg.com/sakura.css/css/sakura.css" integrity="sha384-T7n0ANKPOuUMGAfJOyrUo9qeycGQ21MCH2RKDWEUtNdz/BPZt6r9Ga6IpiOb8t6V" crossorigin="anonymous">
    <style>
        .players { display: grid; grid-template-columns: repeat(auto-fit, minmax(140px, 1fr)); gap: 1rem; }
        .player-card { padding: 1.5rem; border-radius: 0.75rem; background: #f4f4f4; text-align: center; }
        .progress { margin: 1.5rem 0; }
        .banner { background: #fff4d0; padding: 1rem; border-radius: 0.75rem; margin-bottom: 1.5rem; }
        button { width: 100%; padding: 1rem; font-size: 1.1rem; }
    </style>
</head>
<body>
    <h1><?= htmlspecialchars($puzzle['name'], ENT_QUOTES) ?></h1>
    <?php $activeTab = 'play'; require __DIR__ . '/partials/nav.php'; ?>

    <?php if ($progress['total'] === null): ?>
        <div class="banner">
            Set a total puzzle piece count in <a href="<?= '/p/' . urlencode($puzzle['id']) . '/settings' ?>">settings</a> to track completion progress.
        </div>
    <?php endif; ?>

    <section class="progress">
        <h2>Progress</h2>
        <p><strong><?= $progress['completed'] ?></strong> connections logged<?php if ($progress['total'] !== null): ?> of <?= $progress['total'] ?> (<?= number_format($progress['percentage'], 1) ?>%)<?php endif; ?>.</p>
    </section>

    <section>
        <h2>Record a hit</h2>
        <form method="post" action="<?= '/p/' . urlencode($puzzle['id']) . '/hits' ?>">
            <label for="player_name">Player name</label>
            <input id="player_name" name="player_name" type="text" required placeholder="Player name" />

            <label for="connection_count">Connections</label>
            <input id="connection_count" name="connection_count" type="number" value="1" min="1" />

            <button type="submit">Record hit</button>
        </form>
    </section>

    <section>
        <h2>Recent players</h2>
        <div class="players">
            <?php if (empty($leaderboard)): ?>
                <p>No hits yet. Be the first!</p>
            <?php else: ?>
                <?php foreach ($leaderboard as $entry): ?>
                    <div class="player-card">
                        <strong><?= htmlspecialchars($entry['player_name'], ENT_QUOTES) ?></strong>
                        <p><?= (int) $entry['hits'] ?> hits</p>
                    </div>
                <?php endforeach; ?>
            <?php endif; ?>
        </div>
    </section>
</body>
</html>
