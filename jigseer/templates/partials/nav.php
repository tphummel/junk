<nav class="tab-nav">
    <ul class="tab-nav__list">
        <?php
        $tabs = [
            'play' => 'Play',
            'leaderboard' => 'Leaderboard',
            'transcript' => 'Transcript',
            'settings' => 'Settings',
        ];
        foreach ($tabs as $key => $label):
            $href = '/p/' . urlencode($puzzle['id']) . '/' . $key;
            $isActive = ($activeTab ?? 'play') === $key;
        ?>
        <li>
            <a class="tab-nav__link<?= $isActive ? ' tab-nav__link--active' : '' ?>" href="<?= $href ?>">
                <?= htmlspecialchars($label, ENT_QUOTES) ?>
            </a>
        </li>
        <?php endforeach; ?>
    </ul>
</nav>
