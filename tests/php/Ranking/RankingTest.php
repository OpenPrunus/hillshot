<?php

declare(strict_types=1);

namespace Hillshot\Tests\Ranking;

use Hillshot\Ranking\Elo;
use Hillshot\Ranking\PairLimiter;
use Hillshot\Ranking\Participant;
use Hillshot\Ranking\Player;
use Hillshot\Ranking\RankedMatch;
use Hillshot\Ranking\Ranking;
use Hillshot\Ranking\RankingStore;
use Hillshot\Ranking\Token;
use PHPUnit\Framework\TestCase;

final class RankingTest extends TestCase
{
    private static function match(string $a = 'Alice', string $b = 'Bob', bool $aWon = true, string $ta = 'ha', string $tb = 'hb'): RankedMatch
    {
        return new RankedMatch(new Participant($a, $ta, 7), new Participant($b, $tb, 3), $aWon);
    }

    public function testEloIsZeroSumForEqualPlayersAndFavoursTheUnderdog(): void
    {
        $this->assertSame(20, Elo::delta(1000, 1000, true, 0));        // K=40 : +20
        $this->assertSame(-20, Elo::delta(1000, 1000, false, 0));
        $this->assertGreaterThan(Elo::delta(1000, 1000, true, 20), Elo::delta(1000, 1400, true, 20), 'battre plus fort rapporte plus');
        $this->assertLessThan(Elo::delta(1000, 1000, true, 20), Elo::delta(1400, 1000, true, 20), 'battre plus faible rapporte moins');
        $this->assertEqualsWithDelta(0.5, Elo::expected(1000, 1000), 1e-12);
        $this->assertEqualsWithDelta(1.0, Elo::expected(1000, 1000) + Elo::expected(1000, 1000), 1e-12);
    }

    public function testNewcomersMoveFasterThanVeterans(): void
    {
        $this->assertSame(40, Elo::kFactor(0));
        $this->assertSame(40, Elo::kFactor(9));
        $this->assertSame(24, Elo::kFactor(10));
    }

    public function testRatingNeverFallsBelowTheFloor(): void
    {
        $this->assertSame(0, Elo::delta(Elo::FLOOR, 2000, false, 50));
        $this->assertSame(-1, Elo::delta(Elo::FLOOR + 1, Elo::FLOOR + 1, false, 50), 'au plus jusqu\'au plancher');
        $this->assertSame(Elo::FLOOR, (new Player('x', 'h', Elo::FLOOR + 5))->afterMatch(-100, false, 0, 7)->rating);
    }

    public function testRepeatedGainsAreReducedButLossesAreNot(): void
    {
        $this->assertSame(10, Elo::delta(1000, 1000, true, 0, 0.5));
        $this->assertSame(0, Elo::delta(1000, 1000, true, 0, 0.0));
        $this->assertSame(-20, Elo::delta(1000, 1000, false, 0, 0.0), 'une défaite compte toujours en entier');
    }

    public function testFirstMatchCreatesBothPlayersAndReservesTheirNames(): void
    {
        $r = (new Ranking())->record(self::match(), 1000);
        $this->assertNotNull($r);
        $this->assertSame([20, -20], $r->deltas);
        $this->assertSame([1020, 980], $r->ratings);
        $ranking = $r->ranking;
        $this->assertCount(2, $ranking);
        $alice = $ranking->find('ALICE');
        $this->assertNotNull($alice, 'recherche insensible à la casse');
        $this->assertSame([1, 0, 1, 7, 3], [$alice->wins, $alice->losses, $alice->played, $alice->pointsFor, $alice->pointsAgainst]);
        $this->assertTrue($ranking->isReservedByOther('alice', 'autre'));
        $this->assertFalse($ranking->isReservedByOther('alice', 'ha'));
        $this->assertFalse($ranking->isReservedByOther('Inconnu', 'x'));
    }

    public function testAMatchUsingAnotherPlayersNameIsRefused(): void
    {
        $ranking = (new Ranking())->record(self::match(), 1000)?->ranking;
        $this->assertNotNull($ranking);
        $this->assertNull($ranking->record(self::match(ta: 'usurpateur'), 1001));
    }

    public function testRankingIsImmutable(): void
    {
        $empty = new Ranking();
        $next = $empty->record(self::match(), 1000)?->ranking;
        $this->assertCount(0, $empty);
        $this->assertCount(2, $next ?? new Ranking());
    }

