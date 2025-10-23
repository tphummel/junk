<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="utf-8">
    <meta name="viewport" content="width=device-width, initial-scale=1">
    <title><?= htmlspecialchars($puzzle['name'], ENT_QUOTES) ?> &middot; Jigseer</title>
    <link rel="stylesheet" href="/assets/styles/main.css">
</head>
<body>
    <h1><?= htmlspecialchars($puzzle['name'], ENT_QUOTES) ?></h1>
    <?php $activeTab = 'play'; require __DIR__ . '/partials/nav.php'; ?>

    <section class="qr-share">
        <h2>Share this puzzle</h2>
        <p>Scan the QR code to open the tracker on your device.</p>
        <img src="<?= htmlspecialchars($qrPath, ENT_QUOTES) ?>" alt="QR code linking to <?= htmlspecialchars($puzzleUrl, ENT_QUOTES) ?>" width="200" height="200" loading="lazy" />
        <p class="qr-url"><code><?= htmlspecialchars($puzzleUrl, ENT_QUOTES) ?></code></p>
    </section>

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
</body>
</html>
