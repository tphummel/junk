<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="utf-8">
    <meta name="viewport" content="width=device-width, initial-scale=1">
    <title>Settings &middot; <?= htmlspecialchars($puzzle['name'], ENT_QUOTES) ?></title>
    <link rel="stylesheet" href="https://unpkg.com/sakura.css/css/sakura.css" integrity="sha384-T7n0ANKPOuUMGAfJOyrUo9qeycGQ21MCH2RKDWEUtNdz/BPZt6r9Ga6IpiOb8t6V" crossorigin="anonymous">
    <style>
        .qr-share { margin: 2rem 0 0; padding: 1rem; border: 2px dashed #ccc; border-radius: 0.75rem; text-align: center; }
        .qr-share img { display: block; margin: 0.5rem auto; background: #fff; padding: 0.5rem; border-radius: 0.5rem; }
        .qr-share .qr-url { word-break: break-all; font-size: 0.9rem; }
    </style>
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

    <section>
        <h2>Export data</h2>
        <p>Download the puzzle details and all recorded hits as CSV files in a ZIP archive.</p>
        <form method="get" action="<?= '/p/' . urlencode($puzzle['id']) . '/settings/export' ?>">
            <button type="submit">Download export</button>
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
