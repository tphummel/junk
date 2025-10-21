<nav>
    <ul style="display:flex; gap: 0.75rem; list-style: none; padding: 0;">
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
        <li><a href="<?= $href ?>" style="<?= $isActive ? 'font-weight: bold; text-decoration: underline;' : '' ?>"><?= htmlspecialchars($label, ENT_QUOTES) ?></a></li>
        <?php endforeach; ?>
    </ul>
</nav>
