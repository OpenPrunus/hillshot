<?php

// API du classement multijoueur (le serveur de jeu écrit ratings.json, ce script le lit).
//   GET -> top 20 : [{rank, name, rating, played, wins, losses}]

declare(strict_types=1);

use Hillshot\Api\Board;
use Hillshot\Ranking\RankingStore;

ini_set('display_errors', '0');          // jamais d'avertissement PHP (ni de chemin interne) dans la réponse
header('Content-Type: application/json; charset=utf-8');
header('Cache-Control: no-store');

foreach ([(string) getenv('HILLSHOT_AUTOLOAD'), __DIR__ . '/../vendor/autoload.php', __DIR__ . '/vendor/autoload.php'] as $autoload) {
    if ($autoload !== '' && is_file($autoload)) {
        require $autoload;
        break;
    }
}

if (($_SERVER['REQUEST_METHOD'] ?? 'GET') !== 'GET') {
    http_response_code(405);
    echo '{"error":"method"}';

    return;
}
$dataDir = rtrim((string) (getenv('HILLSHOT_DATA_DIR') ?: __DIR__ . '/data'), '/');
echo json_encode((new Board(new RankingStore($dataDir . '/ratings.json')))->top(), JSON_THROW_ON_ERROR);
