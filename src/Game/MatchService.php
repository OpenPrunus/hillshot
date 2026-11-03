<?php

declare(strict_types=1);

namespace Hillshot\Game;

use Hillshot\Engine\Duel;
use Hillshot\Engine\Outcome;
use Hillshot\Engine\RoundFactory;
use Hillshot\Engine\Rules;
use Hillshot\Engine\Shot;
use Hillshot\Engine\Side;
use Hillshot\Ranking\Participant;
use Hillshot\Ranking\RankedMatch;
use Psr\Clock\ClockInterface;
use Psr\Log\LoggerInterface;
use Random\Randomizer;

/** Cycle de vie des matchs : création, tours de jeu, délais, résultat, forfait et revanche. */
final class MatchService
{
    final public const int PLAYBACK_PAUSE = 2;          // s laissées aux écrans après la fin du vol (explosion, score)
    final public const int MAX_IDLE_TURNS = 2;          // tours laissés expirer de suite avant le forfait

    /** @var list<Room> */
    private array $rooms = [];

    public function __construct(
        private readonly HubConfig $config,
        private readonly Lobby $lobby,
        private readonly MatchQueue $queue,
        private readonly Invitations $invitations,
        private readonly RankingBook $book,
        private readonly ClockInterface $clock,
        private readonly LoggerInterface $logger,
        private readonly Randomizer $randomizer,
        private readonly RoundFactory $rounds,
    ) {
    }

    public function count(): int
    {
        return count($this->rooms);
    }

    /** Lance un match ; le côté de chacun et le premier à tirer sont tirés au hasard. */
    public function start(Client $a, Client $b): Room
    {
        foreach ([$a, $b] as $client) {
            $this->queue->leave($client);
            $this->cancelInvitation($client);
        }
        [$left, $right] = $this->randomizer->getInt(0, 1) === 0 ? [$a, $b] : [$b, $a];
        $ranked = $a->hasToken && $b->hasToken && $a->tokenHash !== $b->tokenHash;
        $room = new Room([$left, $right], $ranked, $this->newDuel());
        $this->open($room);
        $this->logger->info("Match {$left->name} vs {$right->name} (" . ($ranked ? 'ranked' : 'friendly') . ')');

        return $room;
    }

    private function newDuel(): Duel
    {
        return new Duel($this->config->target, $this->config->mode, $this->rounds->create(), Side::from($this->randomizer->getInt(0, 1)));
    }

    private function open(Room $room): void
    {
        $this->rooms[] = $room;
        foreach ([Side::Left, Side::Right] as $side) {
            $player = $room->players[$side->value];
            $opponent = $room->opponentOf($side);
            $player->room = $room;
            $player->status = ClientStatus::Playing;
            $player->send(Event::Match, [
                'side' => $side->value,
                'target' => $room->duel->target,
                'mode' => $room->duel->mode->value,
                'ranked' => $room->ranked,
                'opp' => ['name' => $opponent->name, 'rating' => $this->book->ranking->ratingOf((string) $opponent->name)],
            ]);
        }
        $this->lobby->dirty = true;
        $this->announceRound($room, $this->clock->now()->getTimestamp());
    }

    /** Nouvelle manche : terrain, vent, qui commence et combien de temps il a. */
    private function announceRound(Room $room, int $now): void
    {
        $duel = $room->duel;
        $room->phase = RoomPhase::Aiming;
        $room->deadline = $now + $this->config->aimSeconds;
        $this->broadcast($room, Event::Round, [
            'n' => $duel->roundNumber,
            'round' => $duel->round->toArray(),
            'turn' => $duel->turn->value,
            'hp' => $duel->hp,
            'score' => $duel->score,
            'left' => $this->config->aimSeconds,
        ]);
    }

    /** Un joueur tire : seulement pendant son tour de réglage. */
    public function fire(Client $client, Shot $shot): void
    {
        $room = $client->room;
        $side = $room?->sideOf($client);
        if ($room === null || $side === null || $room->finished) {
            return;
        }
        if ($room->phase !== RoomPhase::Aiming || $room->duel->turn !== $side) {
            $client->error('not_your_turn');

            return;
        }
        $room->idleTurns[$side->value] = 0;
        $this->resolve($room, $shot, $this->clock->now()->getTimestamp());
    }

    /** Fait voler l'obus, annonce le résultat aux deux joueurs et laisse le temps de l'animer. */
    private function resolve(Room $room, Shot $shot, int $now): void
    {
        $outcome = $room->duel->fire($shot);
        $room->lastShots[$outcome->by->value] = $shot;
        $room->outcome = $outcome;
        $room->phase = RoomPhase::Flying;
        $room->resumeAt = $now + (int) ceil(count($outcome->trajectory->path) / Rules::TICKS_PER_SECOND) + self::PLAYBACK_PAUSE;
        $this->broadcast($room, Event::Shot, [
            'by' => $outcome->by->value,
            'a' => $shot->angle,
            'p' => $shot->powder,
            'path' => array_map(static fn (array $pt): array => [round($pt[0], 1), round($pt[1], 1)], $outcome->trajectory->path),
            'fate' => $outcome->trajectory->fate->value,
            'hit' => $outcome->trajectory->hit?->value,
            'hp' => $outcome->hp,
            'over' => $outcome->roundOver,
            'rw' => $outcome->roundWinner?->value,
            'score' => $room->duel->score,
        ]);
    }

