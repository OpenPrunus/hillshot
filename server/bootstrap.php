<?php

/**
 * Charge l'autoloader Composer, où qu'il soit : variable HILLSHOT_AUTOLOAD, à côté du script (image Docker : /opt/hillshot)
 * ou à la racine du dépôt.
 */

declare(strict_types=1);

foreach ([(string) getenv('HILLSHOT_AUTOLOAD'), __DIR__ . '/vendor/autoload.php', __DIR__ . '/../vendor/autoload.php'] as $autoload) {
    if ($autoload !== '' && is_file($autoload)) {
        require $autoload;

        return;
    }
}
fwrite(STDERR, "Composer autoloader not found: run 'composer install'.\n");
exit(1);
