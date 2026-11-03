<?php

declare(strict_types=1);

namespace Hillshot\Game;

final readonly class Invitation
{
    public function __construct(public Client $from, public Client $to, public int $at)
    {
    }

    public function other(Client $client): Client
    {
        return $client === $this->from ? $this->to : $this->from;
    }
}
