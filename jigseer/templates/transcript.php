<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="utf-8">
    <meta name="viewport" content="width=device-width, initial-scale=1">
    <link rel="icon" href="data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 100 100'%3E%3Ctext y='.9em' font-size='90'%3E🧩%3C/text%3E%3C/svg%3E">
    <title>Transcript &middot; <?= htmlspecialchars($puzzle['name'], ENT_QUOTES) ?></title>
    <link rel="stylesheet" href="https://unpkg.com/sakura.css/css/sakura.css" integrity="sha384-T7n0ANKPOuUMGAfJOyrUo9qeycGQ21MCH2RKDWEUtNdz/BPZt6r9Ga6IpiOb8t6V" crossorigin="anonymous">
    <style>
        .hit { padding: 1rem 0; border-bottom: 1px solid #ddd; }
        .hit:last-child { border-bottom: none; }
        .hit-summary { display: flex; flex-wrap: wrap; align-items: center; gap: 0.5rem; }
        .hit-tooltip { cursor: help; font-size: 0.9em; }
    </style>
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
                <?php
                $tooltipParts = [];
                if (!empty($hit['ip_address'])) {
                    $tooltipParts[] = 'IP address: ' . $hit['ip_address'];
                }
                if (!empty($hit['user_agent'])) {
                    $tooltipParts[] = 'User agent: ' . $hit['user_agent'];
                }
                $tooltip = implode("\n", $tooltipParts);
                ?>
                <article class="hit">
                    <div class="hit-summary">
                        <strong><?= htmlspecialchars($hit['player_name'], ENT_QUOTES) ?></strong>
                        recorded <strong><?= (int) $hit['connection_count'] ?></strong> connection(s)
                        <time datetime="<?= htmlspecialchars($hit['created_at'], ENT_QUOTES) ?>">on <?= htmlspecialchars($hit['created_at'], ENT_QUOTES) ?></time>
                        <?php if ($tooltip !== ''): ?>
                            <span class="hit-tooltip" title="<?= htmlspecialchars($tooltip, ENT_QUOTES) ?>" aria-label="Connection details">ℹ️</span>
                        <?php endif; ?>
                    </div>
                </article>
            <?php endforeach; ?>
        <?php endif; ?>
    </section>

    <?php require __DIR__ . '/partials/live-reload.php'; ?>
</body>
</html>
