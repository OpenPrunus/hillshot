<?php

declare(strict_types=1);

namespace Hillshot\Engine;

/** Une manche : terrain (plateaux + colline gaussienne), position des deux châteaux et vent. */
final readonly class Round
{
    /**
     * @param int $baseY    ordonnée des plateaux (300 à 360)
     * @param int $hillH    hauteur de la colline (10 à 220)
     * @param int $hillX    abscisse de son sommet (260 à 380)
     * @param int $sigma    étalement (40 à 95)
     * @param array{int, int} $castles abscisse du château de gauche et de droite
     * @param float $wind   vent horizontal (-1 à 1, positif = vers la droite)
     */
    public function __construct(
        public int $baseY,
        public int $hillH,
        public int $hillX,
        public int $sigma,
        public array $castles,
        public float $wind,
    ) {
    }

    /** Ordonnée du sol (y vers le bas) à l'abscisse x. */
    public function groundY(float $x): float
    {
        $dx = $x - $this->hillX;

        return $this->baseY - $this->hillH * exp(-($dx * $dx) / (2 * $this->sigma * $this->sigma));
    }

    /** Ordonnée du pied du château de ce côté. */
    public function castleY(Side $side): float
    {
        return $this->groundY((float) $this->castles[$side->value]);
    }

    /** @return array{baseY: int, hillH: int, hillX: int, sigma: int, castles: array{int, int}, wind: float} */
    public function toArray(): array
    {
        return ['baseY' => $this->baseY, 'hillH' => $this->hillH, 'hillX' => $this->hillX, 'sigma' => $this->sigma, 'castles' => $this->castles, 'wind' => $this->wind];
    }

    /** @param array{baseY: int, hillH: int, hillX: int, sigma: int, castles: array{int, int}, wind: float|int} $a */
    public static function fromArray(array $a): self
    {
        return new self($a['baseY'], $a['hillH'], $a['hillX'], $a['sigma'], [(int) $a['castles'][0], (int) $a['castles'][1]], (float) $a['wind']);
    }
}
