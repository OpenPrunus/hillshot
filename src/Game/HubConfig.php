<?php

declare(strict_types=1);

namespace Hillshot\Game;

use Arcade\Support\Env;
use Hillshot\Engine\Mode;
use Hillshot\Engine\Rules;

/** Réglages du serveur de jeu (durées en secondes). */
final readonly class HubConfig
{
    public function __construct(
        public int $target = Rules::TARGET,
        public Mode $mode = Mode::Classic,
        public int $aimSeconds = 45,
        public int $maxClients = 300,
        public int $inviteTtl = 20,
        public int $rematchTtl = 30,
        public int $rateLimit = 60,
    ) {
    }

    public static function fromEnvironment(): self
    {
        return new self(
            target: (int) Env::number('HILLSHOT_TARGET', Rules::TARGET),
            mode: Mode::tryFrom(Env::string('HILLSHOT_MODE')) ?? Mode::Classic,
            aimSeconds: (int) Env::number('HILLSHOT_AIM_SECONDS', 45),
            inviteTtl: (int) Env::number('HILLSHOT_INVITE_TTL', 20),
            rematchTtl: (int) Env::number('HILLSHOT_REMATCH_TTL', 30),
        );
    }
}
