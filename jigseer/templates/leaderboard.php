<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="utf-8">
    <meta name="viewport" content="width=device-width, initial-scale=1">
    <title>Leaderboard &middot; <?= htmlspecialchars($puzzle['name'], ENT_QUOTES) ?></title>
    <link rel="stylesheet" href="/assets/styles/main.css">
</head>
<body>
    <h1><?= htmlspecialchars($puzzle['name'], ENT_QUOTES) ?></h1>
    <?php $activeTab = 'leaderboard'; require __DIR__ . '/partials/nav.php'; ?>

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
</body>
</html>
