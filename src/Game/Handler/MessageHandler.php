<?php

declare(strict_types=1);

namespace Hillshot\Game\Handler;

use Hillshot\Game\Client;

/** Traite un type de message du navigateur (patron Command : un handler par `ClientMessage`). */
interface MessageHandler
{
    /** @param array<string, mixed> $msg message JSON décodé (le champ `t` est déjà vérifié) */
    public function handle(Client $client, array $msg): void;
}
