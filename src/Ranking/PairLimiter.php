<?php

declare(strict_types=1);

namespace Hillshot\Ranking;

use Arcade\Support\Nickname;

/**
 * Anti-collusion : entre les mêmes deux joueurs, les gains d'Elo diminuent à chaque rencontre dans la fenêtre
 * (×1, ×1, ×0,5, ×0,25 puis 0). Immuable : meet() renvoie la rencontre et le nouvel état.
 */
final readonly class PairLimiter
{
    final public const int WINDOW = 86400;
    final public const array FACTORS = [1.0, 1.0, 0.5, 0.25, 0.0];

    /** @param array<string, list<int>> $meetings horodatages des rencontres récentes par couple de pseudos */
    public function __construct(public array $meetings = [])
    {
    }

    public static function pairKey(string $a, string $b): string
    {
        $keys = [Nickname::key($a), Nickname::key($b)];
        sort($keys);

        return implode('|', $keys);
    }

    public function meet(string $a, string $b, int $now): Meeting
    {
        $key = self::pairKey($a, $b);
        $recent = array_values(array_filter($this->meetings[$key] ?? [], static fn (int $t): bool => $now - $t < self::WINDOW));
        $factor = self::FACTORS[min(count($recent), count(self::FACTORS) - 1)];
        $recent[] = $now;
        $meetings = $this->meetings;
        $meetings[$key] = $recent;
        foreach ($meetings as $k => $times) {
            if (array_all($times, static fn (int $t): bool => $now - $t >= self::WINDOW)) {
                unset($meetings[$k]);
            }
        }

        return new Meeting($factor, new self($meetings));
    }
}
