<?php

declare(strict_types=1);

namespace Hillshot\Tests\Game;

use Arcade\Support\StdoutLogger;
use Hillshot\Engine\Ballistics;
use Hillshot\Engine\Fate;
use Hillshot\Engine\Mode;
use Hillshot\Engine\Shot;
use Hillshot\Game\Client;
use Hillshot\Game\ClientStatus;
use Hillshot\Game\GameHub;
use Hillshot\Game\HubConfig;
use Hillshot\Game\MatchService;
use Hillshot\Ranking\RankingStore;
use Hillshot\Tests\Game\Support\FakeTransport;
use Hillshot\Tests\Game\Support\MutableClock;
use PHPUnit\Framework\TestCase;
use Random\Engine\Mt19937;
use Random\Randomizer;

/** Le serveur de jeu sans réseau : salon, défis, partie rapide, tours de jeu, délais, matchs classés, forfaits et revanches. */
final class GameHubTest extends TestCase
{
    private GameHub $hub;
    private MutableClock $clock;
    private string $dir;
    private int $ipCounter = 0;

    protected function setUp(): void
    {
        $this->dir = sys_get_temp_dir() . '/hillshot-hub-' . bin2hex(random_bytes(4));
        mkdir($this->dir);
        $this->clock = new MutableClock();
        $this->hub = $this->makeHub();
    }

    protected function tearDown(): void
    {
        array_map('unlink', glob($this->dir . '/*') ?: []);
        rmdir($this->dir);
    }

    private function makeHub(int $target = 1, Mode $mode = Mode::Classic): GameHub
    {
        $silent = new StdoutLogger(fopen('php://memory', 'w'));

        return GameHub::create(
            new HubConfig(target: $target, mode: $mode, aimSeconds: 45),
            new RankingStore($this->dir . '/ratings.json'),
            $this->clock,
            $silent,
            new Randomizer(new Mt19937(7)),
        );
    }

    /** @return array{Client, FakeTransport} */
    private function connect(?string $name = null, ?string $token = null, ?string $ip = null): array
    {
        $transport = new FakeTransport();
        $client = $this->hub->accept($transport);
        $client->setAddress($ip ?? '203.0.113.' . (++$this->ipCounter));        // une adresse différente par navigateur, sauf demande contraire
        if ($name !== null) {
            $this->say($client, ['t' => 'hello', 'name' => $name, 'token' => $token]);
        }

        return [$client, $transport];
    }

    /** @param array<string, mixed> $msg */
    private function say(Client $client, array $msg): void
    {
        $this->hub->receive($client, json_encode($msg, JSON_THROW_ON_ERROR));
    }

    private function ticks(int $n): void
    {
        for ($i = 0; $i < $n; $i++) {
            $this->hub->tick();
        }
    }

    private static function token(string $seed): string
    {
        return substr(str_repeat($seed, 30), 0, 32);
    }

    /** @return array{Client, FakeTransport, Client, FakeTransport} deux joueurs en match (jetons différents => classé) */
    private function startRankedMatch(string $a = 'Alice', string $b = 'Bob'): array
    {
        [$ca, $ta] = $this->connect($a, self::token($a));
        [$cb, $tb] = $this->connect($b, self::token($b));
        $this->say($ca, ['t' => 'queue']);
        $this->say($cb, ['t' => 'queue']);

        return [$ca, $ta, $cb, $tb];
    }

    /** Le client dont c'est le tour. */
    private function active(Client $a, Client $b): Client
    {
        $room = $a->room ?? throw new \LogicException('pas de match');

        return $room->players[$room->duel->turn->value];
    }

    /** Un réglage qui détruit le château adverse (cherché avec le moteur : angle, poudre). */
    private function winningShot(Client $client): Shot
    {
        $room = $client->room ?? throw new \LogicException('pas de match');
        $side = $room->sideOf($client) ?? throw new \LogicException('pas dans ce match');
        for ($angle = 20; $angle <= 85; $angle += 5) {
            for ($powder = 0; $powder <= 400; $powder += 4) {
                $t = Ballistics::fly($room->duel->round, $side, new Shot($angle, $powder));
                if ($t->fate === Fate::Castle && $t->hit === $side->opposite()) {
                    return new Shot($angle, $powder);
                }
            }
        }
        throw new \LogicException('aucun tir gagnant sur ce terrain');
    }

