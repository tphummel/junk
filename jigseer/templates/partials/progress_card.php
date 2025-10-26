<?php
declare(strict_types=1);

/** @var array{completed:int, total:int|null, percentage:float} $progress */
?>
<section class="progress-card" aria-label="Collaborative progress">
    <div class="progress-details">
        <div
            class="progress-bar"
            role="progressbar"
            aria-valuemin="0"
            aria-valuemax="<?= $progress['total'] !== null ? (int) $progress['total'] : max((int) $progress['completed'], 1) ?>"
            aria-valuenow="<?= (int) $progress['completed'] ?>"
        >
            <div class="progress-bar-fill" style="width: <?= sprintf('%.2f', min(max($progress['percentage'], 0), 100)) ?>%;"></div>
        </div>
        <p class="progress-summary">
            <strong><?= (int) $progress['completed'] ?></strong>
            <?php if ($progress['total'] !== null): ?>
                of <?= (int) $progress['total'] ?>
                (<?= number_format(min(max($progress['percentage'], 0), 100), 1) ?>%)
            <?php else: ?>
                connections logged so far
            <?php endif; ?>
        </p>
    </div>
    <?php if ($progress['total'] === null): ?>
        <p class="progress-note">Set a total piece count in settings to track completion percentage.</p>
    <?php endif; ?>
</section>
