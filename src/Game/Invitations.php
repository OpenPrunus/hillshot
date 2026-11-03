<?php

declare(strict_types=1);

namespace Hillshot\Game;

/** Défis en attente : au plus un par joueur, que l'on soit celui qui défie ou celui qui est défié. */
final class Invitations
{
    public function __construct(private readonly int $ttl)
    {
    }

    /** @var array<int, Invitation> indexées par identifiant de client (les deux extrémités) */
    private array $pending = [];

    public function create(Client $from, Client $to, int $now): Invitation
    {
        $invitation = new Invitation($from, $to, $now);
        $this->pending[$from->id] = $invitation;
        $this->pending[$to->id] = $invitation;
        $from->invite = $invitation;
        $to->invite = $invitation;

        return $invitation;
    }

    /** Supprime l'invitation de ce client (et de son vis-à-vis) ; la renvoie, ou null s'il n'en avait pas. */
    public function cancel(Client $client): ?Invitation
    {
        $invitation = $this->pending[$client->id] ?? null;
        if ($invitation === null) {
            return null;
        }
        unset($this->pending[$invitation->from->id], $this->pending[$invitation->to->id]);
        $invitation->from->invite = null;
        $invitation->to->invite = null;

        return $invitation;
    }

    /** @return list<Invitation> */
    public function expired(int $now): array
    {
        $expired = [];
        foreach ($this->pending as $invitation) {
            if ($now - $invitation->at > $this->ttl) {
                $expired[$invitation->from->id] = $invitation;
            }
        }

        return array_values($expired);
    }
}