    private function fireWinning(Client $client): void
    {
        $shot = $this->winningShot($client);
        $this->say($client, ['t' => 'fire', 'a' => $shot->angle, 'p' => $shot->powder]);
    }

    /** Termine un match d'une manche (target 1) : le joueur actif détruit le château adverse, on laisse l'animation finir. */
    private function finishMatch(Client $a, Client $b): void
    {
        $this->fireWinning($this->active($a, $b));
        $this->clock->advance(60);
        $this->ticks(1);
    }

    public function testHelloRegistersThePlayerAndAnnouncesTheLobby(): void
    {
        [$a, $ta] = $this->connect('Alice');
        [$b, $tb] = $this->connect('  Bob  ');
        $this->assertSame('Alice', $ta->last('welcome')['name']);
        $this->assertSame('Bob', $tb->last('welcome')['name'], 'espaces retirés');
        $this->assertFalse($ta->last('welcome')['ranked'], 'sans jeton : invité');
        $this->assertSame(ClientStatus::Lobby, $a->status);
        $this->ticks(GameHub::HOUSEKEEPING_EVERY);
        $this->assertSame(['Bob'], array_column($ta->last('lobby')['players'], 'name'), 'chacun voit les autres, pas lui-même');
        $this->assertSame(['Alice'], array_column($tb->last('lobby')['players'], 'name'));
    }

    public function testInvalidAndDuplicateNicknamesAreRefused(): void
    {
        foreach (['', '   ', '<>!?', null] as $bad) {
            [, $t] = $this->connect($bad ?? '');
            $this->assertSame('bad_name', $t->last('error')['code'] ?? null, var_export($bad, true));
        }
        $this->connect('Alice');
        [, $t] = $this->connect('ALICE');
        $this->assertSame('name_taken', $t->last('error')['code'], 'pseudo déjà connecté, sans tenir compte de la casse');
        [, $long] = $this->connect(str_repeat('x', 40));
        $this->assertSame(15, mb_strlen($long->last('welcome')['name']));
    }

    public function testEverythingButPingAndHelloNeedsANickname(): void
    {
        [$c, $t] = $this->connect();
        $this->say($c, ['t' => 'queue']);
        $this->say($c, ['t' => 'challenge', 'id' => 1]);
        $this->assertSame(['error', 'error'], $t->types());
        $this->assertSame('not_ready', $t->last('error')['code']);
        $this->say($c, ['t' => 'ping', 'c' => 5]);
        $this->assertSame(5, $t->last('pong')['c']);
    }

    public function testLeavingTheQueueAndQueueingTwiceDoNotMatchAPlayerWithHimself(): void
    {
        [$a, $ta] = $this->connect('Alice');
        $this->say($a, ['t' => 'queue']);
        $this->say($a, ['t' => 'queue']);
        $this->assertSame('busy', $ta->last('error')['code']);
        $this->say($a, ['t' => 'unqueue']);
        $this->assertNotNull($ta->last('unqueued'));
        [$b, $tb] = $this->connect('Bob');
        $this->say($b, ['t' => 'queue']);
        $this->assertNull($tb->last('match'), 'Alice a quitté la file');
        $this->assertSame(0, $this->hub->matchCount());
    }

    public function testChallengeAcceptStartsAMatch(): void
    {
        [$a, $ta] = $this->connect('Alice');
        [$b, $tb] = $this->connect('Bob');
        $this->say($a, ['t' => 'challenge', 'id' => $b->id]);
        $this->assertSame('Bob', $ta->last('waiting')['name']);
        $this->assertSame(['id' => $a->id, 'name' => 'Alice'], array_intersect_key($tb->last('invite'), ['id' => 1, 'name' => 1]));
        $this->say($b, ['t' => 'accept', 'id' => $a->id]);
        $this->assertNotNull($ta->last('match'));
        $this->assertNotNull($tb->last('match'));
        $this->assertNull($a->invite);
    }

