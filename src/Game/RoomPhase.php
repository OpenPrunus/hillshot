<?php

declare(strict_types=1);

namespace Hillshot\Game;

/** Où en est le match : un joueur règle son tir, un obus vole (les écrans l'animent), ou c'est terminé. */
enum RoomPhase
{
    case Aiming;
    case Flying;
    case Over;
}
