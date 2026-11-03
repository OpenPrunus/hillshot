<?php

declare(strict_types=1);

namespace Hillshot\Ranking;

/** Jeton secret généré par le navigateur : le serveur n'en garde que le hash SHA-256. */
final class Token
{
    public static function isValid(mixed $token): bool
    {
        return is_string($token) && preg_match('/^[A-Za-z0-9_-]{24,128}$/', $token) === 1;
    }

    public static function hash(string $token): string
    {
        return hash('sha256', $token);
    }
}
