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
        .player-card { display: block; width: 100%; padding: 1.5rem; border-radius: 0.75rem; background: var(--player-color, #f4f4f4); color: var(--player-text-color, #111); text-align: center; border: none; cursor: pointer; transition: transform 0.1s ease, background-color 0.2s ease, box-shadow 0.2s ease; box-shadow: 0 0 0 1px var(--player-color-strong, rgba(0, 0, 0, 0.08)); }
        .player-card:hover { background-color: var(--player-color-hover, #eaeaea); transform: translateY(-2px); box-shadow: 0 4px 12px rgba(0, 0, 0, 0.08), 0 0 0 1px var(--player-color-strong, rgba(0, 0, 0, 0.12)); }
        .player-card:focus-visible { background-color: var(--player-color-hover, #eaeaea); transform: translateY(-2px); outline: 3px solid var(--player-color-strong, rgba(92, 109, 244, 0.45)); outline-offset: 2px; box-shadow: 0 4px 12px rgba(0, 0, 0, 0.08), 0 0 0 1px var(--player-color-strong, rgba(0, 0, 0, 0.12)); }
        .player-card strong { display: block; font-size: 1.05rem; margin-bottom: 0.4rem; }
        .player-card .player-count { margin: 0; font-size: 1.85rem; font-weight: 700; letter-spacing: -0.02em; }
        .new-player-form { margin-top: 1rem; }
        button { width: 100%; padding: 1rem; font-size: 1.1rem; }
        .qr-share { margin: 1.5rem 0; padding: 1rem; border: 2px dashed #ccc; border-radius: 0.75rem; text-align: center; }
        .qr-share img { display: block; margin: 0.5rem auto; background: #fff; padding: 0.5rem; border-radius: 0.5rem; }
        .qr-share .qr-url { word-break: break-all; font-size: 0.9rem; }
        .app-footer { margin-top: 3rem; text-align: center; color: #777; font-size: 0.85rem; }
    </style>
</head>
<body>
    <h1><?= htmlspecialchars($puzzle['name'], ENT_QUOTES) ?></h1>
    <?php $activeTab = 'play'; require __DIR__ . '/partials/nav.php'; ?>
    <?php require_once __DIR__ . '/partials/player_colors.php'; ?>

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
                    <?php
                    $palette = player_color_palette((string) $entry['player_name']);
                    $playerStyle = sprintf(
                        '--player-color:%s;--player-color-hover:%s;--player-color-strong:%s;--player-color-strong-alpha:%s;--player-color-strong-alpha-hover:%s;--player-text-color:%s;',
                        $palette['base'],
                        $palette['hover'],
                        $palette['strong'],
                        $palette['strong_alpha'],
                        $palette['strong_alpha_hover'],
                        $palette['text']
                    );
                    ?>
                    <form method="post" action="<?= '/p/' . urlencode($puzzle['id']) . '/hits' ?>" class="player-card-form">
                        <input type="hidden" name="player_name" value="<?= htmlspecialchars($entry['player_name'], ENT_QUOTES) ?>" />
                        <input type="hidden" name="connection_count" value="1" />
                        <button type="submit" class="player-card" style="<?= htmlspecialchars($playerStyle, ENT_QUOTES) ?>">
                            <strong><?= htmlspecialchars($entry['player_name'], ENT_QUOTES) ?></strong>
                            <p class="player-count"><?= number_format((int) $entry['hits']) ?></p>
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

    <?php require __DIR__ . '/partials/footer.php'; ?>
    <?php require __DIR__ . '/partials/live-reload.php'; ?>
</body>
</html>
