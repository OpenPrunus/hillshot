<?php

declare(strict_types=1);

namespace Hillshot\Api;

use Hillshot\Ranking\RankingStore;

/** Le classement public (meilleurs joueurs), lu dans le fichier écrit par le serveur de jeu. */
final readonly class Board
{
    final public const int LIMIT = 20;

    public function __construct(private RankingStore $store)
    {
    }

    /** @return list<array<string, int|string>> */
    public function top(): array
    {
        $rows = [];
        foreach ($this->store->load()->top(self::LIMIT) as $index => $player) {
            $rows[] = $player->toPublicArray($index + 1);
        }

        return $rows;
    }
}
