<?php

declare(strict_types=1);

namespace Hillshot\Game\Handler;

use Hillshot\Game\Client;
use Hillshot\Game\ClientStatus;
use Hillshot\Game\Event;
use Hillshot\Game\Lobby;
use Hillshot\Game\MatchQueue;

final readonly class UnqueueHandler implements MessageHandler
{
    public function __construct(private Lobby $lobby, private MatchQueue $queue)
    {
    }

    #[\Override]
    public function handle(Client $client, array $msg): void
    {
        $this->queue->leave($client);
        if ($client->status === ClientStatus::Queued) {
            $client->status = ClientStatus::Lobby;
            $client->send(Event::Unqueued);
            $this->lobby->dirty = true;
        }
    }
}