    public function testPairLimiterReducesGainsBetweenTheSamePlayers(): void
    {
        $ranking = new Ranking();
        $factors = [];
        for ($i = 0; $i < 6; $i++) {
            $r = $ranking->record(self::match(aWon: true), 1000 + $i);
            $this->assertNotNull($r);
            $factors[] = $r->factor;
            $ranking = $r->ranking;
        }
        $this->assertSame([1.0, 1.0, 0.5, 0.25, 0.0, 0.0], $factors);
    }

    public function testPairLimiterWindowExpiresAndKeysAreOrderIndependent(): void
    {
        $this->assertSame(PairLimiter::pairKey('Bob', 'alice'), PairLimiter::pairKey('ALICE', 'bob'));
        $limiter = new PairLimiter();
        $m = $limiter->meet('a', 'b', 1000);
        $m = $m->limiter->meet('b', 'a', 1001);
        $this->assertSame(1.0, $m->factor);
        $m = $m->limiter->meet('a', 'b', 1002);
        $this->assertSame(0.5, $m->factor);
        $later = $m->limiter->meet('a', 'b', 1002 + PairLimiter::WINDOW + 1);
        $this->assertSame(1.0, $later->factor, 'hors fenêtre : on repart de zéro');
        $this->assertCount(1, $later->limiter->meetings['a|b'], 'les vieilles rencontres sont oubliées');
    }

    public function testTopIsSortedAndPublicViewHidesTheToken(): void
    {
        $ranking = new Ranking([
            'a' => new Player('A', 'secretA', 1100, 5, 3, 2),
            'b' => new Player('B', 'secretB', 1300, 5, 4, 1),
            'c' => new Player('C', 'secretC', 1100, 5, 4, 1),
        ]);
        $this->assertSame(['B', 'C', 'A'], array_map(static fn (Player $p): string => $p->name, $ranking->top()));
        $this->assertCount(2, $ranking->top(2));
        $public = $ranking->top()[0]->toPublicArray(1);
        $this->assertArrayNotHasKey('tokenHash', $public);
        $this->assertSame(['rank', 'name', 'rating', 'played', 'wins', 'losses'], array_keys($public));
    }

    public function testStoreRoundTripAndResilience(): void
    {
        $dir = sys_get_temp_dir() . '/hillshot-rank-' . bin2hex(random_bytes(4));
        mkdir($dir);
        try {
            $store = new RankingStore("$dir/ratings.json");
            $this->assertCount(0, $store->load(), 'fichier absent : classement vide');
            $ranking = (new Ranking())->record(self::match(), 1000)?->ranking;
            $this->assertNotNull($ranking);
            $this->assertTrue($store->save($ranking));
            $loaded = $store->load();
            $this->assertCount(2, $loaded);
            $this->assertSame(1020, $loaded->ratingOf('Alice'));
            $this->assertSame(['alice|bob' => [1000]], $loaded->pairs->meetings);
            file_put_contents("$dir/ratings.json", '{ cassé');
            $this->assertCount(0, $store->load(), 'illisible : vide');
            $valid = ['name' => 'Ok', 'tokenHash' => 'h', 'rating' => 1000, 'played' => 0, 'wins' => 0, 'losses' => 0, 'pf' => 0, 'pa' => 0];
            file_put_contents("$dir/ratings.json", json_encode(['players' => [['name' => 'x'], 'pas un joueur', $valid]]));
            $this->assertCount(1, $store->load(), 'les lignes invalides sont ignorées');
        } finally {
            array_map('unlink', glob("$dir/*") ?: []);
            rmdir($dir);
        }
    }

    public function testTokenValidationAndHash(): void
    {
        $this->assertTrue(Token::isValid(str_repeat('a', 24)));
        $this->assertTrue(Token::isValid('abcDEF123_-' . str_repeat('x', 20)));
        foreach ([null, 42, '', 'court', str_repeat('a', 23), str_repeat('a', 129), str_repeat('é', 30), "abc\n" . str_repeat('a', 30)] as $bad) {
            $this->assertFalse(Token::isValid($bad), var_export($bad, true));
        }
        $this->assertSame(hash('sha256', 'x'), Token::hash('x'));
    }
}
