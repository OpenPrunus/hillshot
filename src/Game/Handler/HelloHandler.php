<?php

declare(strict_types=1);

namespace Hillshot\Game\Handler;

use Hillshot\Game\Client;
use Hillshot\Game\ClientStatus;
use Hillshot\Game\Event;
use Hillshot\Game\Lobby;
use Hillshot\Game\RankingBook;
use Hillshot\Ranking\Token;
use Arcade\Support\Nickname;

/** Inscription au salon : pseudo et jeton (le serveur ne garde que le hash du jeton). */
final readonly class HelloHandler implements MessageHandler
{
    public function __construct(private Lobby $lobby, private RankingBook $book)
    {
    }

    #[\Override]
    public function handle(Client $client, array $msg): void
    {
        if ($client->isNamed) {
            return;
        }
        $name = Nickname::clean(is_string($msg['name'] ?? null) ? $msg['name'] : '');
        if ($name === '') {
            $client->error('bad_name');

            return;
        }
        $token = $msg['token'] ?? null;
        $hasToken = Token::isValid($token);
        $hash = $hasToken ? Token::hash((string) $token) : '';
        $ranking = $this->book->ranking;
        $reserved = $ranking->find($name) !== null && (!$hasToken || $ranking->isReservedByOther($name, $hash));
        if ($this->lobby->isNameInUse($name) || $reserved) {
            $client->error('name_taken');

            return;
        }
        $client->name = $name;
        $client->tokenHash = $hash;
        $client->hasToken = $hasToken;
        $client->status = ClientStatus::Lobby;
        $client->send(Event::Welcome, ['id' => $client->id, 'name' => $name, 'rating' => $ranking->ratingOf($name), 'ranked' => $hasToken]);
        $this->lobby->dirty = true;
    }
}
