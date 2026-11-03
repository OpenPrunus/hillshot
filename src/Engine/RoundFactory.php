<?php

declare(strict_types=1);

namespace Hillshot\Engine;

use Random\Randomizer;

/** Tire une manche au hasard : plateaux, colline, forteresses et vent. */
final readonly class RoundFactory
{
    public function __construct(private Randomizer $random = new Randomizer())
    {
    }

    public function create(): Round
    {
        $baseY = $this->random->getInt(300, 360);
        $hillH = $this->random->getInt(10, 220);
        $hillX = $this->random->getInt(260, 380);
        $sigma = $this->random->getInt(40, 95);
        $wind = $this->random->getInt(-100, 100) / 100;
        $round = new Round($baseY, $hillH, $hillX, $sigma, [60, 580], $wind);

        return new Round($baseY, $hillH, $hillX, $sigma, [$this->place($round, 50, 150, 60), $this->place($round, 490, 590, 580)], $wind);
    }

    /** Position aléatoire sur le plateau, pas sur la pente de la colline (quelques essais, sinon valeur de repli). */
    private function place(Round $round, int $min, int $max, int $fallback): int
    {
        for ($i = 0; $i < 20; $i++) {
            $x = $this->random->getInt($min, $max);
            if ($round->baseY - $round->groundY((float) $x) < 40) {
                return $x;
            }
        }

        return $fallback;
    }
}
