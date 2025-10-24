<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="utf-8">
    <meta name="viewport" content="width=device-width, initial-scale=1">
    <link rel="icon" href="data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 100 100'%3E%3Ctext y='.9em' font-size='90'%3E🧩%3C/text%3E%3C/svg%3E">
    <title>Leaderboard &middot; <?= htmlspecialchars($puzzle['name'], ENT_QUOTES) ?></title>
    <link rel="stylesheet" href="https://unpkg.com/sakura.css/css/sakura.css" integrity="sha384-T7n0ANKPOuUMGAfJOyrUo9qeycGQ21MCH2RKDWEUtNdz/BPZt6r9Ga6IpiOb8t6V" crossorigin="anonymous">
    <style>
        table { width: 100%; border-collapse: collapse; }
        th, td { padding: 0.75rem; border-bottom: 1px solid #ddd; text-align: left; }
        .progress-card { margin: 1.5rem 0 2.5rem; padding: 1.5rem; border-radius: 1rem; background: linear-gradient(145deg, #f3f4ff, #fefefe); box-shadow: 0 10px 25px rgba(0, 0, 0, 0.06); }
        .progress-card h2 { margin-top: 0; margin-bottom: 0.75rem; font-size: 1.6rem; }
        .progress-details { display: flex; flex-wrap: wrap; align-items: center; gap: 1rem; justify-content: space-between; }
        .progress-bar { position: relative; flex: 1 1 220px; height: 16px; border-radius: 999px; background: rgba(0, 0, 0, 0.08); overflow: hidden; }
        .progress-bar-fill { height: 100%; background: linear-gradient(90deg, #5c6df4, #9a4ef1); transition: width 0.3s ease; }
        .progress-bar::after { content: ''; position: absolute; inset: 0; box-shadow: inset 0 0 0 1px rgba(255, 255, 255, 0.4); border-radius: 999px; }
        .progress-summary { margin: 0; font-size: 1rem; color: #333; }
        .progress-summary strong { font-size: 1.2rem; }
        .progress-note { margin-top: 0.75rem; color: #555; font-size: 0.95rem; }
        .app-footer { margin-top: 3rem; text-align: center; color: #777; font-size: 0.85rem; }
        @media (max-width: 600px) {
            .progress-card { padding: 1.25rem; }
            .progress-details { flex-direction: column; align-items: flex-start; }
            .progress-summary { font-size: 0.95rem; }
        }
    </style>
</head>
<body>
    <h1><?= htmlspecialchars($puzzle['name'], ENT_QUOTES) ?></h1>
    <?php $activeTab = 'leaderboard'; require __DIR__ . '/partials/nav.php'; ?>

    <section class="progress-card" aria-label="Collaborative progress">
        <h2>Collaborative progress</h2>
        <div class="progress-details">
            <div class="progress-bar" role="progressbar" aria-valuemin="0" aria-valuemax="<?= $progress['total'] !== null ? (int) $progress['total'] : max((int) $progress['completed'], 1) ?>" aria-valuenow="<?= (int) $progress['completed'] ?>">
                <div class="progress-bar-fill" style="width: <?= sprintf('%.2f', min(max($progress['percentage'], 0), 100)) ?>%;"></div>
            </div>
            <p class="progress-summary">
                <strong><?= (int) $progress['completed'] ?></strong>
                <?php if ($progress['total'] !== null): ?>
                    of <?= (int) $progress['total'] ?> pieces placed
                    (<?= number_format(min(max($progress['percentage'], 0), 100), 1) ?>%)
                <?php else: ?>
                    connections logged so far
                <?php endif; ?>
            </p>
        </div>
        <?php if ($progress['total'] === null): ?>
            <p class="progress-note">Set a total piece count in settings to track completion percentage.</p>
        <?php endif; ?>
    </section>

    <section>
        <h2>Leaderboard</h2>
        <?php if (empty($leaderboard)): ?>
            <p>No hits recorded yet.</p>
        <?php else: ?>
            <table>
                <thead>
                    <tr>
                        <th>Player</th>
                        <th>Hits</th>
                        <th>First hit</th>
                        <th>Most recent</th>
                    </tr>
                </thead>
                <tbody>
                    <?php foreach ($leaderboard as $entry): ?>
                        <tr>
                            <td><?= htmlspecialchars($entry['player_name'], ENT_QUOTES) ?></td>
                            <td><?= (int) $entry['hits'] ?></td>
                            <td><?= htmlspecialchars($entry['first_hit'], ENT_QUOTES) ?></td>
                            <td><?= htmlspecialchars($entry['last_hit'], ENT_QUOTES) ?></td>
                        </tr>
                    <?php endforeach; ?>
                </tbody>
            </table>
        <?php endif; ?>
    </section>

    <?php require __DIR__ . '/partials/footer.php'; ?>
    <?php require __DIR__ . '/partials/live-reload.php'; ?>
</body>
</html>
