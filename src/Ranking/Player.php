<?php

declare(strict_types=1);

namespace Hillshot\Ranking;

/** Un joueur classé. Immuable : un match produit un nouveau Player (`clone with`). */
final readonly class Player
{
    public function __construct(
        public string $name,
        public string $tokenHash,
        public int $rating = Elo::START,
        public int $played = 0,
        public int $wins = 0,
        public int $losses = 0,
        public int $pointsFor = 0,
        public int $pointsAgainst = 0,
    ) {
    }

    public function afterMatch(int $delta, bool $won, int $pointsFor, int $pointsAgainst): self
    {
        return clone($this, [
            'rating' => max(Elo::FLOOR, $this->rating + $delta),
            'played' => $this->played + 1,
            'wins' => $this->wins + ($won ? 1 : 0),
            'losses' => $this->losses + ($won ? 0 : 1),
            'pointsFor' => $this->pointsFor + $pointsFor,
            'pointsAgainst' => $this->pointsAgainst + $pointsAgainst,
        ]);
    }

    /** @return array<string, int|string> */
    public function toArray(): array
    {
        return [
            'name' => $this->name, 'tokenHash' => $this->tokenHash, 'rating' => $this->rating, 'played' => $this->played,
            'wins' => $this->wins, 'losses' => $this->losses, 'pf' => $this->pointsFor, 'pa' => $this->pointsAgainst,
        ];
    }

    /** @param array<mixed> $row */
    public static function tryFromArray(array $row): ?self
    {
        $ints = ['rating', 'played', 'wins', 'losses', 'pf', 'pa'];
        if (!is_string($row['name'] ?? null) || !is_string($row['tokenHash'] ?? null) || array_any($ints, static fn (string $k): bool => !is_int($row[$k] ?? null))) {
            return null;
        }

        return new self($row['name'], $row['tokenHash'], $row['rating'], $row['played'], $row['wins'], $row['losses'], $row['pf'], $row['pa']);
    }

    /**
     * Vue publique : jamais le hash du jeton.
     *
     * @return array<string, int|string>
     */
    public function toPublicArray(int $rank): array
    {
        return ['rank' => $rank, 'name' => $this->name, 'rating' => $this->rating, 'played' => $this->played, 'wins' => $this->wins, 'losses' => $this->losses];
    }
}
