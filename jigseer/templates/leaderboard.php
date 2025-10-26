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
        <?php require __DIR__ . '/partials/progress_styles.php'; ?>
        .leaderboard-table { border-radius: 0.75rem; overflow: hidden; }
        .leaderboard-table thead th { background-color: rgba(255, 255, 255, 0.65); font-weight: 700; }
        .leaderboard-table tbody tr { transition: background-color 0.3s ease; background-color: var(--player-color, transparent); color: var(--player-text-color, inherit); }
        .leaderboard-table tbody tr td { color: inherit; }
        .leaderboard-table tbody tr:hover { background-color: var(--player-color-hover, rgba(0, 0, 0, 0.04)); }
        .leaderboard-table tbody tr:last-child td { border-bottom: none; }
        .leaderboard-table .numeric { text-align: right; white-space: nowrap; }
        .timestamp time { display: block; font-weight: 600; }
        .timestamp .relative-time { display: block; margin-top: 0.25rem; }
        .relative-time { font-size: 0.85rem; color: #555; }
        .app-footer { margin-top: 3rem; text-align: center; color: #777; font-size: 0.85rem; }
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
    $breadcrumbCurrentLabel = 'Leaderboard';
    require __DIR__ . '/partials/breadcrumb.php';
    ?>
    <h1><?= htmlspecialchars($puzzle['name'], ENT_QUOTES) ?></h1>
    <?php $activeTab = 'leaderboard'; require __DIR__ . '/partials/nav.php'; ?>
    <?php require_once __DIR__ . '/partials/player_colors.php'; ?>

    <?php require __DIR__ . '/partials/progress_card.php'; ?>

    <section>
        <h2>Leaderboard</h2>
        <?php if (empty($leaderboard)): ?>
            <p>No hits recorded yet.</p>
        <?php else: ?>
            <?php $totalHits = array_sum(array_map(static fn (array $entry): int => (int) $entry['hits'], $leaderboard)); ?>
            <table class="leaderboard-table">
                <thead>
                    <tr>
                        <th>Player</th>
                        <th class="numeric">Hits</th>
                        <th class="numeric">Share of total</th>
                        <th class="numeric">Active time</th>
                        <th>Most Recent</th>
                        <th class="numeric">Last 100 hits</th>
                    </tr>
                </thead>
                <tbody>
                    <?php foreach ($leaderboard as $entry): ?>
                        <?php
                        $hits = (int) $entry['hits'];
                        $shareRatio = $totalHits > 0 ? max(min($hits / $totalHits, 1), 0) : 0;
                        $sharePercentage = $totalHits > 0 ? $shareRatio * 100 : null;
                        $lastHitIso = trim((string) $entry['last_hit']);
                        $recentHits = (int) ($entry['recent_hits'] ?? 0);
                        $palette = player_color_palette((string) $entry['player_name']);
                        $rowStyle = sprintf(
                            '--player-color:%s;--player-color-hover:%s;--player-text-color:%s;',
                            $palette['base'],
                            $palette['hover'],
                            $palette['text']
                        );
                        ?>
                        <tr style="<?= htmlspecialchars($rowStyle, ENT_QUOTES) ?>">
                            <td><?= htmlspecialchars($entry['player_name'], ENT_QUOTES) ?></td>
                            <td class="numeric"><?= number_format($hits) ?></td>
                            <td class="numeric">
                                <?php if ($sharePercentage !== null): ?>
                                    <?= number_format($sharePercentage, $sharePercentage < 1 ? 2 : 1) ?>%
                                <?php else: ?>
                                    &mdash;
                                <?php endif; ?>
                            </td>
                            <td class="numeric"><?= htmlspecialchars($entry['active_duration'] ?? '0s', ENT_QUOTES) ?></td>
                            <td class="timestamp">
                                <time class="local-time" datetime="<?= htmlspecialchars($lastHitIso, ENT_QUOTES) ?>" data-iso="<?= htmlspecialchars($lastHitIso, ENT_QUOTES) ?>">
                                    <?= htmlspecialchars($lastHitIso, ENT_QUOTES) ?>
                                </time>
                                <span class="relative-time" data-iso="<?= htmlspecialchars($lastHitIso, ENT_QUOTES) ?>"></span>
                            </td>
                            <td class="numeric"><?= number_format($recentHits) ?></td>
                        </tr>
                    <?php endforeach; ?>
                </tbody>
            </table>
        <?php endif; ?>
    </section>

    <?php require __DIR__ . '/partials/footer.php'; ?>
    <?php require __DIR__ . '/partials/live-reload.php'; ?>
    <script>
    (() => {
        const timeElements = document.querySelectorAll('time.local-time[data-iso]');
        const relativeElements = document.querySelectorAll('.relative-time[data-iso]');
        if (!timeElements.length && !relativeElements.length) {
            return;
        }

        const dateTimeFormatter = new Intl.DateTimeFormat(undefined, {
            dateStyle: 'medium',
            timeStyle: 'short'
        });
        const relativeFormatter = new Intl.RelativeTimeFormat(undefined, { numeric: 'auto' });
        const divisions = [
            { amount: 60, unit: 'second' },
            { amount: 60, unit: 'minute' },
            { amount: 24, unit: 'hour' },
            { amount: 7, unit: 'day' },
            { amount: 4.34524, unit: 'week' },
            { amount: 12, unit: 'month' },
            { amount: Number.POSITIVE_INFINITY, unit: 'year' }
        ];

        const parseIso = (iso) => {
            const date = iso ? new Date(iso) : null;
            return Number.isNaN(date?.getTime() ?? NaN) ? null : date;
        };

        const formatRelative = (date) => {
            if (!date) {
                return '';
            }
            let duration = (date.getTime() - Date.now()) / 1000;
            let unit = 'second';
            for (const division of divisions) {
                if (Math.abs(duration) < division.amount) {
                    unit = division.unit;
                    break;
                }
                duration /= division.amount;
                unit = division.unit;
            }
            return relativeFormatter.format(Math.round(duration), unit);
        };

        const updateTimes = () => {
            timeElements.forEach((element) => {
                const iso = element.getAttribute('data-iso');
                const date = parseIso(iso);
                if (date) {
                    element.textContent = dateTimeFormatter.format(date);
                    element.setAttribute('title', iso ?? '');
                } else {
                    element.textContent = iso ?? '';
                    element.removeAttribute('title');
                }
            });

            relativeElements.forEach((element) => {
                const iso = element.getAttribute('data-iso');
                const date = parseIso(iso);
                const relative = date ? formatRelative(date) : '';
                element.textContent = relative ? `Updated ${relative}` : '';
                if (relative) {
                    element.setAttribute('title', iso ?? '');
                } else {
                    element.removeAttribute('title');
                }
            });
        };

        updateTimes();
        window.setInterval(updateTimes, 60 * 1000);
    })();
    </script>
</body>
</html>
