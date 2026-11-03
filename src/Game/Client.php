<?php

declare(strict_types=1);

namespace Hillshot\Game;

use Arcade\Server\Session;
use Arcade\Server\Transport;

/** Un navigateur connecté : identité, état, partie en cours, invitation en attente et cadence des messages. */
final class Client implements Session
{
    public ?string $name = null;
    public string $tokenHash = '';
    public bool $hasToken = false;
    public ClientStatus $status = ClientStatus::New;
    public ?Room $room = null;
    public ?Invitation $invite = null;

    private int $lastSeen;
    private int $rateSecond = 0;
    private int $rateCount = 0;

    /** Pseudo accepté : le client est visible dans le salon. */
    public bool $isNamed {
        get => $this->name !== null;
    }

    public function __construct(public readonly int $id, private readonly Transport $transport, int $now)
    {
        $this->lastSeen = $now;
    }

    /** @param array<string, mixed> $data */
    public function send(Event $event, array $data = []): void
    {
        $this->transport->send(json_encode(['t' => $event->value, ...$data], JSON_THROW_ON_ERROR));
    }

    public function error(string $code): void
    {
        $this->send(Event::Error, ['code' => $code]);
    }

    /** Compte un message reçu ; faux au-delà de `$limit` messages dans la même seconde. */
    public function allow(int $now, int $limit): bool
    {
        $this->lastSeen = $now;
        if ($now !== $this->rateSecond) {
            $this->rateSecond = $now;
            $this->rateCount = 0;
        }

        return ++$this->rateCount <= $limit;
    }

    #[\Override]
    public function idleFor(int $now): int
    {
        return $now - $this->lastSeen;
    }
}
