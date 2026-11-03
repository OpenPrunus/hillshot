<?php

declare(strict_types=1);

namespace Hillshot\Game;

use Hillshot\Ranking\MatchResult;
use Hillshot\Ranking\RankedMatch;
use Hillshot\Ranking\Ranking;
use Hillshot\Ranking\RankingStore;
use Psr\Log\LoggerInterface;

/** Le classement en mémoire et son enregistrement sur disque après chaque match classé. */
final class RankingBook
{
    public private(set) Ranking $ranking;

    public function __construct(private readonly RankingStore $store, private readonly LoggerInterface $logger)
    {
        $this->ranking = $store->load();
    }

    public function settle(RankedMatch $match, int $now): ?MatchResult
    {
        $result = $this->ranking->record($match, $now);
        if ($result === null) {
            return null;
        }
        $this->ranking = $result->ranking;
        if (!$this->store->save($this->ranking)) {
            $this->logger->warning('Ranking could not be saved to ' . $this->store->file());
        }

        return $result;
    }
}
