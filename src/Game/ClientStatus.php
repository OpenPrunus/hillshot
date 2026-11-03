<?php

declare(strict_types=1);

namespace Hillshot\Game;

/** Ce que fait un client ; la valeur est celle affichée dans le salon. */
enum ClientStatus: string
{
    case New = 'new';          // connecté, pas encore de pseudo
    case Lobby = 'lobby';      // dans le salon
    case Queued = 'queued';    // cherche un adversaire
    case Playing = 'playing';  // en match
}
