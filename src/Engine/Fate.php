<?php

declare(strict_types=1);

namespace Hillshot\Engine;

/** Fin du vol d'un obus. */
enum Fate: string
{
    case Castle = 'castle';
    case Ground = 'ground';
    case Out = 'out';
}