    public function testDeclineCancelAndInvalidAnswers(): void
    {
        [$a, $ta] = $this->connect('Alice');
        [$b, $tb] = $this->connect('Bob');
        [$c, $tc] = $this->connect('Carl');
        $this->say($a, ['t' => 'challenge', 'id' => $b->id]);
        $this->say($c, ['t' => 'accept', 'id' => $a->id]);
        $this->assertSame('busy', $tc->last('error')['code'], 'seul le défié peut accepter');
        $this->say($b, ['t' => 'accept', 'id' => 999]);
        $this->assertSame('busy', $tb->last('error')['code'], 'mauvais défieur');
        $this->say($b, ['t' => 'decline', 'id' => $a->id]);
        $this->assertSame('Bob', $ta->last('declined')['name']);
        $this->say($a, ['t' => 'challenge', 'id' => $b->id]);
        $this->say($a, ['t' => 'cancel']);
        $this->assertNotNull($tb->last('invite_cancel'));
        $this->say($b, ['t' => 'accept', 'id' => $a->id]);
        $this->assertNull($tb->last('match'), 'défi retiré : plus rien à accepter');
    }

    public function testChallengeRefusedWhenTheTargetIsBusyOrInvalid(): void
    {
        [$a, $ta] = $this->connect('Alice');
        [$b] = $this->connect('Bob');
        [$c, $tc] = $this->connect('Carl');
        $this->say($a, ['t' => 'challenge', 'id' => $a->id]);
        $this->say($a, ['t' => 'challenge', 'id' => 4242]);
        $this->say($a, ['t' => 'challenge', 'id' => 'x']);
        $this->assertSame(['busy', 'busy', 'busy'], array_column($ta->of('error'), 'code'));
        $this->say($a, ['t' => 'challenge', 'id' => $b->id]);
        $this->say($c, ['t' => 'challenge', 'id' => $b->id]);
        $this->assertSame('busy', $tc->last('error')['code'], 'Bob a déjà un défi en attente');
    }

    public function testExpiredInvitationsAreCancelledForBothSides(): void
    {
        [$a, $ta] = $this->connect('Alice');
        [$b, $tb] = $this->connect('Bob');
        $this->say($a, ['t' => 'challenge', 'id' => $b->id]);
        $this->clock->advance(21);
        $this->ticks(GameHub::HOUSEKEEPING_EVERY);
        $this->assertNotNull($ta->last('invite_cancel'));
        $this->assertNotNull($tb->last('invite_cancel'));
        $this->assertNull($a->invite);
    }

    public function testTwoTabsOfTheSameBrowserNeverRankAgainstEachOther(): void
    {
        $same = self::token('z');
        [$a, $ta] = $this->connect('Tab1', $same);
        [$b] = $this->connect('Tab2', $same);
        $this->say($a, ['t' => 'queue']);
        $this->say($b, ['t' => 'queue']);
        $this->assertFalse($ta->last('match')['ranked']);
    }

    public function testLeavingMidMatchIsAForfeitForTheLeaver(): void
    {
        [$a, $ta, $b, $tb] = $this->startRankedMatch();
        $this->ticks(5);
        $this->say($a, ['t' => 'leave']);
        $rb = $tb->last('result');
        $this->assertTrue($rb['forfeit']);
        $this->assertNotNull($tb->last('oppleft'));
        $this->assertSame($b->room, null);
        $this->assertSame(ClientStatus::Lobby, $b->status);
        $this->assertSame(ClientStatus::Lobby, $a->status);
        $this->assertArrayNotHasKey('delta', $rb, 'forfait sans aucun point joué : pas de classement');
        $this->assertSame(0, $this->hub->matchCount());
    }

