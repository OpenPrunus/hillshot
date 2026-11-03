<?php

declare(strict_types=1);

namespace Hillshot\Game\Handler;

use Hillshot\Engine\Shot;
use Hillshot\Game\Client;
use Hillshot\Game\MatchService;

/** Le tir du joueur dont c'est le tour : angle (`a`) et poudre (`p`), ramenés dans leurs bornes. */
final readonly class FireHandler implements MessageHandler
{
    public function __construct(private MatchService $matches)
    {
    }

    #[\Override]
    public function handle(Client $client, array $msg): void
    {
        $angle = $msg['a'] ?? null;
        $powder = $msg['p'] ?? null;
        if (!is_numeric($angle) || !is_numeric($powder)) {
            $client->error('bad_shot');

            return;
        }
        $this->matches->fire($client, new Shot((int) round((float) $angle), (int) round((float) $powder)));
    }
}
