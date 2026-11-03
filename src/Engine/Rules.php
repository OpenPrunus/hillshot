<?php

declare(strict_types=1);

namespace Hillshot\Engine;

/** Constantes du terrain et de la balistique : doivent rester identiques à `C` dans web/js/engine.js (les vecteurs de test le vérifient). */
final class Rules
{
    final public const float W = 640.0;                 // largeur de la scène (px)
    final public const float SCENE_H = 380.0;           // hauteur de la scène (px)
    final public const float G = 0.08;                  // gravité (px / pas²)
    final public const float RANGE_AT_MAX = 680.0;      // portée à 45° et 400 g, sans vent : calibre la vitesse initiale
    final public const float WIND_ACC = 0.012;          // accélération horizontale pour un vent de 1
    final public const float WIND_MAX = 1.0;
    final public const int MAX_ANGLE = 90;
    final public const int MAX_POWDER = 400;
    final public const float CASTLE_HW = 20.0;          // demi-largeur d'un château
    final public const float CASTLE_H = 40.0;
    final public const float MUZZLE = 18.0;             // longueur du canon
    final public const int MAX_TICKS = 1500;            // durée maximale d'un vol
    final public const int DAMAGE_CLASSIC = 100;
    final public const int DAMAGE_HEALTH = 34;
    final public const int TARGET = 5;                  // manches à gagner (par défaut)
    final public const int TICKS_PER_SECOND = 60;

    /** Vitesse initiale pour 400 g : sqrt(portée × g), puisque la portée à 45° vaut v0² / g. */
    public static function maxSpeed(): float
    {
        return sqrt(self::RANGE_AT_MAX * self::G);
    }
}
