<?php

declare(strict_types=1);

namespace Hillshot\Ranking;

use Countable;
use Arcade\Support\Nickname;

/** Le classement : joueurs et limiteur de couples. Immuable ; record() renvoie un nouveau classement. */
final readonly class Ranking implements Countable
{
    /** @param array<string, Player> $players indexés par Nickname::key() */
    public function __construct(public array $players = [], public PairLimiter $pairs = new PairLimiter())
    {
    }

    #[\Override]
    public function count(): int
    {
        return count($this->players);
    }

    public function find(string $name): ?Player
    {
        return $this->players[Nickname::key($name)] ?? null;
    }

    public function ratingOf(string $name): ?int
    {
        return $this->find($name)?->rating;
    }

    /** Ce pseudo appartient-il déjà à un autre jeton ? */
    public function isReservedByOther(string $name, string $tokenHash): bool
    {
        $player = $this->find($name);

        return $player !== null && $player->tokenHash !== $tokenHash;
    }

    /** Enregistre un match classé (et réserve les pseudos au premier match). Null si un pseudo appartient à un autre jeton. */
    #[\NoDiscard]
    public function record(RankedMatch $match, int $now): ?MatchResult
    {
        $a = $match->a;
        $b = $match->b;
        if ($this->isReservedByOther($a->name, $a->tokenHash) || $this->isReservedByOther($b->name, $b->tokenHash)) {
            return null;
        }
        $pa = $this->find($a->name) ?? new Player($a->name, $a->tokenHash);
        $pb = $this->find($b->name) ?? new Player($b->name, $b->tokenHash);
        $meeting = $this->pairs->meet($a->name, $b->name, $now);
        $da = Elo::delta($pa->rating, $pb->rating, $match->aWon, $pa->played, $meeting->factor);
        $db = Elo::delta($pb->rating, $pa->rating, !$match->aWon, $pb->played, $meeting->factor);
        $na = $pa->afterMatch($da, $match->aWon, $a->points, $b->points);
        $nb = $pb->afterMatch($db, !$match->aWon, $b->points, $a->points);
        $players = $this->players;
        $players[Nickname::key($a->name)] = $na;
        $players[Nickname::key($b->name)] = $nb;

        return new MatchResult(new self($players, $meeting->limiter), [$da, $db], [$na->rating, $nb->rating], $meeting->factor);
    }

    /**
     * Meilleurs joueurs.
     *
     * @return list<Player>
     */
    public function top(int $limit = 20): array
    {
        $players = array_values($this->players);
        usort($players, static fn (Player $x, Player $y): int => [$y->rating, $y->wins, $x->name] <=> [$x->rating, $x->wins, $y->name]);

        return array_slice($players, 0, $limit);
    }
}
