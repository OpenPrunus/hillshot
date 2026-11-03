<?php

declare(strict_types=1);

namespace Hillshot\Engine;

/** Camp : château de gauche (tire vers la droite) ou de droite (tire vers la gauche). */
enum Side: int
{
    case Left = 0;
    case Right = 1;

    public function opposite(): self
    {
        return match ($this) {
            self::Left => self::Right,
            self::Right => self::Left,
        };
    }

    /** Sens horizontal du tir. */
    public function direction(): int
    {
        return $this === self::Left ? 1 : -1;
    }
}
