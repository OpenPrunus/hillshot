<?php

declare(strict_types=1);

namespace Hillshot\Tests\Engine;

use Hillshot\Engine\Duel;
use Hillshot\Engine\Mode;
use Hillshot\Engine\Round;
use Hillshot\Engine\Shot;
use Hillshot\Engine\Side;
use PHPUnit\Framework\TestCase;

/** Rejoue en PHP les matchs enregistrés par le moteur JavaScript (npm run fixtures) : même terrain, mêmes tirs, mêmes résultats. */
final class FixturesTest extends TestCase
{
    private const float EPS = 1e-9;

    public function testPhpReplaysTheJavaScriptMatches(): void
    {
        $file = dirname(__DIR__, 2) . '/fixtures/engine-vectors.json';
        $this->assertFileExists($file);
        /** @var array{duels: list<array<string, mixed>>} $data */
        $data = json_decode((string) file_get_contents($file), true, 512, JSON_THROW_ON_ERROR);
        $this->assertCount(7, $data['duels']);
        $shots = 0;
        foreach ($data['duels'] as $d) {
            $rounds = array_map(static fn (array $r): Round => Round::fromArray($r), $d['rounds']);
            $duel = new Duel($d['target'], Mode::from($d['mode']), $rounds[0], Side::from($d['first']));
            $currentRound = 0;
            foreach ($d['shots'] as $i => $expected) {
                $label = "match {$d['seed']}, tir $i";
                if ($expected['round'] !== $currentRound) {
                    $currentRound = $expected['round'];
                    $duel->nextRound($rounds[$currentRound]);
                }
                $out = $duel->fire(new Shot((int) $expected['shot']['angle'], (int) $expected['shot']['powder']));
                $this->assertSame($expected['by'], $out->by->value, $label);
                $this->assertSame($expected['fate'], $out->trajectory->fate->value, $label);
                $this->assertSame($expected['hit'], $out->trajectory->hit?->value, $label);
                $this->assertCount(count($expected['path']), $out->trajectory->path, "$label : durée du vol");
                foreach ($expected['path'] as $k => [$x, $y]) {
                    $this->assertEqualsWithDelta($x, $out->trajectory->path[$k][0], self::EPS, "$label, point $k (x)");
                    $this->assertEqualsWithDelta($y, $out->trajectory->path[$k][1], self::EPS, "$label, point $k (y)");
                }
                $this->assertSame($expected['hp'], $out->hp, $label);
                $this->assertSame($expected['roundOver'], $out->roundOver, $label);
                $this->assertSame($expected['roundWinner'], $out->roundWinner?->value, $label);
                $this->assertSame($expected['matchWinner'], $out->matchWinner?->value, $label);
                $this->assertSame($expected['next'], $out->next->value, $label);
                $this->assertSame($expected['score'], $duel->score, $label);
                $shots++;
            }
        }
        $this->assertGreaterThan(100, $shots);
    }
}
