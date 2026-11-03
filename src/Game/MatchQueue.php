<?php

declare(strict_types=1);

namespace Hillshot\Game;

/** File d'attente de la « partie rapide » : deux joueurs en attente sont appariés. */
final class MatchQueue
{
    /** @var list<Client> */
    private array $waiting = [];

    public function leave(Client $client): void
    {
        $this->waiting = array_values(array_filter($this->waiting, static fn (Client $c): bool => $c !== $client));
    }

    /** Prend le plus ancien joueur en attente, ou place `$client` dans la file et renvoie null. */
    public function pairOrWait(Client $client): ?Client
    {
        $opponent = array_find($this->waiting, static fn (Client $c): bool => $c !== $client && $c->status === ClientStatus::Queued);
        if ($opponent !== null) {
            $this->leave($opponent);
            $this->leave($client);

            return $opponent;
        }
        if (!in_array($client, $this->waiting, true)) {
            $this->waiting[] = $client;
        }

        return null;
    }
}
