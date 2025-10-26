<?php

if (!function_exists('player_color_palette')) {
    /**
     * @return array{base: string, hover: string, strong: string, strong_alpha: string, strong_alpha_hover: string, text: string}
     */
    function player_color_palette(string $name): array
    {
        $normalized = trim($name);
        if (function_exists('mb_strtolower')) {
            $normalized = mb_strtolower($normalized, 'UTF-8');
        } else {
            $normalized = strtolower($normalized);
        }
        if ($normalized === '') {
            $normalized = 'player';
        }

        $hash = crc32($normalized);

        // Use different portions of the hash so that players with close names still
        // receive noticeably different palettes while keeping the values stable.
        $hue = (int) ($hash % 360);
        $hash = intdiv($hash, 360);

        $saturationRange = 30; // results in 55% - 84%
        $saturation = 55 + ($hash % $saturationRange);
        $hash = intdiv($hash, $saturationRange);

        $baseLightnessRange = 12; // results in 78% - 89%
        $baseLightness = 78 + ($hash % $baseLightnessRange);
        $hash = intdiv($hash, $baseLightnessRange);

        $hoverOffset = 7 + ($hash % 5); // 7% - 11%
        $hash = intdiv($hash, 5);
        $strongOffset = 18 + ($hash % 8); // 18% - 25%

        $hoverLightness = max(min($baseLightness - $hoverOffset, 96), 20);
        $strongLightness = max(min($baseLightness - $strongOffset, 85), 15);

        $base = sprintf('hsl(%d, %d%%, %d%%)', $hue, $saturation, $baseLightness);
        $hover = sprintf('hsl(%d, %d%%, %d%%)', $hue, $saturation, $hoverLightness);
        $strong = sprintf('hsl(%d, %d%%, %d%%)', $hue, $saturation, $strongLightness);
        $strongAlpha = sprintf('hsla(%d, %d%%, %d%%, %.2f)', $hue, $saturation, $strongLightness, 0.35);
        $strongAlphaHover = sprintf('hsla(%d, %d%%, %d%%, %.2f)', $hue, $saturation, $strongLightness, 0.50);

        return [
            'base' => $base,
            'hover' => $hover,
            'strong' => $strong,
            'strong_alpha' => $strongAlpha,
            'strong_alpha_hover' => $strongAlphaHover,
            'text' => player_color_text_contrast($hue, $saturation, $baseLightness),
        ];
    }

    function player_color_text_contrast(int $hue, int $saturation, int $lightness): string
    {
        $hue = max(0, min(359, $hue));
        $s = max(0, min(100, $saturation)) / 100;
        $l = max(0, min(100, $lightness)) / 100;

        $c = (1 - abs(2 * $l - 1)) * $s;
        $hPrime = $hue / 60;
        $x = $c * (1 - abs(fmod($hPrime, 2) - 1));
        $m = $l - $c / 2;

        switch ((int) floor($hPrime)) {
            case 0:
                $r1 = $c;
                $g1 = $x;
                $b1 = 0.0;
                break;
            case 1:
                $r1 = $x;
                $g1 = $c;
                $b1 = 0.0;
                break;
            case 2:
                $r1 = 0.0;
                $g1 = $c;
                $b1 = $x;
                break;
            case 3:
                $r1 = 0.0;
                $g1 = $x;
                $b1 = $c;
                break;
            case 4:
                $r1 = $x;
                $g1 = 0.0;
                $b1 = $c;
                break;
            default:
                $r1 = $c;
                $g1 = 0.0;
                $b1 = $x;
                break;
        }

        $r = ($r1 + $m) * 255;
        $g = ($g1 + $m) * 255;
        $b = ($b1 + $m) * 255;

        $luminance = (0.2126 * $r + 0.7152 * $g + 0.0722 * $b) / 255;

        return $luminance > 0.6 ? '#111111' : '#fdfdfd';
    }
}
