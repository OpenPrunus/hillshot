<?php

declare(strict_types=1);

namespace Hillshot\Engine;

/** Vol d'un obus : vitesse initiale proportionnelle à la poudre, gravité et vent constants, pas fixes d'un tick. */
final class Ballistics
{
    /**
     * Bouche du canon : au-dessus du château, dans la direction du tir.
     *
     * @return array{float, float}
     */
    public static function muzzle(Round $round, Side $side, int $angle): array
    {
        $a = $angle * M_PI / 180;
        $cx = (float) $round->castles[$side->value];

        return [$cx + $side->direction() * cos($a) * Rules::MUZZLE, $round->castleY($side) - Rules::CASTLE_H - 2 - sin($a) * Rules::MUZZLE];
    }

    public static function fly(Round $round, Side $side, Shot $shot): Trajectory
    {
        $a = $shot->angle * M_PI / 180;
        $v0 = Rules::maxSpeed() * $shot->powder / Rules::MAX_POWDER;
        $vx = $side->direction() * $v0 * cos($a);
        $vy = -$v0 * sin($a);
        [$x, $y] = self::muzzle($round, $side, $shot->angle);
        $path = [[$x, $y]];
        $fate = Fate::Out;
        $hit = null;
        for ($tick = 0; $tick < Rules::MAX_TICKS; $tick++) {
            $vx += Rules::WIND_ACC * $round->wind;
            $vy += Rules::G;
            $x += $vx;
            $y += $vy;
            if ($x < 0 || $x > Rules::W) {
                $path[] = [$x, $y];
                break;
            }
            $struck = self::castleAt($round, $x, $y);
            if ($struck !== null) {
                $path[] = [$x, $y];
                $fate = Fate::Castle;
                $hit = $struck;
                break;
            }
            $ground = $round->groundY($x);
            if ($y >= $ground) {
                $path[] = [$x, $ground];
                $fate = Fate::Ground;
                break;
            }
            $path[] = [$x, $y];
        }

        return new Trajectory($path, $fate, $hit);
    }

    private static function castleAt(Round $round, float $x, float $y): ?Side
    {
        foreach ([Side::Left, Side::Right] as $side) {
            $cy = $round->castleY($side);
            if (abs($x - $round->castles[$side->value]) <= Rules::CASTLE_HW && $y >= $cy - Rules::CASTLE_H && $y <= $cy) {
                return $side;
            }
        }

        return null;
    }
}