    /** Délais : temps de réglage écoulé (tir d'office), fin du vol (tour suivant, manche suivante ou fin du match), fin de la revanche. */
    public function tick(int $now): void
    {
        foreach ($this->rooms as $room) {
            if ($room->finished) {
                if ($now >= $room->closeAt) {
                    $this->close($room);
                }
                continue;
            }
            if ($room->phase === RoomPhase::Aiming && $now >= $room->deadline) {
                $this->timeout($room, $now);
            } elseif ($room->phase === RoomPhase::Flying && $now >= $room->resumeAt) {
                $this->afterFlight($room, $now);
            }
        }
    }

    private function timeout(Room $room, int $now): void
    {
        $side = $room->duel->turn;
        if (++$room->idleTurns[$side->value] >= self::MAX_IDLE_TURNS) {
            $this->finish($room, $side->opposite(), true, $now);

            return;
        }
        $this->resolve($room, $room->lastShots[$side->value], $now);
    }

    private function afterFlight(Room $room, int $now): void
    {
        $outcome = $room->outcome;
        if ($outcome instanceof Outcome && $outcome->matchWinner !== null) {
            $this->finish($room, $outcome->matchWinner, false, $now);
        } elseif ($outcome instanceof Outcome && $outcome->roundOver) {
            $room->duel->nextRound($this->rounds->create());
            $this->announceRound($room, $now);
        } else {
            $room->phase = RoomPhase::Aiming;
            $room->deadline = $now + $this->config->aimSeconds;
            $this->broadcast($room, Event::Turn, ['turn' => $room->duel->turn->value, 'left' => $this->config->aimSeconds]);
        }
    }

    /**
     * @param array<string, mixed> $data
     */
    private function broadcast(Room $room, Event $event, array $data): void
    {
        foreach ($room->players as $player) {
            $player->send($event, $data);
        }
    }

    /** Annonce le résultat et met à jour le classement. `$forfeit` : un joueur est parti ou a laissé le temps filer. */
    private function finish(Room $room, Side $winner, bool $forfeit, int $now): void
    {
        if ($room->finished) {
            return;
        }
        $room->finished = true;
        $room->phase = RoomPhase::Over;
        $room->closeAt = $now + $this->config->rematchTtl;
        $score = $room->duel->score;
        $result = null;
        if ($room->ranked && (!$forfeit || array_sum($score) >= 1)) {
            [$a, $b] = $room->players;
            $result = $this->book->settle(
                new RankedMatch(
                    new Participant((string) $a->name, $a->tokenHash, $score[0]),
                    new Participant((string) $b->name, $b->tokenHash, $score[1]),
                    $winner === Side::Left,
                ),
                $now,
            );
        }
        foreach ([Side::Left, Side::Right] as $side) {
            $room->players[$side->value]->send(Event::Result, [
                'winner' => $winner->value,
                'forfeit' => $forfeit,
                'score' => $score,
                'ranked' => $room->ranked,
                ...($result !== null ? ['delta' => $result->deltas[$side->value], 'rating' => $result->ratings[$side->value]] : []),
            ]);
        }
    }

    /** Un joueur quitte (volontairement ou parce qu'il est déconnecté) : forfait si le match n'était pas fini. */
    public function leave(Client $client, ?int $now = null): void
    {
        $room = $client->room;
        $side = $room?->sideOf($client);
        if ($room === null || $side === null) {
            return;
        }
        $now ??= $this->clock->now()->getTimestamp();
        if (!$room->finished) {
            $this->finish($room, $side->opposite(), true, $now);
        }
        $opponent = $room->opponentOf($side);
        $client->room = null;
        $client->status = $client->isNamed ? ClientStatus::Lobby : ClientStatus::New;
        if ($opponent->room === $room) {
            $opponent->room = null;
            $opponent->status = ClientStatus::Lobby;
            $opponent->send(Event::OpponentLeft);
        }
        $this->remove($room);
    }

    /** Demande de revanche ; quand les deux la demandent, un nouveau match commence avec les mêmes joueurs. */
    public function requestRematch(Client $client): void
    {
        $room = $client->room;
        $side = $room?->sideOf($client);
        if ($room === null || $side === null || !$room->finished) {
            return;
        }
        $room->rematch[$side->value] = true;
        $room->opponentOf($side)->send(Event::RematchAsk);
        if ($room->rematch[0] && $room->rematch[1]) {
            $this->remove($room);
            $this->open(new Room($room->players, $room->ranked, $this->newDuel()));
        }
    }

    /** Fin de la fenêtre de revanche : les deux joueurs retournent au salon. */
    private function close(Room $room): void
    {
        foreach ($room->players as $player) {
            if ($player->room === $room) {
                $player->room = null;
                $player->status = ClientStatus::Lobby;
                $player->send(Event::Left);
            }
        }
        $this->remove($room);
    }

    private function remove(Room $room): void
    {
        $this->rooms = array_values(array_filter($this->rooms, static fn (Room $r): bool => $r !== $room));
        $this->lobby->dirty = true;
    }

    private function cancelInvitation(Client $client): void
    {
        $invitation = $this->invitations->cancel($client);
        if ($invitation !== null) {
            $invitation->other($client)->send(Event::InviteCancel, ['id' => $client->id]);
            $this->lobby->dirty = true;
        }
    }

    /** Pour les tests et le journal : le match est-il en cours ? */
    public function isRunning(Room $room): bool
    {
        return in_array($room, $this->rooms, true) && !$room->finished;
    }
}
