<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="utf-8">
    <meta name="viewport" content="width=device-width, initial-scale=1">
    <link rel="icon" href="data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 100 100'%3E%3Ctext y='.9em' font-size='90'%3E🧩%3C/text%3E%3C/svg%3E">
    <title>Transcript &middot; <?= htmlspecialchars($puzzle['name'], ENT_QUOTES) ?></title>
    <link rel="stylesheet" href="https://unpkg.com/sakura.css/css/sakura.css" integrity="sha384-T7n0ANKPOuUMGAfJOyrUo9qeycGQ21MCH2RKDWEUtNdz/BPZt6r9Ga6IpiOb8t6V" crossorigin="anonymous">
    <style>
        .transcript-table-wrapper { overflow-x: auto; }
        .transcript-table { width: 100%; border-collapse: collapse; min-width: 100%; }
        .transcript-table th,
        .transcript-table td { padding: 0.5rem 0.75rem; text-align: left; border-bottom: 1px solid #ddd; vertical-align: middle; }
        .transcript-table tbody tr:last-child th,
        .transcript-table tbody tr:last-child td { border-bottom: none; }
        .transcript-table th { font-weight: 600; white-space: nowrap; font-size: 0.95rem; }
        .transcript-table td.time-column time { white-space: nowrap; }
        .transcript-table td.actions-column { width: 1%; }
        .transcript-table td.actions-column form { display: inline; }
        .transcript-delete-button { border: none; background: none; color: #c00; cursor: pointer; font-size: 1rem; line-height: 1; padding: 0; }
        .transcript-delete-button:hover,
        .transcript-delete-button:focus { text-decoration: underline; }
        .transcript-tooltip { cursor: help; font-size: 0.9em; }
        .transcript-duplicate-flag { margin-left: 0.35rem; font-size: 1.1rem; vertical-align: middle; }
        @media (max-width: 640px) {
            .transcript-table { font-size: 0.9rem; }
            .transcript-table th,
            .transcript-table td { padding: 0.4rem 0.5rem; }
        }
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
    $breadcrumbCurrentLabel = 'Transcript';
    require __DIR__ . '/partials/breadcrumb.php';
    ?>
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

            $totalHits = count($hits);
            $playerHitCounts = [];
            $hitsGroupedByPlayer = [];
            foreach ($hits as $hit) {
                $playerNameKey = (string) ($hit['player_name'] ?? '');
                $playerHitCounts[$playerNameKey] = ($playerHitCounts[$playerNameKey] ?? 0) + 1;
                $hitsGroupedByPlayer[$playerNameKey][] = $hit;
            }

            $duplicateCandidateHitIds = [];
            foreach ($hitsGroupedByPlayer as $playerHits) {
                $playerHitsCount = count($playerHits);
                for ($i = 0; $i < $playerHitsCount; $i++) {
                    $hitA = $playerHits[$i];

                    $hitAId = $hitA['id'] ?? null;
                    if (!is_scalar($hitAId)) {
                        continue;
                    }

                    $timeAString = $hitA['created_at'] ?? null;
                    $timeA = is_string($timeAString) && trim($timeAString) !== '' ? strtotime($timeAString) : false;
                    if ($timeA === false) {
                        continue;
                    }

                    for ($j = $i + 1; $j < $playerHitsCount; $j++) {
                        $hitB = $playerHits[$j];

                        $hitBId = $hitB['id'] ?? null;
                        if (!is_scalar($hitBId)) {
                            continue;
                        }

                        $timeBString = $hitB['created_at'] ?? null;
                        $timeB = is_string($timeBString) && trim($timeBString) !== '' ? strtotime($timeBString) : false;
                        if ($timeB === false) {
                            continue;
                        }

                        if (abs($timeA - $timeB) > 10) {
                            continue;
                        }

                        $userAgentDifferent = ($hitA['user_agent'] ?? null) !== ($hitB['user_agent'] ?? null);
                        $ipDifferent = ($hitA['ip_address'] ?? null) !== ($hitB['ip_address'] ?? null);

                        if ($userAgentDifferent || $ipDifferent) {
                            $duplicateCandidateHitIds[(string) $hitAId] = true;
                            $duplicateCandidateHitIds[(string) $hitBId] = true;
                        }
                    }
                }
            }
            ?>
            <div class="transcript-table-wrapper">
                <table class="transcript-table">
                    <thead>
                        <tr>
                            <th scope="col">#</th>
                            <th scope="col">Player hit</th>
                            <th scope="col">Time</th>
                            <th scope="col">Player</th>
                            <th scope="col">IP address</th>
                            <th scope="col" class="actions-column">Actions</th>
                        </tr>
                    </thead>
                    <tbody>
                    <?php foreach ($hits as $index => $hit): ?>
                        <?php
                        $playerName = (string) ($hit['player_name'] ?? '');
                        $playerHitNumber = $playerHitCounts[$playerName] ?? null;
                        if ($playerHitNumber !== null) {
                            $playerHitCounts[$playerName]--;
                        }

                        $overallSequenceNumber = $totalHits - $index;
                        $ipAddress = $hit['ip_address'] ?? null;
                        $userAgent = $hit['user_agent'] ?? null;
                        $ipTitleParts = [];
                        if ($userAgent !== null && $userAgent !== '') {
                            $ipTitleParts[] = 'User agent: ' . $userAgent;
                        }
                        $ipTitle = implode("\n", $ipTitleParts);
                        $hitIdForDisplay = $hit['id'] ?? null;
                        $hitIdString = is_scalar($hitIdForDisplay) ? (string) $hitIdForDisplay : null;
                        $isDuplicateCandidate = $hitIdString !== null && isset($duplicateCandidateHitIds[$hitIdString]);
                        ?>
                        <tr>
                            <td><?= htmlspecialchars((string) $overallSequenceNumber, ENT_QUOTES) ?></td>
                            <td>
                                <?php if ($playerHitNumber !== null): ?>
                                    <?= htmlspecialchars((string) $playerHitNumber, ENT_QUOTES) ?>
                                <?php else: ?>
                                    &mdash;
                                <?php endif; ?>
                            </td>
                            <td class="time-column">
                                <time datetime="<?= htmlspecialchars($hit['created_at'], ENT_QUOTES) ?>" title="<?= htmlspecialchars($hit['created_at'], ENT_QUOTES) ?>">
                                    <?= htmlspecialchars($relativeTime($hit['created_at']), ENT_QUOTES) ?>
                                </time>
                            </td>
                            <td><?= htmlspecialchars($playerName, ENT_QUOTES) ?></td>
                            <td>
                                <?php if ($ipAddress !== null && $ipAddress !== ''): ?>
                                    <span<?php if ($ipTitle !== ''): ?> class="transcript-tooltip" title="<?= htmlspecialchars($ipTitle, ENT_QUOTES) ?>"<?php endif; ?>><?= htmlspecialchars($ipAddress, ENT_QUOTES) ?></span>
                                <?php else: ?>
                                    &mdash;
                                <?php endif; ?>
                            </td>
                            <td class="actions-column">
                                <form method="post" action="/p/<?= rawurlencode($puzzle['id']) ?>/transcript/delete">
                                    <input type="hidden" name="hit_id" value="<?= (int) $hit['id'] ?>">
                                    <button type="submit" class="transcript-delete-button" aria-label="Delete entry">×</button>
                                    <?php if ($isDuplicateCandidate): ?>
                                        <span class="transcript-duplicate-flag" role="img" aria-label="Potential duplicate entry" title="Potential duplicate entry">👯</span>
                                    <?php endif; ?>
                                </form>
                            </td>
                        </tr>
                    <?php endforeach; ?>
                    </tbody>
                </table>
            </div>
        <?php endif; ?>
    </section>

    <?php require __DIR__ . '/partials/footer.php'; ?>
    <?php require __DIR__ . '/partials/live-reload.php'; ?>
</body>
</html>