    public function testDisconnectDuringAMatchNotifiesTheOpponent(): void
    {
        [$a, , , $tb] = $this->startRankedMatch();
        $this->hub->disconnect($a);
        $this->assertNotNull($tb->last('oppleft'));
        $this->assertSame(0, $this->hub->matchCount());
        $this->assertCount(1, $this->hub->lobby);
    }


    public function testQuickMatchPairsTwoPlayersOnOppositeSides(): void
    {
        [$a, $ta] = $this->connect('Alice');
        [$b, $tb] = $this->connect('Bob');
        $this->say($a, ['t' => 'queue']);
        $this->assertNotNull($ta->last('queued'));
        $this->assertSame(ClientStatus::Queued, $a->status);
        $this->say($b, ['t' => 'queue']);
        $ma = $ta->last('match');
        $mb = $tb->last('match');
        $this->assertNotNull($ma);
        $this->assertNotNull($mb);
        $this->assertSame(1, $ma['side'] + $mb['side'], 'un à gauche, un à droite');
        $this->assertSame('Bob', $ma['opp']['name']);
        $this->assertSame('Alice', $mb['opp']['name']);
        $this->assertFalse($ma['ranked'], 'invités : amical');
        $this->assertSame(1, $ma['target']);
        $this->assertSame('classic', $ma['mode']);
        $this->assertSame([ClientStatus::Playing, ClientStatus::Playing], [$a->status, $b->status]);
        $this->assertSame(1, $this->hub->matchCount());
    }

    public function testTheRoundIsAnnouncedToBothPlayersWithTheSameTerrainAndWind(): void
    {
        [$a, $ta, $b, $tb] = $this->startRankedMatch();
        $ra = $ta->last('round');
        $this->assertNotNull($ra);
        $this->assertSame($ra, $tb->last('round'));
        $this->assertSame(1, $ra['n']);
        $this->assertContains($ra['turn'], [0, 1]);
        $this->assertSame([100, 100], $ra['hp']);
        $this->assertSame([0, 0], $ra['score']);
        $this->assertSame(45, $ra['left']);
        $this->assertEqualsCanonicalizing(['baseY', 'hillH', 'hillX', 'sigma', 'castles', 'wind'], array_keys($ra['round']));
        $this->assertGreaterThanOrEqual(-1.0, $ra['round']['wind']);
        $this->assertLessThanOrEqual(1.0, $ra['round']['wind']);
    }

    public function testOnlyThePlayerWhoseTurnItIsCanFireAndBothSeeTheFlight(): void
    {
        [$a, $ta, $b, $tb] = $this->startRankedMatch();
        $shooter = $this->active($a, $b);
        $other = $shooter === $a ? $b : $a;
        $tOther = $other === $a ? $ta : $tb;
        $this->say($other, ['t' => 'fire', 'a' => 45, 'p' => 200]);
        $this->assertSame('not_your_turn', $tOther->last('error')['code']);
        $this->assertNull($ta->last('shot'));

        $this->say($shooter, ['t' => 'fire', 'a' => 45, 'p' => 250]);
        $shot = $ta->last('shot');
        $this->assertSame($shot, $tb->last('shot'), 'les deux joueurs reçoivent le même vol');
        $side = $shooter->room?->sideOf($shooter)?->value;
        $this->assertSame($side, $shot['by']);
        $this->assertSame([45, 250], [$shot['a'], $shot['p']]);
        $expected = Ballistics::fly($shooter->room->duel->round, $shooter->room->sideOf($shooter), new Shot(45, 250));
        $this->assertSame($expected->fate->value, $shot['fate']);
        $this->assertCount(count($expected->path), $shot['path']);
        $this->say($shooter, ['t' => 'fire', 'a' => 45, 'p' => 250]);
        $this->assertSame('not_your_turn', ($shooter === $a ? $ta : $tb)->last('error')['code'], 'pas deux tirs pendant que l\'obus vole');
    }

