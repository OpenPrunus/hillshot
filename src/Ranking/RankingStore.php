<?php

declare(strict_types=1);

namespace Hillshot\Ranking;

use Arcade\Support\AtomicFile;
use Arcade\Support\Nickname;

/** Dépôt du classement : un fichier JSON (écrit par le serveur de jeu, lu par le site). */
final readonly class RankingStore
{
    public function __construct(private string $file)
    {
    }

    public function load(): Ranking
    {
        $data = AtomicFile::readJson($this->file);
        if (!is_array($data)) {
            return new Ranking();
        }
        $players = [];
        foreach (is_array($data['players'] ?? null) ? $data['players'] : [] as $row) {
            $player = is_array($row) ? Player::tryFromArray($row) : null;
            if ($player !== null) {
                $players[Nickname::key($player->name)] = $player;
            }
        }
        $meetings = [];
        foreach (is_array($data['pairs'] ?? null) ? $data['pairs'] : [] as $key => $times) {
            if (is_string($key) && is_array($times) && array_all($times, static fn (mixed $t): bool => is_int($t))) {
                $meetings[$key] = array_values($times);
            }
        }

        return new Ranking($players, new PairLimiter($meetings));
    }

    public function save(Ranking $ranking): bool
    {
        $json = json_encode([
            'players' => array_map(static fn (Player $p): array => $p->toArray(), array_values($ranking->players)),
            'pairs' => $ranking->pairs->meetings,
        ], JSON_THROW_ON_ERROR);

        return AtomicFile::write($this->file, $json);
    }

    public function file(): string
    {
        return $this->file;
    }
}
