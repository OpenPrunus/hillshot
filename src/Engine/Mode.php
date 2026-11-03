<?php

declare(strict_types=1);

namespace Hillshot\Engine;

/** Règle de destruction : un impact détruit le château (v2.0.1) ou il encaisse des dégâts partiels (v2.0.9ß). */
enum Mode: string
{
    case Classic = 'classic';
    case Health = 'health';

    public function damage(): int
    {
        return match ($this) {
            self::Classic => Rules::DAMAGE_CLASSIC,
            self::Health => Rules::DAMAGE_HEALTH,
        };
    }
}