    public function testTheTurnPassesToTheOpponentOnlyAfterTheFlightHasBeenAnimated(): void
    {
        [$a, $ta, $b, $tb] = $this->startRankedMatch();
        $first = $this->active($a, $b);
        $this->say($first, ['t' => 'fire', 'a' => 45, 'p' => 100]);
        $this->assertNull($ta->last('turn'));
        $this->ticks(3);
        $this->assertNull($ta->last('turn'), 'l\'animation n\'est pas finie');
        $this->clock->advance(30);
        $this->ticks(1);
        $turn = $ta->last('turn');
        $this->assertNotNull($turn);
        $this->assertSame($turn, $tb->last('turn'));
        $this->assertSame($first->room?->sideOf($first)?->opposite()->value, $turn['turn']);
        $this->assertSame(45, $turn['left']);
    }

    public function testFireWithoutAMatchOrWithGarbageIsIgnored(): void
    {
        [$a, $ta] = $this->connect('Alice');
        $before = count($ta->sent);
        $this->say($a, ['t' => 'fire', 'a' => 45, 'p' => 100]);
        foreach (['', 'pas du json', '[]', '{"t":42}', '{"t":["queue"]}', '{"t":"inconnu"}', str_repeat('x', 3000)] as $raw) {
            $this->hub->receive($a, $raw);
        }
        $this->assertCount($before, $ta->sent);
    }

    public function testInvalidShotValuesAreRefusedAndOutOfRangeOnesAreClamped(): void
    {
        [$a, $ta, $b, $tb] = $this->startRankedMatch();
        $shooter = $this->active($a, $b);
        $t = $shooter === $a ? $ta : $tb;
        $this->say($shooter, ['t' => 'fire', 'a' => 'beaucoup', 'p' => null]);
        $this->assertSame('bad_shot', $t->last('error')['code']);
        $this->say($shooter, ['t' => 'fire', 'a' => 500, 'p' => -20]);
        $shot = $t->last('shot');
        $this->assertSame([90, 0], [$shot['a'], $shot['p']], 'ramenés dans les bornes 0-90° et 0-400 g');
    }

    public function testMessageRateIsLimitedPerSecond(): void
    {
        [$a, $ta] = $this->connect('Alice');
        for ($i = 0; $i < 400; $i++) {
            $this->say($a, ['t' => 'ping', 'c' => $i]);
        }
        $this->assertCount(60 - 1, $ta->of('pong'), 'hello compte aussi dans la seconde');
        $this->clock->advance(1);
        $this->say($a, ['t' => 'ping', 'c' => 1]);
        $this->assertCount(60, $ta->of('pong'), 'la seconde suivante repart de zéro');
    }

    public function testRankedMatchReportsTheResultAndUpdatesTheRating(): void
    {
        [$a, $ta, $b, $tb] = $this->startRankedMatch();
        $this->assertTrue($ta->last('match')['ranked']);
        $this->finishMatch($a, $b);
        $ra = $ta->last('result');
        $rb = $tb->last('result');
        $this->assertNotNull($ra);
        $this->assertFalse($ra['forfeit']);
        $this->assertSame($ra['winner'], $rb['winner']);
        $this->assertSame(1000 + $ra['delta'], $ra['rating']);
        $this->assertSame(0, $ra['delta'] + $rb['delta'], 'Elo à somme nulle entre deux débutants');
        $this->assertSame(1, array_sum($ra['score']));
        $ranking = $this->hub->ranking()->ranking;
        $this->assertCount(2, $ranking);
        $this->assertFileExists($this->dir . '/ratings.json');
        $this->assertSame($ra['rating'], $ranking->ratingOf('Alice'));
        $this->assertSame($rb['rating'], $ranking->ratingOf('Bob'));
        $this->assertSame($ra['winner'] === $ta->last('match')['side'], $ra['delta'] > 0, 'le vainqueur gagne des points');
    }

    public function testTheResultComesOnlyAfterTheLastShellHasLanded(): void
    {
        [$a, $ta, $b] = $this->startRankedMatch();
        $this->fireWinning($this->active($a, $b));
        $this->assertNotNull($ta->last('shot'));
        $this->assertTrue($ta->last('shot')['over']);
        $this->assertNull($ta->last('result'), 'on laisse voir l\'explosion');
        $this->clock->advance(60);
        $this->ticks(1);
        $this->assertNotNull($ta->last('result'));
    }

