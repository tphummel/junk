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
    let toastTimeoutId;

    const ensureToastSupport = () => {
        if (document.getElementById('live-update-toast-style')) {
            return;
        }

        const style = document.createElement('style');
        style.id = 'live-update-toast-style';
        style.textContent = `
            .live-update-toast {
                position: fixed;
                top: 1.5rem;
                left: 50%;
                transform: translate(-50%, -200%);
                background: linear-gradient(90deg, #5c6df4, #9a4ef1);
                color: #fff;
                padding: 0.85rem 1.5rem;
                border-radius: 999px;
                font-weight: 600;
                letter-spacing: 0.02em;
                box-shadow: 0 18px 35px rgba(31, 27, 58, 0.25);
                opacity: 0;
                transition: transform 0.3s ease, opacity 0.3s ease;
                z-index: 9999;
                pointer-events: none;
            }

            .live-update-toast.visible {
                transform: translate(-50%, 0);
                opacity: 1;
            }
        `;
        document.head.appendChild(style);
    };

    const showToast = (message) => {
        ensureToastSupport();
        let toast = document.querySelector('.live-update-toast');
        if (!toast) {
            toast = document.createElement('div');
            toast.className = 'live-update-toast';
            document.body.appendChild(toast);
        }

        toast.textContent = message;
        toast.classList.add('visible');

        if (toastTimeoutId) {
            clearTimeout(toastTimeoutId);
        }

        toastTimeoutId = window.setTimeout(() => {
            toast.classList.remove('visible');
        }, 2000);
    };

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
        showToast('New progress just landed! Updating…');
        window.setTimeout(() => {
            source.close();
            window.location.reload();
        }, 1200);
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
