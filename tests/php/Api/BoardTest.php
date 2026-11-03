<?php

declare(strict_types=1);

namespace Hillshot\Tests\Api;

use Hillshot\Api\Board;
use Hillshot\Ranking\Participant;
use Hillshot\Ranking\RankedMatch;
use Hillshot\Ranking\Ranking;
use Hillshot\Ranking\RankingStore;
use PHPUnit\Framework\TestCase;

final class BoardTest extends TestCase
{
    public function testBoardListsPlayersByRatingAndNeverExposesTokens(): void
    {
        $file = sys_get_temp_dir() . '/hillshot-board-' . bin2hex(random_bytes(4)) . '.json';
        try {
            $store = new RankingStore($file);
            $this->assertSame([], (new Board($store))->top(), 'pas de fichier : classement vide');
            $result = (new Ranking())->record(new RankedMatch(new Participant('Alice', 'secret1', 7), new Participant('Bob', 'secret2', 4), true), 1000);
            $this->assertNotNull($result);
            $this->assertTrue($store->save($result->ranking));
            $top = (new Board($store))->top();
            $this->assertSame(['Alice', 'Bob'], array_column($top, 'name'));
            $this->assertSame([1, 2], array_column($top, 'rank'));
            $this->assertStringNotContainsString('secret', json_encode($top, JSON_THROW_ON_ERROR));
        } finally {
            @unlink($file);
        }
    }

    public function testBoardIsLimitedToTheTwentyBest(): void
    {
        $file = sys_get_temp_dir() . '/hillshot-board-' . bin2hex(random_bytes(4)) . '.json';
        try {
            $store = new RankingStore($file);
            $ranking = new Ranking();
            for ($i = 0; $i < 30; $i++) {
                $r = $ranking->record(new RankedMatch(new Participant("A$i", "ha$i", 7), new Participant("B$i", "hb$i", 1), true), 1000 + $i);
                $this->assertNotNull($r);
                $ranking = $r->ranking;
            }
            $store->save($ranking);
            $this->assertCount(Board::LIMIT, (new Board($store))->top());
        } finally {
            @unlink($file);
        }
    }
}