    public function testFriendlyMatchesDoNotTouchTheRanking(): void
    {
        [$a, $ta] = $this->connect('Alice', self::token('a'));
        [$b, $tb] = $this->connect('Bob');                          // invité : pas de jeton
        $this->say($a, ['t' => 'queue']);
        $this->say($b, ['t' => 'queue']);
        $this->assertFalse($ta->last('match')['ranked']);
        $this->finishMatch($a, $b);
        $this->assertNotNull($ta->last('result'));
        $this->assertArrayNotHasKey('delta', $ta->last('result'));
        $this->assertSame(0, $this->hub->ranking()->ranking->count());
    }

    public function testReservedNicknamesBelongToTheirToken(): void
    {
        [$a, , $b] = $this->startRankedMatch();
        $this->finishMatch($a, $b);
        $this->say($a, ['t' => 'leave']);
        $this->say($b, ['t' => 'leave']);
        $this->hub->disconnect($a);
        $this->hub->disconnect($b);
        [, $t] = $this->connect('Alice', self::token('x'));
        $this->assertSame('name_taken', $t->last('error')['code'], 'un autre jeton ne peut pas prendre Alice');
        [, $g] = $this->connect('Alice');
        $this->assertSame('name_taken', $g->last('error')['code'], 'ni un invité sans jeton');
        [, $ok] = $this->connect('Alice', self::token('Alice'));
        $this->assertNotNull($ok->last('welcome'), 'le propriétaire revient avec son jeton');
        $this->assertNotNull($ok->last('welcome')['rating']);
    }

    public function testRematchStartsANewMatchWhenBothAsk(): void
    {
        [$a, $ta, $b, $tb] = $this->startRankedMatch();
        $this->finishMatch($a, $b);
        $this->assertNotNull($ta->last('result'));
        $this->say($a, ['t' => 'rematch']);
        $this->assertNotNull($tb->last('rematch_ask'));
        $matches = count($ta->of('match'));
        $this->say($b, ['t' => 'rematch']);
        $this->assertCount($matches + 1, $ta->of('match'));
        $this->assertSame(1, $this->hub->matchCount());
        $this->assertSame([0, 0], $ta->last('round')['score'], 'score remis à zéro');
        $this->assertSame([100, 100], $ta->last('round')['hp']);
    }

    public function testRematchWindowClosesAndSendsPlayersBackToTheLobby(): void
    {
        [$a, $ta, $b, $tb] = $this->startRankedMatch();
        $this->finishMatch($a, $b);
        $this->clock->advance(31);
        $this->ticks(1);
        $this->assertNotNull($ta->last('left'));
        $this->assertNotNull($tb->last('left'));
        $this->assertSame(ClientStatus::Lobby, $a->status);
        $this->assertSame(0, $this->hub->matchCount());
        $this->say($a, ['t' => 'rematch']);
        $this->assertCount(1, $ta->of('match'), 'plus de revanche possible');
    }

    public function testRoundsFollowOneAnotherUntilTheTargetIsReached(): void
    {
        $this->hub = $this->makeHub(target: 2);
        [$a, $ta, $b] = $this->startRankedMatch();
        $starter = $this->active($a, $b);
        $this->fireWinning($starter);
        $this->assertSame(1, array_sum($ta->last('shot')['score']));
        $this->clock->advance(60);
        $this->ticks(1);
        $this->assertNull($ta->last('result'), 'la partie continue jusqu\'à 2 manches');
        $second = $ta->last('round');
        $this->assertSame(2, $second['n']);
        $this->assertSame([100, 100], $second['hp'], 'châteaux remis à neuf');
        $this->assertNotSame($starter->room?->sideOf($starter)?->value, $second['turn'], 'l\'autre camp commence');
        $this->say($this->active($a, $b), ['t' => 'fire', 'a' => 45, 'p' => 100]);     // il tire dans le sol
        $this->clock->advance(30);
        $this->ticks(1);
        $this->assertSame($starter, $this->active($a, $b));
        $this->fireWinning($starter);
        $this->clock->advance(60);
        $this->ticks(1);
        $result = $ta->last('result');
        $this->assertNotNull($result);
        $this->assertSame([2, 0], $result['score'][0] === 2 ? [2, 0] : [0, 2]);
        $this->assertSame($starter->room?->sideOf($starter)?->value, $result['winner']);
    }

