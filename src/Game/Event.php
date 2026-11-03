<?php

declare(strict_types=1);

namespace Hillshot\Game;

/** Messages que le serveur envoie (champ `t`). */
enum Event: string
{
    case Welcome = 'welcome';
    case Lobby = 'lobby';
    case Queued = 'queued';
    case Unqueued = 'unqueued';
    case Invite = 'invite';
    case InviteCancel = 'invite_cancel';
    case Waiting = 'waiting';
    case Declined = 'declined';
    case Match = 'match';
    case Round = 'round';
    case Turn = 'turn';
    case Shot = 'shot';
    case Result = 'result';
    case OpponentLeft = 'oppleft';
    case Left = 'left';
    case RematchAsk = 'rematch_ask';
    case Pong = 'pong';
    case Error = 'error';
}
