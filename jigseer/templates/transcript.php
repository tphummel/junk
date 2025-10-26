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
        .hit-summary { display: flex; align-items: center; gap: 0.5rem; }
        .hit-details { flex: 1 1 auto; display: flex; flex-wrap: wrap; align-items: center; gap: 0.5rem; }
        .hit-delete-form { margin-left: 1rem; }
        .hit-delete-button { border: none; background: none; color: #c00; cursor: pointer; font-size: 1rem; line-height: 1; padding: 0; }
        .hit-delete-button:hover, .hit-delete-button:focus { text-decoration: underline; }
        .hit-tooltip { cursor: help; font-size: 0.9em; }
        .app-footer { margin-top: 3rem; text-align: center; color: #777; font-size: 0.85rem; }
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
            <?php
            $now = new \DateTimeImmutable();
            $relativeTime = static function (string $timestamp) use ($now): string {
                try {
                    $date = new \DateTimeImmutable($timestamp);
                } catch (\Exception) {
                    return $timestamp;
                }

                $diffSeconds = $now->getTimestamp() - $date->getTimestamp();
                $absSeconds = abs($diffSeconds);

                if ($absSeconds < 5) {
                    return 'just now';
                }

                $units = [
                    31536000 => 'year',
                    2592000 => 'month',
                    604800 => 'week',
                    86400 => 'day',
                    3600 => 'hour',
                    60 => 'minute',
                    1 => 'second',
                ];

                foreach ($units as $seconds => $label) {
                    if ($absSeconds >= $seconds) {
                        $value = (int) floor($absSeconds / $seconds);
                        $unit = $value === 1 ? $label : $label . 's';

                        if ($diffSeconds >= 0) {
                            return sprintf('%d %s ago', $value, $unit);
                        }

                        return sprintf('in %d %s', $value, $unit);
                    }
                }

                return $timestamp;
            };
            ?>
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
                        <div class="hit-details">
                            <strong><?= htmlspecialchars($hit['player_name'], ENT_QUOTES) ?></strong>
                            recorded <strong><?= (int) $hit['connection_count'] ?></strong> connection(s)
                            <time datetime="<?= htmlspecialchars($hit['created_at'], ENT_QUOTES) ?>" title="<?= htmlspecialchars($hit['created_at'], ENT_QUOTES) ?>">
                                <?= htmlspecialchars($relativeTime($hit['created_at']), ENT_QUOTES) ?>
                            </time>
                            <?php if ($tooltip !== ''): ?>
                                <span class="hit-tooltip" title="<?= htmlspecialchars($tooltip, ENT_QUOTES) ?>" aria-label="Connection details">ℹ️</span>
                            <?php endif; ?>
                        </div>
                        <form method="post" action="/p/<?= rawurlencode($puzzle['id']) ?>/transcript/delete" class="hit-delete-form">
                            <input type="hidden" name="hit_id" value="<?= (int) $hit['id'] ?>">
                            <button type="submit" class="hit-delete-button" aria-label="Delete entry">×</button>
                        </form>
                    </div>
                </article>
            <?php endforeach; ?>
        <?php endif; ?>
    </section>

    <?php require __DIR__ . '/partials/footer.php'; ?>
    <?php require __DIR__ . '/partials/live-reload.php'; ?>
</body>
</html>
