<?php

declare(strict_types=1);

namespace Hillshot\Game\Handler;

use Hillshot\Game\Client;
use Hillshot\Game\ClientStatus;
use Hillshot\Game\Invitations;
use Hillshot\Game\MatchService;

final readonly class AcceptHandler implements MessageHandler
{
    public function __construct(private Invitations $invitations, private MatchService $matches)
    {
    }

    #[\Override]
    public function handle(Client $client, array $msg): void
    {
        $invitation = $client->invite;
        if ($invitation === null || $invitation->to !== $client || $invitation->from->id !== ($msg['id'] ?? null)) {
            $client->error('busy');

            return;
        }
        $this->invitations->cancel($client);
        if ($invitation->from->status !== ClientStatus::Lobby) {
            $client->error('busy');

            return;
        }
        $this->matches->start($invitation->from, $client);
    }
}
