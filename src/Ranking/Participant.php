<?php

declare(strict_types=1);

namespace Hillshot\Ranking;

/** Un joueur d'un match classé : son pseudo, le hash de son jeton navigateur et les points qu'il a marqués. */
final readonly class Participant
{
    public function __construct(public string $name, public string $tokenHash, public int $points)
    {
    }
}
