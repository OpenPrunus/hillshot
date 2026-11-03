<?php

declare(strict_types=1);

namespace Hillshot\Game\Handler;

use Hillshot\Game\Client;
use Hillshot\Game\Event;
use Hillshot\Game\Invitations;
use Hillshot\Game\Lobby;

/** Le joueur qui a lancé un défi le retire. */
final readonly class CancelHandler implements MessageHandler
{
    public function __construct(private Lobby $lobby, private Invitations $invitations)
    {
    }

    #[\Override]
    public function handle(Client $client, array $msg): void
    {
        $invitation = $client->invite;
        if ($invitation === null || $invitation->from !== $client) {
            return;
        }
        $this->invitations->cancel($client);
        $invitation->to->send(Event::InviteCancel, ['id' => $client->id]);
        $this->lobby->dirty = true;
    }
}
