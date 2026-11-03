<?php

declare(strict_types=1);

namespace Hillshot\Tests\Engine;

use Hillshot\Engine\Ballistics;
use Hillshot\Engine\Duel;
use Hillshot\Engine\Fate;
use Hillshot\Engine\Mode;
use Hillshot\Engine\Round;
use Hillshot\Engine\RoundFactory;
use Hillshot\Engine\Rules;
use Hillshot\Engine\Shot;
use Hillshot\Engine\Side;
use PHPUnit\Framework\TestCase;
use Random\Engine\Mt19937;
use Random\Randomizer;

final class EngineTest extends TestCase
{
    /** Terrain plat et sans vent : plateaux à 340, colline négligeable, châteaux aux extrémités. */
    private static function flat(float $wind = 0.0): Round
    {
        return new Round(340, 0, 320, 60, [60, 580], $wind);
    }

    public function testShotIsClampedToItsBounds(): void
    {
        $s = new Shot(-5, 900);
        $this->assertSame([0, 400], [$s->angle, $s->powder]);
        $s = new Shot(200, -1);
        $this->assertSame([90, 0], [$s->angle, $s->powder]);
    }

    public function testGroundFollowsABaseLevelWithAGaussianHill(): void
    {
        $r = new Round(330, 100, 320, 60, [60, 580], 0.0);
        $this->assertEqualsWithDelta(330.0, $r->groundY(0), 0.01);
        $this->assertEqualsWithDelta(230.0, $r->groundY(320), 1e-9, 'sommet : base - hauteur');
        $this->assertEqualsWithDelta($r->groundY(320 - 50), $r->groundY(320 + 50), 1e-9, 'symétrique autour du sommet');
        $this->assertGreaterThan($r->groundY(320), $r->groundY(250));
    }

    public function testMaxSpeedIsCalibratedSoThatTheRangeAt45DegreesIs680Pixels(): void
    {
        $this->assertEqualsWithDelta(Rules::RANGE_AT_MAX, Rules::maxSpeed() ** 2 / Rules::G, 1e-9, 'portée = v0² / g à 45°');
        $r = new Round(340, 0, 320, 60, [20, 620], 0.0);
        $previous = 0.0;
        foreach ([60, 120, 180, 240] as $powder) {
            $x = Ballistics::fly($r, Side::Left, new Shot(45, $powder))->end()[0];
            $this->assertGreaterThan($previous, $x, 'plus de poudre = plus loin');
            $previous = $x;
        }
    }

    public function testWindPushesTheShellInItsDirection(): void
    {
        $calm = Ballistics::fly(self::flat(0.0), Side::Left, new Shot(60, 250))->end()[0];
        $tail = Ballistics::fly(self::flat(1.0), Side::Left, new Shot(60, 250))->end()[0];
        $head = Ballistics::fly(self::flat(-1.0), Side::Left, new Shot(60, 250))->end()[0];
        $this->assertGreaterThan($calm, $tail);
        $this->assertLessThan($calm, $head);
    }

    public function testRightCastleFiresToTheLeft(): void
    {
        $t = Ballistics::fly(self::flat(), Side::Right, new Shot(45, 200));
        $this->assertLessThan(Ballistics::muzzle(self::flat(), Side::Right, 45)[0], $t->end()[0]);
    }

    public function testShotsEndOnTheGroundOnACastleOrOutOfTheScene(): void
    {
        $r = self::flat();
        $this->assertSame(Fate::Ground, Ballistics::fly($r, Side::Left, new Shot(45, 100))->fate);
        $this->assertSame(Fate::Out, Ballistics::fly($r, Side::Left, new Shot(45, 400))->fate, 'trop de poudre : sort par la droite');
        $self = Ballistics::fly($r, Side::Left, new Shot(90, 0));
        $this->assertSame(Fate::Castle, $self->fate);
        $this->assertSame(Side::Left, $self->hit, 'sans poudre l\'obus retombe sur son propre château');
    }

    public function testAHillBlocksLowShots(): void
    {
        $r = new Round(340, 220, 320, 60, [60, 580], 0.0);
        $low = Ballistics::fly($r, Side::Left, new Shot(20, 260));
        $this->assertSame(Fate::Ground, $low->fate);
        $this->assertLessThan(400.0, $low->end()[0], 'arrêté par la colline');
    }

