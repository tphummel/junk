<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="utf-8">
    <meta name="viewport" content="width=device-width, initial-scale=1">
    <link rel="icon" href="data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 100 100'%3E%3Ctext y='.9em' font-size='90'%3E🧩%3C/text%3E%3C/svg%3E">
    <title>Story &middot; <?= htmlspecialchars($puzzle['name'], ENT_QUOTES) ?></title>
    <link rel="stylesheet" href="https://unpkg.com/sakura.css/css/sakura.css" integrity="sha384-T7n0ANKPOuUMGAfJOyrUo9qeycGQ21MCH2RKDWEUtNdz/BPZt6r9Ga6IpiOb8t6V" crossorigin="anonymous">
    <style>
        .session-list { margin-top: 1.25rem; border-top: 1px solid rgba(0, 0, 0, 0.08); }
        .session-row { display: flex; gap: 1rem; align-items: flex-start; padding: 1rem 0; border-bottom: 1px solid rgba(0, 0, 0, 0.06); }
        .session-row.current { background: rgba(217, 48, 37, 0.05); }
        .session-summary { margin: 0; font-size: 1rem; flex: 1; }
        .session-status { font-size: 0.9rem; font-weight: 600; white-space: nowrap; }
        .session-status.live { color: #d93025; }
        .session-time-range { font-weight: 600; }
        .empty-state { padding: 1.5rem; border: 2px dashed rgba(0, 0, 0, 0.2); border-radius: 1rem; text-align: center; }
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
    $breadcrumbCurrentLabel = 'Story';
    require __DIR__ . '/partials/breadcrumb.php';
    ?>
    <h1><?= htmlspecialchars($puzzle['name'], ENT_QUOTES) ?></h1>
    <?php $activeTab = 'story'; require __DIR__ . '/partials/nav.php'; ?>

    <section>
        <h2>Story</h2>
        <?php
        $hasSessions = ($currentSession !== null) || !empty($historicalSessions);
        $formatPerPerson = static function (array $session): string {
            if (empty($session['per_person'])) {
                return '';
            }
            $parts = [];
            foreach ($session['per_person'] as $entry) {
                $parts[] = sprintf('%s (%s)', $entry['name'], number_format((int) $entry['count']));
            }

            return implode(', ', $parts);
        };
        $timeRangeFallback = static function (array $session): string {
            try {
                $start = new \DateTimeImmutable($session['start'] ?? '');
            } catch (\Exception) {
                return '—';
            }

            $startLabel = $start->format('H:i');
            $endIso = $session['end'] ?? null;

            if ($endIso === null) {
                return sprintf('%s - %s', $startLabel, $startLabel);
            }

            try {
                $end = new \DateTimeImmutable($endIso);
            } catch (\Exception) {
                return sprintf('%s - %s', $startLabel, $startLabel);
            }

            return sprintf('%s - %s', $startLabel, $end->format('H:i'));
        };
        ?>

        <?php if (!$hasSessions): ?>
            <div class="empty-state">
                <p>No collaborative sessions yet. Once two or more connections land close together, the story timeline will appear here.</p>
            </div>
        <?php endif; ?>

        <?php if ($hasSessions): ?>
            <div class="session-list">
                <?php if ($currentSession !== null): ?>
                    <?php $currentSummary = $formatPerPerson($currentSession); ?>
                    <article class="session-row current">
                        <p class="session-summary">
                            <?= htmlspecialchars($currentSummary, ENT_QUOTES) ?> are connecting pieces -
                            <?= number_format((int) $currentSession['total_connections']) ?> so far over
                            <span class="session-duration" data-duration-live="1" data-duration-start="<?= (int) $currentSession['start_epoch'] ?>">
                                <?= htmlspecialchars($currentSession['duration_label'], ENT_QUOTES) ?>
                            </span>
                            &middot;
                            <span class="session-time-range" data-range-live="1" data-start-iso="<?= htmlspecialchars($currentSession['start'], ENT_QUOTES) ?>" data-end-iso="<?= htmlspecialchars($currentSession['end'] ?? '', ENT_QUOTES) ?>">
                                <?= htmlspecialchars($timeRangeFallback($currentSession), ENT_QUOTES) ?>
                            </span>
                        </p>
                        <span class="session-status live">🔴 LIVE</span>
                    </article>
                <?php endif; ?>

                <?php foreach ($historicalSessions as $session): ?>
                    <?php $summary = $formatPerPerson($session); ?>
                    <article class="session-row">
                        <p class="session-summary">
                            <?= htmlspecialchars($summary, ENT_QUOTES) ?> connected <?= number_format((int) $session['total_connections']) ?> pieces over
                            <span class="session-duration" data-duration-live="0" data-duration-start="<?= (int) $session['start_epoch'] ?>">
                                <?= htmlspecialchars($session['duration_label'], ENT_QUOTES) ?>
                            </span>
                        </p>
                        <span class="session-status session-time-range" data-range-live="0" data-start-iso="<?= htmlspecialchars($session['start'], ENT_QUOTES) ?>" data-end-iso="<?= htmlspecialchars($session['end'] ?? '', ENT_QUOTES) ?>">
                            <?= htmlspecialchars($timeRangeFallback($session), ENT_QUOTES) ?>
                        </span>
                    </article>
                <?php endforeach; ?>
            </div>
        <?php endif; ?>
    </section>

    <?php require __DIR__ . '/partials/footer.php'; ?>
    <?php require __DIR__ . '/partials/live-reload.php'; ?>
    <script>
    (() => {
        const liveDurationElements = document.querySelectorAll('[data-duration-live="1"][data-duration-start]');
        const formatDuration = (seconds) => {
            const parts = [];
            let remaining = Math.max(0, Math.floor(seconds));
            const units = [
                { label: 'd', value: 86400 },
                { label: 'h', value: 3600 },
                { label: 'm', value: 60 },
                { label: 's', value: 1 }
            ];
            for (const unit of units) {
                if (remaining < unit.value) {
                    continue;
                }
                const amount = Math.floor(remaining / unit.value);
                remaining -= amount * unit.value;
                parts.push(`${amount}${unit.label}`);
                if (parts.length === 2) {
                    break;
                }
            }
            if (!parts.length) {
                parts.push('0s');
            }
            return parts.join(' ');
        };

        const updateDurations = () => {
            const nowSeconds = Math.floor(Date.now() / 1000);
            liveDurationElements.forEach((element) => {
                const startValue = Number(element.getAttribute('data-duration-start'));
                if (!Number.isFinite(startValue)) {
                    return;
                }
                const seconds = Math.max(0, nowSeconds - startValue);
                element.textContent = formatDuration(seconds);
            });
        };

        if (liveDurationElements.length) {
            updateDurations();
            window.setInterval(updateDurations, 15 * 1000);
        }

        const timeRangeElements = document.querySelectorAll('.session-time-range[data-start-iso]');
        const hasLiveRange = Array.from(timeRangeElements).some((element) => element.getAttribute('data-range-live') === '1');
        const dateFormatter = new Intl.DateTimeFormat(undefined, { month: 'short', day: 'numeric' });
        const formatClock = (date) => `${String(date.getHours()).padStart(2, '0')}:${String(date.getMinutes()).padStart(2, '0')}`;
        const updateTimeRanges = () => {
            const today = new Date();
            const todayYear = today.getFullYear();
            const todayMonth = today.getMonth();
            const todayDate = today.getDate();

            timeRangeElements.forEach((element) => {
                const startIso = element.getAttribute('data-start-iso');
                if (!startIso) {
                    return;
                }
                const startDate = new Date(startIso);
                if (Number.isNaN(startDate.getTime())) {
                    element.textContent = startIso;
                    return;
                }

                let endDate;
                if (element.getAttribute('data-range-live') === '1') {
                    endDate = new Date();
                } else {
                    const endIso = element.getAttribute('data-end-iso');
                    endDate = endIso ? new Date(endIso) : null;
                    if (!endDate || Number.isNaN(endDate.getTime())) {
                        endDate = startDate;
                    }
                }

                let label = `${formatClock(startDate)} - ${formatClock(endDate)}`;
                const sameDayAsToday =
                    startDate.getFullYear() === todayYear &&
                    startDate.getMonth() === todayMonth &&
                    startDate.getDate() === todayDate;

                if (!sameDayAsToday) {
                    label += ` \u00b7 ${dateFormatter.format(startDate)}`;
                }

                element.textContent = label;
            });
        };

        if (timeRangeElements.length) {
            updateTimeRanges();
            if (hasLiveRange) {
                window.setInterval(updateTimeRanges, 15 * 1000);
            }
        }
    })();
    </script>
</body>
</html>