    public function testHealthModeNeedsSeveralHitsToDestroyACastle(): void
    {
        $this->hub = $this->makeHub(target: 1, mode: Mode::Health);
        [$a, $ta, $b] = $this->startRankedMatch();
        $this->assertSame('health', $ta->last('match')['mode']);
        $gunner = $this->active($a, $b);
        $victimSide = $gunner->room?->sideOf($gunner)?->opposite()->value ?? 0;
        $expected = [66, 32, 0];
        foreach ($expected as $i => $hp) {
            $this->fireWinning($gunner);
            $shot = $ta->last('shot');
            $this->assertSame($hp, $shot['hp'][$victimSide], 'santé après l\'impact ' . ($i + 1));
            $this->assertSame($i === 2, $shot['over'], 'la manche ne finit qu\'au troisième impact');
            $this->clock->advance(60);
            $this->ticks(1);
            if ($i < 2) {
                $this->say($this->active($a, $b), ['t' => 'fire', 'a' => 45, 'p' => 100]);     // l\'adversaire tire dans le sol
                $this->clock->advance(30);
                $this->ticks(1);
            }
        }
        $this->assertNotNull($ta->last('result'));
    }

    /** Laisse le temps de réglage du joueur actif expirer, puis l'animation du tir d'office se terminer. */
    private function letTurnExpire(): void
    {
        $this->clock->advance(46);
        $this->ticks(1);
    }

    private function letFlightEnd(): void
    {
        $this->clock->advance(30);
        $this->ticks(1);
    }

    public function testAnExpiredTurnFiresTheLastSettings(): void
    {
        [$a, $ta, $b] = $this->startRankedMatch();
        $slow = $this->active($a, $b);
        $this->letTurnExpire();
        $shot = $ta->last('shot');
        $this->assertNotNull($shot, 'tir d\'office');
        $this->assertSame([45, 200], [$shot['a'], $shot['p']], 'réglage par défaut');
        $this->assertSame($slow->room?->sideOf($slow)?->value, $shot['by']);
        $this->letFlightEnd();
        $this->assertNotNull($ta->last('turn'), 'puis c\'est à l\'autre');
    }

    public function testLettingTwoTurnsExpireInARowForfeitsTheMatch(): void
    {
        [$a, $ta, $b, $tb] = $this->startRankedMatch();
        $slow = $this->active($a, $b);
        $this->letTurnExpire();
        $this->letFlightEnd();
        $this->say($this->active($a, $b), ['t' => 'fire', 'a' => 45, 'p' => 100]);       // l'autre joue normalement
        $this->letFlightEnd();
        $this->assertSame($slow, $this->active($a, $b));
        $this->letTurnExpire();
        $result = $ta->last('result');
        $this->assertNotNull($result);
        $this->assertTrue($result['forfeit']);
        $this->assertSame($slow->room?->sideOf($slow)?->opposite()->value, $result['winner']);
        $this->assertNotNull($tb->last('result'));
    }

    public function testPlayingInBetweenResetsTheExpiryCounter(): void
    {
        [$a, $ta, $b] = $this->startRankedMatch();
        $this->letTurnExpire();
        $this->letFlightEnd();
        $this->say($this->active($a, $b), ['t' => 'fire', 'a' => 45, 'p' => 100]);
        $this->letFlightEnd();
        $this->say($this->active($a, $b), ['t' => 'fire', 'a' => 45, 'p' => 100]);       // le lent se réveille
        $this->letFlightEnd();
        $this->say($this->active($a, $b), ['t' => 'fire', 'a' => 45, 'p' => 100]);
        $this->letFlightEnd();
        $this->letTurnExpire();
        $this->assertNull($ta->last('result'), 'un seul tour expiré depuis qu\'il a rejoué');
    }

