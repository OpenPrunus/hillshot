<?php

declare(strict_types=1);

namespace Hillshot\Ranking;

/** Résultat de l'enregistrement d'un match classé : le nouveau classement et, pour A puis B, la variation et le classement. */
final readonly class MatchResult
{
    /**
     * @param array{int, int} $deltas
     * @param array{int, int} $ratings
     */
    public function __construct(public Ranking $ranking, public array $deltas, public array $ratings, public float $factor)
    {
    }
}
