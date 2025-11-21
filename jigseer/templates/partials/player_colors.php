<?php

if (!function_exists('player_color_palette')) {
    /**
     * @return array{base: string, hover: string, strong: string, strong_alpha: string, strong_alpha_hover: string, text: string}
     */
    function player_color_palette(int $colorIndex): array
    {
        // High contrast color palette with distinct hues
        $colors = [
            ['hue' => 210, 'saturation' => 70, 'lightness' => 85], // Blue
            ['hue' => 150, 'saturation' => 65, 'lightness' => 83], // Green
            ['hue' => 330, 'saturation' => 75, 'lightness' => 87], // Pink
            ['hue' => 45,  'saturation' => 70, 'lightness' => 82], // Yellow
            ['hue' => 270, 'saturation' => 65, 'lightness' => 85], // Purple
            ['hue' => 25,  'saturation' => 75, 'lightness' => 84], // Orange
            ['hue' => 180, 'saturation' => 70, 'lightness' => 83], // Cyan
            ['hue' => 350, 'saturation' => 70, 'lightness' => 86], // Red
            ['hue' => 120, 'saturation' => 60, 'lightness' => 82], // Lime
            ['hue' => 290, 'saturation' => 70, 'lightness' => 84], // Violet
            ['hue' => 195, 'saturation' => 65, 'lightness' => 85], // Sky Blue
            ['hue' => 160, 'saturation' => 70, 'lightness' => 83], // Teal
        ];

        $color = $colors[$colorIndex % count($colors)];
        $hue = $color['hue'];
        $saturation = $color['saturation'];
        $baseLightness = $color['lightness'];

        $baseLightness = player_adjust_lightness_for_contrast($hue, $saturation, $baseLightness);

        $hoverOffset = 8;
        $strongOffset = 22;

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
        $details = player_color_contrast_details($hue, $saturation, $lightness);

        return $details['color'];
    }

    function player_adjust_lightness_for_contrast(int $hue, int $saturation, int $initialLightness, float $targetRatio = 4.5): int
    {
        $minLightness = 20;
        $maxLightness = 92;
        $lightness = max($minLightness, min($maxLightness, $initialLightness));

        $initialDetails = player_color_contrast_details($hue, $saturation, $lightness);
        if ($initialDetails['ratio'] >= $targetRatio) {
            return $lightness;
        }

        $bestLightness = $lightness;
        $bestRatio = $initialDetails['ratio'];
        $visited = [$lightness => true];

        for ($offset = 1; $offset <= 72; $offset++) {
            $candidates = [
                max($minLightness, $lightness - $offset),
                min($maxLightness, $lightness + $offset),
            ];

            foreach ($candidates as $candidate) {
                if (isset($visited[$candidate])) {
                    continue;
                }

                $visited[$candidate] = true;
                $details = player_color_contrast_details($hue, $saturation, $candidate);

                if ($details['ratio'] >= $targetRatio) {
                    return $candidate;
                }

                if (
                    $details['ratio'] > $bestRatio
                    || (
                        $details['ratio'] === $bestRatio
                        && abs($candidate - $lightness) < abs($bestLightness - $lightness)
                    )
                ) {
                    $bestLightness = $candidate;
                    $bestRatio = $details['ratio'];
                }
            }
        }

        return $bestLightness;
    }

    /**
     * @return array{color: string, ratio: float, luminance: float}
     */
    function player_color_contrast_details(int $hue, int $saturation, int $lightness): array
    {
        $luminance = player_color_relative_luminance_from_hsl($hue, $saturation, $lightness);

        static $textOptions;
        if ($textOptions === null) {
            $textOptions = [
                '#111111' => player_color_relative_luminance_from_hex('#111111'),
                '#fdfdfd' => player_color_relative_luminance_from_hex('#fdfdfd'),
            ];
        }

        $bestColor = '#111111';
        $bestRatio = player_color_contrast_ratio($luminance, $textOptions['#111111']);

        foreach ($textOptions as $color => $textLuminance) {
            $ratio = player_color_contrast_ratio($luminance, $textLuminance);
            if ($ratio > $bestRatio) {
                $bestRatio = $ratio;
                $bestColor = $color;
            }
        }

        return [
            'color' => $bestColor,
            'ratio' => $bestRatio,
            'luminance' => $luminance,
        ];
    }

    function player_color_contrast_ratio(float $lum1, float $lum2): float
    {
        $lighter = max($lum1, $lum2);
        $darker = min($lum1, $lum2);

        return ($lighter + 0.05) / ($darker + 0.05);
    }

    function player_color_relative_luminance_from_hsl(int $hue, int $saturation, int $lightness): float
    {
        [$r, $g, $b] = player_color_hsl_to_rgb($hue, $saturation / 100, $lightness / 100);

        return player_color_relative_luminance_from_rgb($r, $g, $b);
    }

    function player_color_relative_luminance_from_hex(string $hex): float
    {
        $hex = ltrim($hex, '#');

        if (strlen($hex) === 3) {
            $hex = $hex[0] . $hex[0] . $hex[1] . $hex[1] . $hex[2] . $hex[2];
        }

        $r = hexdec(substr($hex, 0, 2));
        $g = hexdec(substr($hex, 2, 2));
        $b = hexdec(substr($hex, 4, 2));

        return player_color_relative_luminance_from_rgb($r, $g, $b);
    }

    function player_color_relative_luminance_from_rgb(float $r, float $g, float $b): float
    {
        $rLinear = player_color_srgb_channel_to_linear($r);
        $gLinear = player_color_srgb_channel_to_linear($g);
        $bLinear = player_color_srgb_channel_to_linear($b);

        return 0.2126 * $rLinear + 0.7152 * $gLinear + 0.0722 * $bLinear;
    }

    function player_color_srgb_channel_to_linear(float $channel): float
    {
        $normalized = max(0.0, min(255.0, $channel)) / 255;

        if ($normalized <= 0.03928) {
            return $normalized / 12.92;
        }

        return pow(($normalized + 0.055) / 1.055, 2.4);
    }

    /**
     * @return array{0: float, 1: float, 2: float}
     */
    function player_color_hsl_to_rgb(int $hue, float $saturation, float $lightness): array
    {
        $hue = ($hue % 360 + 360) % 360;
        $saturation = max(0.0, min(1.0, $saturation));
        $lightness = max(0.0, min(1.0, $lightness));

        $c = (1 - abs(2 * $lightness - 1)) * $saturation;
        $hPrime = $hue / 60;
        $x = $c * (1 - abs(fmod($hPrime, 2) - 1));
        $m = $lightness - $c / 2;

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

        return [$r, $g, $b];
    }
}
