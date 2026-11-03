<?php

declare(strict_types=1);

namespace Hillshot\Engine;

/** Résultat d'un tir : vol de l'obus, santé des châteaux, fin éventuelle de la manche et du match. */
final readonly class Outcome
{
    /** @param array{int, int} $hp santé (0 à 100) de chaque château après le tir */
    public function __construct(
        public Side $by,
        public Shot $shot,
        public Trajectory $trajectory,
        public array $hp,
        public bool $roundOver,
        public ?Side $roundWinner,
        public ?Side $matchWinner,
        public Side $next,
    ) {
    }
}
