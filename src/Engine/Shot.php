<?php

declare(strict_types=1);

namespace Hillshot\Engine;

/** Réglage d'un tir : angle d'élévation (0 à 90°) et charge de poudre (0 à 400 g). Toujours dans les bornes. */
final readonly class Shot
{
    public int $angle;
    public int $powder;

    public function __construct(int $angle, int $powder)
    {
        $this->angle = max(0, min(Rules::MAX_ANGLE, $angle));
        $this->powder = max(0, min(Rules::MAX_POWDER, $powder));
    }
}
