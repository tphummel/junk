<?php
/**
 * @var string|null $breadcrumbPuzzleName
 * @var string|null $breadcrumbPuzzleUrl
 * @var string|null $breadcrumbCurrentLabel
 */

$puzzleName = $breadcrumbPuzzleName ?? null;
$puzzleLinkUrl = $breadcrumbPuzzleUrl ?? null;
$currentLabel = $breadcrumbCurrentLabel ?? null;
?>
<nav class="breadcrumb" aria-label="Breadcrumb">
    <a href="/" class="breadcrumb-home" aria-label="Home">🧩</a>
    <?php if ($puzzleName !== null && $puzzleLinkUrl !== null): ?>
        <span class="breadcrumb-separator" aria-hidden="true">&gt;</span>
        <a href="<?= htmlspecialchars($puzzleLinkUrl, ENT_QUOTES) ?>" class="breadcrumb-link">
            <?= htmlspecialchars($puzzleName, ENT_QUOTES) ?>
        </a>
    <?php endif; ?>
    <?php if ($currentLabel !== null): ?>
        <span class="breadcrumb-separator" aria-hidden="true">&gt;</span>
        <span class="breadcrumb-current">
            <?= htmlspecialchars($currentLabel, ENT_QUOTES) ?>
        </span>
    <?php endif; ?>
</nav>
