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

    const source = new EventSource(eventsUrl);

    const triggerReload = () => {
        if (reloaded) {
            return;
        }
        reloaded = true;
        source.close();
        window.location.reload();
    };

    source.addEventListener('hit', triggerReload);
    source.onmessage = triggerReload;
})();
</script>
