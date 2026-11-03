<?php

declare(strict_types=1);

namespace Hillshot\Game\Handler;

use Hillshot\Game\Client;
use Hillshot\Game\Event;

final readonly class PingHandler implements MessageHandler
{
    #[\Override]
    public function handle(Client $client, array $msg): void
    {
        $client->send(Event::Pong, ['c' => is_int($msg['c'] ?? null) ? $msg['c'] : 0]);
    }
}
