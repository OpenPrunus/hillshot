<?php

declare(strict_types=1);

namespace Hillshot\Game;

use Arcade\Server\Transport;
use Arcade\Support\Nickname;

/** Les clients connectés. Sait aussi dire qui est visible dans le salon et si un pseudo est déjà pris. */
final class Lobby implements \Countable
{
    /** Le salon a changé depuis le dernier envoi aux clients. */
    public bool $dirty = false;

    /** @var array<int, Client> */
    private array $clients = [];
    private int $nextId = 1;

    public function create(Transport $transport, int $now): Client
    {
        $client = new Client($this->nextId++, $transport, $now);
        $this->clients[$client->id] = $client;

        return $client;
    }

    public function remove(Client $client): void
    {
        unset($this->clients[$client->id]);
        if ($client->isNamed) {
            $this->dirty = true;
        }
    }

    public function get(int $id): ?Client
    {
        return $this->clients[$id] ?? null;
    }

    /** @return list<Client> */
    public function all(): array
    {
        return array_values($this->clients);
    }

    /** @return list<Client> clients ayant un pseudo */
    public function named(): array
    {
        return array_values(array_filter($this->clients, static fn (Client $c): bool => $c->isNamed));
    }

    #[\Override]
    public function count(): int
    {
        return count($this->clients);
    }

    public function isNameInUse(string $name): bool
    {
        return array_any($this->clients, static fn (Client $c): bool => $c->name !== null && Nickname::key($c->name) === Nickname::key($name));
    }

    /**
     * Les joueurs visibles, avec leur classement.
     *
     * @param callable(string): ?int $ratingOf
     * @return list<array{id: int, name: string, status: string, rating: ?int}>
     */
    public function snapshot(callable $ratingOf): array
    {
        return array_map(
            static fn (Client $c): array => ['id' => $c->id, 'name' => (string) $c->name, 'status' => $c->status->value, 'rating' => $ratingOf((string) $c->name)],
            $this->named(),
        );
    }
}
