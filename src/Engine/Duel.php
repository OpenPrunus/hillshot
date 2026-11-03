<?php

declare(strict_types=1);

namespace Hillshot\Engine;

/** Le match : manches successives, chacun tire à son tour ; la manche s'arrête quand un château est détruit. */
final class Duel
{
    /** @var array{int, int} manches gagnées */
    public private(set) array $score = [0, 0];
    /** @var array{int, int} santé de chaque château */
    public private(set) array $hp = [100, 100];
    public private(set) Side $turn;
    public private(set) Round $round;
    public private(set) int $roundNumber = 1;
    public private(set) ?Side $winner = null;
    private Side $starter;

    public function __construct(public readonly int $target, public readonly Mode $mode, Round $round, Side $first)
    {
        $this->round = $round;
        $this->turn = $first;
        $this->starter = $first;
    }

    /** Le joueur dont c'est le tour tire. */
    public function fire(Shot $shot): Outcome
    {
        $by = $this->turn;
        $trajectory = Ballistics::fly($this->round, $by, $shot);
        $roundOver = false;
        $roundWinner = null;
        if ($trajectory->fate === Fate::Castle && $trajectory->hit !== null) {
            $hp = $this->hp;
            $hp[$trajectory->hit->value] = max(0, $hp[$trajectory->hit->value] - $this->mode->damage());
            $this->hp = $hp;
            if ($hp[$trajectory->hit->value] === 0) {
                $roundOver = true;
                $roundWinner = $trajectory->hit->opposite();
                $score = $this->score;
                $score[$roundWinner->value]++;
                $this->score = $score;
                if ($score[$roundWinner->value] >= $this->target) {
                    $this->winner = $roundWinner;
                }
            }
        }
        if (!$roundOver) {
            $this->turn = $by->opposite();
        }

        return new Outcome($by, $shot, $trajectory, $this->hp, $roundOver, $roundWinner, $this->winner, $this->turn);
    }

    /** Nouvelle manche : châteaux remis à neuf, l'autre camp commence. */
    public function nextRound(Round $round): void
    {
        $this->round = $round;
        $this->hp = [100, 100];
        $this->roundNumber++;
        $this->starter = $this->starter->opposite();
        $this->turn = $this->starter;
    }
}
