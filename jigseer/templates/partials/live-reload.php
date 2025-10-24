<?php
$eventsPath = '/p/' . rawurlencode($puzzle['id']) . '/events';
$initialEventId = isset($latestHitUpdatedAt) ? trim((string) $latestHitUpdatedAt) : '';
if ($initialEventId !== '') {
    $eventsPath .= '?since=' . rawurlencode($initialEventId);
}
?>
<script>
(() => {
    if (!('EventSource' in window)) {
        return;
    }

    const eventsUrl = <?= json_encode($eventsPath, JSON_HEX_TAG | JSON_HEX_APOS | JSON_HEX_QUOT | JSON_HEX_AMP) ?>;
    let reloaded = false;

    console.log('[live-reload] connecting to', eventsUrl);

    const source = new EventSource(eventsUrl);

    source.addEventListener('open', () => {
        console.log('[live-reload] connection established');
    });

    const triggerReload = () => {
        if (reloaded) {
            return;
        }
        reloaded = true;
        source.close();
        window.location.reload();
    };

    source.addEventListener('hit', (event) => {
        console.log('[live-reload] hit event received', event);
        triggerReload();
    });
    source.onmessage = (event) => {
        console.log('[live-reload] message received', event);
        triggerReload();
    };

    source.addEventListener('error', (event) => {
        console.error('[live-reload] connection error', event);
    });
})();
</script>