    public function testMatchServiceConstantsAreSane(): void
    {
        $this->assertGreaterThanOrEqual(2, MatchService::MAX_IDLE_TURNS);
        $this->assertGreaterThan(0, MatchService::PLAYBACK_PAUSE);
    }

    public function testPlayersOnTheSameAddressPlayAFriendlyMatchWithAReason(): void
    {
        [$a, $ta] = $this->connect('Alice', self::token('a'), '198.51.100.5');
        [$b, $tb] = $this->connect('Bob', self::token('b'), '198.51.100.5');
        $this->say($a, ['t' => 'queue']);
        $this->say($b, ['t' => 'queue']);
        $this->assertFalse($ta->last('match')['ranked']);
        $this->assertSame('same_ip', $ta->last('match')['why']);
        $this->assertSame('same_ip', $tb->last('match')['why']);
    }

    public function testPlayersOnDifferentAddressesAreRankedWithoutAnyReason(): void
    {
        [$a, $ta] = $this->connect('Alice', self::token('a'), '198.51.100.5');
        [$b] = $this->connect('Bob', self::token('b'), '198.51.100.6');
        $this->say($a, ['t' => 'queue']);
        $this->say($b, ['t' => 'queue']);
        $this->assertTrue($ta->last('match')['ranked']);
        $this->assertArrayNotHasKey('why', $ta->last('match'));
    }

    public function testAMatchWithoutAnyKnownAddressIsNeverRefused(): void
    {
        $ta = new FakeTransport();
        $tb = new FakeTransport();
        $a = $this->hub->accept($ta);
        $b = $this->hub->accept($tb);
        $this->say($a, ['t' => 'hello', 'name' => 'Alice', 'token' => self::token('a')]);
        $this->say($b, ['t' => 'hello', 'name' => 'Bob', 'token' => self::token('b')]);
        $this->say($a, ['t' => 'queue']);
        $this->say($b, ['t' => 'queue']);
        $this->assertTrue($ta->last('match')['ranked']);
    }

    public function testAFourthAccountFromOneAddressIsNotRanked(): void
    {
        $results = [];
        for ($i = 1; $i <= 4; $i++) {
            [$a, $ta] = $this->connect("Farm$i", self::token("farm$i"), '198.51.100.50');
            [$b] = $this->connect("Real$i", self::token("real$i"), "198.51.100.1$i");
            $this->say($a, ['t' => 'queue']);
            $this->say($b, ['t' => 'queue']);
            $results[] = [$ta->last('match')['ranked'], $ta->last('match')['why'] ?? null];
            $this->hub->disconnect($a);
            $this->hub->disconnect($b);
        }
        $this->assertSame([[true, null], [true, null], [true, null], [false, 'too_many_accounts']], $results);
    }

    public function testTwoAddressesCannotSwapVictoriesMoreThanAFewTimesEvenAfterReconnecting(): void
    {
        $results = [];
        for ($i = 1; $i <= 5; $i++) {
            [$a, $ta] = $this->connect('Alice', self::token('a'), '198.51.100.7');
            [$b] = $this->connect('Bob', self::token('b'), '198.51.100.8');
            $this->say($a, ['t' => 'queue']);
            $this->say($b, ['t' => 'queue']);
            $results[] = $ta->last('match')['why'] ?? 'ranked';
            $this->hub->disconnect($a);
            $this->hub->disconnect($b);
        }
        $this->assertSame(['ranked', 'ranked', 'ranked', 'ranked', 'pair_limit'], $results);
    }

    public function testAClientKnowsItsAddressOnceTheServerHasResolvedIt(): void
    {
        [$a] = $this->connect('Alice', null, '203.0.113.99');
        $this->assertSame('203.0.113.99', $a->ip);
    }
}
