<?php

declare(strict_types=1);

namespace Hillshot\Ranking;

/** Calcul Elo : classement de départ, plancher, coefficient K plus fort pour les débutants. */
final class Elo
{
    final public const int START = 1000;
    final public const int FLOOR = 100;
    final public const int NEWCOMER_GAMES = 10;

    public static function kFactor(int $played): int
    {
        return $played < self::NEWCOMER_GAMES ? 40 : 24;
    }

    /** Probabilité de victoire de A contre B. */
    public static function expected(int $ratingA, int $ratingB): float
    {
        return 1 / (1 + 10 ** (($ratingB - $ratingA) / 400));
    }

    /**
     * Variation de classement. `$factor` réduit les gains répétés contre le même adversaire (jamais les pertes) ;
     * le classement ne descend pas sous le plancher.
     */
    public static function delta(int $rating, int $opponent, bool $won, int $played, float $factor = 1.0): int
    {
        $raw = self::kFactor($played) * (($won ? 1 : 0) - self::expected($rating, $opponent));
        $scaled = $raw > 0 ? $raw * $factor : $raw;

        return max(self::FLOOR - $rating, (int) round($scaled));
    }
}
