<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="utf-8">
    <meta name="viewport" content="width=device-width, initial-scale=1">
    <title>Settings &middot; <?= htmlspecialchars($puzzle['name'], ENT_QUOTES) ?></title>
    <link rel="stylesheet" href="/assets/styles/main.css">
</head>
<body>
    <h1><?= htmlspecialchars($puzzle['name'], ENT_QUOTES) ?></h1>
    <?php $activeTab = 'settings'; require __DIR__ . '/partials/nav.php'; ?>

    <section>
        <h2>General</h2>
        <form method="post" action="<?= '/p/' . urlencode($puzzle['id']) . '/settings' ?>">
            <label for="total_pieces">Total puzzle pieces</label>
            <input id="total_pieces" name="total_pieces" type="number" min="0" value="<?= htmlspecialchars((string) ($puzzle['total_pieces'] ?? ''), ENT_QUOTES) ?>" />

            <label for="notes">Notes</label>
            <textarea id="notes" name="notes" rows="4"><?= htmlspecialchars((string) ($puzzle['notes'] ?? ''), ENT_QUOTES) ?></textarea>

            <button type="submit">Save settings</button>
        </form>
    </section>

    <section>
        <h2>Export data</h2>
        <p>Download the puzzle details and all recorded hits as CSV files in a ZIP archive.</p>
        <form method="get" action="<?= '/p/' . urlencode($puzzle['id']) . '/settings/export' ?>">
            <button type="submit">Download export</button>
        </form>
    </section>
</body>
</html>
