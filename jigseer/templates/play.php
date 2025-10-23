<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="utf-8">
    <meta name="viewport" content="width=device-width, initial-scale=1">
    <link rel="icon" href="data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 100 100'%3E%3Ctext y='.9em' font-size='90'%3E🧩%3C/text%3E%3C/svg%3E">
    <title><?= htmlspecialchars($puzzle['name'], ENT_QUOTES) ?> &middot; Jigseer</title>
    <link rel="stylesheet" href="https://unpkg.com/sakura.css/css/sakura.css" integrity="sha384-T7n0ANKPOuUMGAfJOyrUo9qeycGQ21MCH2RKDWEUtNdz/BPZt6r9Ga6IpiOb8t6V" crossorigin="anonymous">
    <style>
        .players { display: grid; grid-template-columns: repeat(auto-fit, minmax(140px, 1fr)); gap: 1rem; align-items: stretch; }
        .player-card-form { margin: 0; }
        .player-card { display: block; width: 100%; padding: 1.5rem; border-radius: 0.75rem; background: #f4f4f4; text-align: center; border: none; cursor: pointer; transition: transform 0.1s ease, background 0.2s ease; }
        .player-card:hover,
        .player-card:focus-visible { background: #eaeaea; transform: translateY(-2px); }
        .progress { margin: 1.5rem 0; }
        .banner { background: #fff4d0; padding: 1rem; border-radius: 0.75rem; margin-bottom: 1.5rem; }
        .new-player-form { margin-top: 1rem; }
        button { width: 100%; padding: 1rem; font-size: 1.1rem; }
        .qr-share { margin: 1.5rem 0; padding: 1rem; border: 2px dashed #ccc; border-radius: 0.75rem; text-align: center; }
        .qr-share img { display: block; margin: 0.5rem auto; background: #fff; padding: 0.5rem; border-radius: 0.5rem; }
        .qr-share .qr-url { word-break: break-all; font-size: 0.9rem; }
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
        <h2>Players</h2>
        <?php if (!empty($leaderboard)): ?>
            <p>Click a player to record another connection.</p>
        <?php endif; ?>
        <div class="players">
            <?php if (empty($leaderboard)): ?>
                <p>No players yet. Add someone below to get started!</p>
            <?php else: ?>
                <?php foreach ($leaderboard as $entry): ?>
                    <form method="post" action="<?= '/p/' . urlencode($puzzle['id']) . '/hits' ?>" class="player-card-form">
                        <input type="hidden" name="player_name" value="<?= htmlspecialchars($entry['player_name'], ENT_QUOTES) ?>" />
                        <input type="hidden" name="connection_count" value="1" />
                        <button type="submit" class="player-card">
                            <strong><?= htmlspecialchars($entry['player_name'], ENT_QUOTES) ?></strong>
                            <p><?= (int) $entry['hits'] ?> hits</p>
                        </button>
                    </form>
                <?php endforeach; ?>
            <?php endif; ?>
        </div>
    </section>

    <section>
        <h2>Add a new player</h2>
        <form method="post" action="<?= '/p/' . urlencode($puzzle['id']) . '/hits' ?>" class="new-player-form">
            <label for="player_name">Player name</label>
            <input id="player_name" name="player_name" type="text" required placeholder="Player name" />
            <input type="hidden" name="connection_count" value="1" />

            <button type="submit">Add player</button>
        </form>
    </section>

    <section class="qr-share">
        <h2>Share this puzzle</h2>
        <p>Scan the QR code to open the tracker on your device.</p>
        <img src="<?= htmlspecialchars($qrPath, ENT_QUOTES) ?>" alt="QR code linking to <?= htmlspecialchars($puzzleUrl, ENT_QUOTES) ?>" width="200" height="200" loading="lazy" />
        <p class="qr-url"><code><?= htmlspecialchars($puzzleUrl, ENT_QUOTES) ?></code></p>
    </section>
</body>
</html>
