<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="utf-8">
    <meta name="viewport" content="width=device-width, initial-scale=1">
    <link rel="icon" href="data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 100 100'%3E%3Ctext y='.9em' font-size='90'%3E🧩%3C/text%3E%3C/svg%3E">
    <title>Admin • Jigseer</title>
    <link rel="stylesheet" href="https://unpkg.com/sakura.css/css/sakura.css" integrity="sha384-T7n0ANKPOuUMGAfJOyrUo9qeycGQ21MCH2RKDWEUtNdz/BPZt6r9Ga6IpiOb8t6V" crossorigin="anonymous">
    <style>
        body { max-width: 960px; margin: 0 auto; padding: 1.5rem; }
        h1 { margin-bottom: 0.5rem; }
        .lead { margin-bottom: 2rem; color: #444; }
        .admin-section { margin-bottom: 2.5rem; }
        .admin-section p { margin-bottom: 0.75rem; }
        .admin-table-wrapper { overflow-x: auto; }
        table.admin-table { width: 100%; border-collapse: collapse; }
        table.admin-table th,
        table.admin-table td { padding: 0.65rem 0.75rem; text-align: left; border-bottom: 1px solid #ddd; white-space: nowrap; }
        table.admin-table th { font-size: 0.9rem; text-transform: uppercase; letter-spacing: 0.05em; color: #555; }
        table.admin-table td.number { text-align: right; font-variant-numeric: tabular-nums; }
        table.admin-table td.code { font-family: "SFMono-Regular", Consolas, "Liberation Mono", Menlo, monospace; font-size: 0.95rem; }
        .muted { color: #666; font-size: 0.9rem; }
        @media (max-width: 720px) {
            table.admin-table th,
            table.admin-table td { white-space: normal; }
        }
    </style>
</head>
<body>
    <?php $breadcrumbCurrentLabel = 'Admin'; require __DIR__ . '/partials/breadcrumb.php'; ?>
    <h1>Admin</h1>
    <p class="lead">Read-only overview of puzzles and database status.</p>

    <section class="admin-section">
        <h2>Database</h2>
        <p>
            <a href="<?= htmlspecialchars($databaseDownloadPath ?? '/admin/database', ENT_QUOTES) ?>">Download database</a>
            <?php if (isset($databaseFilename) && $databaseFilename !== ''): ?>
                <span class="muted">(<?= htmlspecialchars($databaseFilename, ENT_QUOTES) ?><?php if (isset($databaseSizeBytes) && $databaseSizeBytes !== null): ?> · <?= number_format((int) $databaseSizeBytes) ?> bytes<?php endif; ?>)</span>
            <?php elseif (isset($databaseSizeBytes) && $databaseSizeBytes !== null): ?>
                <span class="muted">(<?= number_format((int) $databaseSizeBytes) ?> bytes)</span>
            <?php endif; ?>
        </p>
    </section>

    <section class="admin-section">
        <h2>Puzzles</h2>
        <?php if (empty($puzzles)): ?>
            <p class="muted">No puzzles have been created yet.</p>
        <?php else: ?>
            <div class="admin-table-wrapper">
                <table class="admin-table">
                    <thead>
                        <tr>
                            <th scope="col">Short code</th>
                            <th scope="col">Name</th>
                            <th scope="col">Players</th>
                            <th scope="col">Total hits</th>
                            <th scope="col">Created at</th>
                            <th scope="col">Updated at</th>
                        </tr>
                    </thead>
                    <tbody>
                        <?php foreach ($puzzles as $puzzle): ?>
                            <tr>
                                <td class="code" data-label="Short code"><code><?= htmlspecialchars($puzzle['id'], ENT_QUOTES) ?></code></td>
                                <td data-label="Name"><a href="/p/<?= urlencode($puzzle['id']) ?>/play"><?= htmlspecialchars($puzzle['name'], ENT_QUOTES) ?></a></td>
                                <td class="number" data-label="Players"><?= number_format((int) $puzzle['player_count']) ?></td>
                                <td class="number" data-label="Total hits"><?= number_format((int) $puzzle['total_hits']) ?></td>
                                <td data-label="Created at"><?= htmlspecialchars($puzzle['created_at'], ENT_QUOTES) ?></td>
                                <td data-label="Updated at"><?= htmlspecialchars($puzzle['updated_at'], ENT_QUOTES) ?></td>
                            </tr>
                        <?php endforeach; ?>
                    </tbody>
                </table>
            </div>
        <?php endif; ?>
    </section>

    <?php require __DIR__ . '/partials/footer.php'; ?>
</body>
</html>
