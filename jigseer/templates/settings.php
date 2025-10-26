<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="utf-8">
    <meta name="viewport" content="width=device-width, initial-scale=1">
    <link rel="icon" href="data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 100 100'%3E%3Ctext y='.9em' font-size='90'%3E🧩%3C/text%3E%3C/svg%3E">
    <title>Settings &middot; <?= htmlspecialchars($puzzle['name'], ENT_QUOTES) ?></title>
    <link rel="stylesheet" href="https://unpkg.com/sakura.css/css/sakura.css" integrity="sha384-T7n0ANKPOuUMGAfJOyrUo9qeycGQ21MCH2RKDWEUtNdz/BPZt6r9Ga6IpiOb8t6V" crossorigin="anonymous">
    <style>
        .qr-share { margin: 2rem 0 0; padding: 1rem; border: 2px dashed #ccc; border-radius: 0.75rem; text-align: center; }
        .qr-share img { display: block; margin: 0.5rem auto; background: #fff; padding: 0.5rem; border-radius: 0.5rem; }
        .qr-share .qr-url { word-break: break-all; font-size: 0.9rem; }
        .app-footer { margin-top: 3rem; text-align: center; color: #777; font-size: 0.85rem; }
        .danger-divider { margin: 3rem 0 1.5rem; border: none; height: 4px; background: linear-gradient(90deg, #b00020, #ff6b6b); }
        .danger-zone { padding: 1.5rem; border: 2px solid #b00020; border-radius: 0.75rem; background: #fff5f5; }
        .danger-zone h2 { margin-top: 0; color: #8c0015; }
        .danger-zone p { margin-top: 0.5rem; }
        .danger-zone label { font-weight: bold; display: block; margin-top: 1rem; }
        .danger-button { background-color: #b00020; border-color: #b00020; }
        .danger-button:hover, .danger-button:focus { background-color: #8c0015; border-color: #8c0015; }
        .danger-error { color: #8c0015; font-weight: bold; }
        .breadcrumb { display: flex; align-items: center; gap: 0.5rem; margin-bottom: 1.5rem; font-size: 0.95rem; }
        .breadcrumb a { color: inherit; text-decoration: none; display: inline-flex; align-items: center; gap: 0.25rem; }
        .breadcrumb a:hover, .breadcrumb a:focus { text-decoration: underline; }
        .breadcrumb .breadcrumb-home { font-size: 1.25rem; line-height: 1; }
        .breadcrumb .breadcrumb-separator { color: #888; }
        .breadcrumb .breadcrumb-current { font-weight: 600; }
    </style>
</head>
<body>
    <?php
    $breadcrumbPuzzleName = $puzzle['name'];
    $breadcrumbPuzzleUrl = '/p/' . urlencode($puzzle['id']);
    $breadcrumbCurrentLabel = 'Settings';
    require __DIR__ . '/partials/breadcrumb.php';
    ?>
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

    <hr class="danger-divider" />

    <section class="danger-zone">
        <h2>Delete puzzle</h2>
        <?php if (!empty($deleteError)): ?>
            <p class="danger-error"><?= htmlspecialchars($deleteError, ENT_QUOTES) ?></p>
        <?php endif; ?>
        <p>Deleting this puzzle will permanently remove the puzzle details and all recorded hits. This action cannot be undone.</p>
        <form method="post" action="<?= '/p/' . urlencode($puzzle['id']) . '/settings/delete' ?>">
            <label for="delete_confirmation">Type <code>delete</code> to confirm</label>
            <input id="delete_confirmation" name="delete_confirmation" type="text" autocomplete="off" autocapitalize="none" autocorrect="off" spellcheck="false" />
            <button type="submit" class="danger-button">Delete this puzzle</button>
        </form>
    </section>

    <?php require __DIR__ . '/partials/footer.php'; ?>
</body>
</html>
