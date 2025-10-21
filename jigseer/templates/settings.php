<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="utf-8">
    <meta name="viewport" content="width=device-width, initial-scale=1">
    <title>Settings &middot; <?= htmlspecialchars($puzzle['name'], ENT_QUOTES) ?></title>
    <link rel="stylesheet" href="https://unpkg.com/sakura.css/css/sakura.css" integrity="sha384-T7n0ANKPOuUMGAfJOyrUo9qeycGQ21MCH2RKDWEUtNdz/BPZt6r9Ga6IpiOb8t6V" crossorigin="anonymous">
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
            <textarea id="notes" name="notes" rows="4" style="width: 100%;"><?= htmlspecialchars((string) ($puzzle['notes'] ?? ''), ENT_QUOTES) ?></textarea>

            <button type="submit">Save settings</button>
        </form>
    </section>
</body>
</html>
