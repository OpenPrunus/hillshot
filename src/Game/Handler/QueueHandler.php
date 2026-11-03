<?php

declare(strict_types=1);

namespace Hillshot\Game\Handler;

use Hillshot\Game\Client;
use Hillshot\Game\ClientStatus;
use Hillshot\Game\Event;
use Hillshot\Game\Lobby;
use Hillshot\Game\MatchQueue;
use Hillshot\Game\MatchService;

/** « Partie rapide » : on rejoint la file ; dès qu'un autre joueur attend, le match commence. */
final readonly class QueueHandler implements MessageHandler
{
    public function __construct(private Lobby $lobby, private MatchQueue $queue, private MatchService $matches)
    {
    }

    #[\Override]
    public function handle(Client $client, array $msg): void
    {
        if ($client->status !== ClientStatus::Lobby || $client->invite !== null) {
            $client->error('busy');

            return;
        }
        $client->status = ClientStatus::Queued;
        $opponent = $this->queue->pairOrWait($client);
        if ($opponent !== null) {
            $this->matches->start($opponent, $client);
        } else {
            $client->send(Event::Queued);
        }
        $this->lobby->dirty = true;
    }
}