    /** Cherche un tir qui touche le château adverse (angle fixe, balayage de la poudre). */
    private static function hittingShot(Round $r, Side $side): Shot
    {
        for ($p = 0; $p <= 400; $p++) {
            $t = Ballistics::fly($r, $side, new Shot(55, $p));
            if ($t->fate === Fate::Castle && $t->hit === $side->opposite()) {
                return new Shot(55, $p);
            }
        }
        self::fail('aucun tir gagnant');
    }

    public function testClassicModeDestroysACastleWithOneImpactAndScores(): void
    {
        $duel = new Duel(2, Mode::Classic, self::flat(), Side::Left);
        $out = $duel->fire(self::hittingShot(self::flat(), Side::Left));
        $this->assertTrue($out->roundOver);
        $this->assertSame(Side::Left, $out->roundWinner);
        $this->assertSame([100, 0], $out->hp);
        $this->assertSame([1, 0], $duel->score);
        $this->assertNull($out->matchWinner);
    }

    public function testHealthModeNeedsThreeImpacts(): void
    {
        $duel = new Duel(1, Mode::Health, self::flat(), Side::Left);
        $shot = self::hittingShot(self::flat(), Side::Left);
        $hp = [];
        for ($i = 0; $i < 3; $i++) {
            $out = $duel->fire($shot);
            $hp[] = $out->hp[1];
            if (!$out->roundOver) {
                $duel->fire(new Shot(45, 100));                  // l'adversaire tire dans le sol : on reprend la main
            }
        }
        $this->assertSame([66, 32, 0], $hp);
        $this->assertSame(Side::Left, $duel->winner);
    }

    public function testTurnsAlternateAndTheStarterAlternatesBetweenRounds(): void
    {
        $duel = new Duel(3, Mode::Classic, self::flat(), Side::Right);
        $this->assertSame(Side::Right, $duel->turn);
        $duel->fire(new Shot(45, 100));
        $this->assertSame(Side::Left, $duel->turn);
        $duel->fire(new Shot(45, 100));
        $this->assertSame(Side::Right, $duel->turn);
        $duel->nextRound(self::flat());
        $this->assertSame(Side::Left, $duel->turn, 'la manche suivante commence par l\'autre camp');
        $this->assertSame(2, $duel->roundNumber);
        $this->assertSame([100, 100], $duel->hp);
    }

    public function testHittingYourOwnCastleGivesTheRoundToTheOpponent(): void
    {
        $duel = new Duel(1, Mode::Classic, self::flat(), Side::Left);
        $out = $duel->fire(new Shot(90, 0));
        $this->assertSame(Side::Right, $out->roundWinner);
        $this->assertSame(Side::Right, $duel->winner);
    }

    public function testGeneratedRoundsStayWithinTheSpecifiedRanges(): void
    {
        $factory = new RoundFactory(new Randomizer(new Mt19937(3)));
        for ($i = 0; $i < 300; $i++) {
            $r = $factory->create();
            $this->assertGreaterThanOrEqual(300, $r->baseY);
            $this->assertLessThanOrEqual(360, $r->baseY);
            $this->assertGreaterThanOrEqual(10, $r->hillH);
            $this->assertLessThanOrEqual(220, $r->hillH);
            $this->assertGreaterThanOrEqual(260, $r->hillX);
            $this->assertLessThanOrEqual(380, $r->hillX);
            $this->assertGreaterThanOrEqual(40, $r->sigma);
            $this->assertLessThanOrEqual(95, $r->sigma);
            $this->assertLessThanOrEqual(Rules::WIND_MAX, abs($r->wind));
            $this->assertLessThan(Rules::W / 2, $r->castles[0]);
            $this->assertGreaterThan(Rules::W / 2, $r->castles[1]);
            $this->assertLessThan(40.0, $r->baseY - $r->castleY(Side::Left), 'château de gauche sur son plateau');
            $this->assertLessThan(40.0, $r->baseY - $r->castleY(Side::Right), 'château de droite sur son plateau');
        }
    }

    public function testRoundSurvivesAnArrayRoundTrip(): void
    {
        $r = new Round(333, 120, 300, 70, [88, 531], -0.35);
        $this->assertEquals($r, Round::fromArray($r->toArray()));
    }
}
