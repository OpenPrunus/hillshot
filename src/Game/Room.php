<?php

declare(strict_types=1);

namespace Hillshot\Game;

use Hillshot\Engine\Duel;
use Hillshot\Engine\Outcome;
use Hillshot\Engine\Shot;
use Hillshot\Engine\Side;

/** Un match en cours entre deux clients : le duel (moteur), la phase, les délais, le résultat et la revanche. */
final class Room
{
    public RoomPhase $phase = RoomPhase::Aiming;
    /** Fin du temps de réglage du joueur dont c'est le tour (horodatage). */
    public int $deadline = 0;
    /** Fin de l'animation de l'obus en vol (horodatage) : on passe alors à la suite. */
    public int $resumeAt = 0;
    public ?Outcome $outcome = null;
    /** @var array{Shot, Shot} dernier réglage de chacun : tiré d'office si le temps est écoulé */
    public array $lastShots;
    /** @var array{int, int} tours consécutifs laissés expirer */
    public array $idleTurns = [0, 0];
    /** Pourquoi la partie n'est pas classée alors que les deux joueurs avaient un jeton (same_ip, too_many_accounts, pair_limit). */
    public ?string $why = null;
    /** Le résultat a été communiqué aux joueurs. */
    public bool $finished = false;
    /** Fin de la fenêtre de revanche (horodatage), une fois le résultat connu. */
    public int $closeAt = 0;
    /** @var array{bool, bool} */
    public array $rematch = [false, false];

    /** @param array{Client, Client} $players joueur de gauche, joueur de droite */
    public function __construct(public readonly array $players, public readonly bool $ranked, public readonly Duel $duel)
    {
        $this->lastShots = [new Shot(45, 200), new Shot(45, 200)];
    }

    public function sideOf(Client $client): ?Side
    {
        return match ($client) {
            $this->players[0] => Side::Left,
            $this->players[1] => Side::Right,
            default => null,
        };
    }

    public function opponentOf(Side $side): Client
    {
        return $this->players[$side->opposite()->value];
    }
}
