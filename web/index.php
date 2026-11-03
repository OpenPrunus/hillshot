<?php

declare(strict_types=1);

// URL WebSocket vue par le navigateur (HILLSHOT_WS) ; vide = même hôte, port 8081 (ou /ws derrière HTTPS).
$ws = (string) getenv('HILLSHOT_WS');
?><!doctype html>
<html lang="fr">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover, user-scalable=no">
  <meta name="theme-color" content="#cfcfcf">
  <title>Hillshot</title>
  <link rel="icon" href="data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 32 32'%3E%3Crect width='32' height='32' fill='%238ec6f5'/%3E%3Cpath d='M0 28Q16 -4 32 28z' fill='%233f9a3f' stroke='%23000'/%3E%3Crect x='2' y='16' width='7' height='10' fill='%239b9b9b' stroke='%23000'/%3E%3C/svg%3E">
  <link rel="stylesheet" href="css/style.css">
  <script>window.HILLSHOT_WS = <?= json_encode($ws, JSON_THROW_ON_ERROR | JSON_HEX_TAG | JSON_HEX_AMP) ?>;</script>
</head>
<body>
  <div id="fit"><div id="mac">
    <div id="menubar">
      <span class="apple" aria-hidden="true">&#9679;</span>
      <div class="menu"><button data-menu="file" data-i18n="mFile"></button>
        <ul hidden>
          <li><button data-action="ai" data-i18n="vsAi"></button></li>
          <li><button data-action="local" data-i18n="local2p"></button></li>
          <li><button data-action="online" data-i18n="online"></button></li>
          <li class="sep"></li>
          <li><button data-action="askQuit" id="menu-quit" data-i18n="quitGame"></button></li>
          <li><button data-action="resetScores" data-i18n="resetScores"></button></li>
          <li><button data-action="leaderboard" data-i18n="leaderboard"></button></li>
        </ul></div>
      <div class="menu"><button data-menu="options" data-i18n="mOptions"></button>
        <ul hidden>
          <li><button data-action="names" data-i18n="names"></button></li>
          <li><button data-action="toggleMode" id="opt-mode"></button></li>
          <li><button data-action="toggleSound" id="opt-sound"></button></li>
          <li><button data-action="toggleLang" id="opt-lang"></button></li>
        </ul></div>
      <div class="menu"><button data-menu="help" data-i18n="mHelp"></button>
        <ul hidden>
          <li><button data-action="help" data-i18n="howTo"></button></li>
          <li><a href="https://games.prunus.dev" data-i18n="allGames"></a></li>
          <li><a href="https://github.com/OpenPrunus/hillshot" target="_blank" rel="noopener noreferrer" data-i18n="github"></a></li>
        </ul></div>
      <span id="ping" class="ping"></span>
    </div>
    <div id="titlebar"><button class="close" data-action="askQuit" data-i18n-aria="quitGame"></button><span class="title">Hillshot 1.0</span></div>

    <div id="stage">
      <canvas id="scene" width="640" height="380" aria-label="Hillshot"></canvas>
      <div id="banner" hidden></div>

      <section id="menu" class="panel">
        <h1 data-i18n="title"></h1>
        <p class="tagline" data-i18n="tagline"></p>
        <div class="stack">
          <button class="btn primary" data-action="ai" data-i18n="vsAi"></button>
          <button class="btn" data-action="local" data-i18n="local2p"></button>
          <button class="btn" data-action="online" data-i18n="online"></button>
        </div>
        <div class="options">
          <label><span data-i18n="level"></span>
            <select id="sel-level">
              <option value="easy" data-i18n="easy"></option>
              <option value="normal" data-i18n="normal" selected></option>
              <option value="hard" data-i18n="hard"></option>
            </select>
          </label>
          <label><span data-i18n="rounds"></span>
            <select id="sel-target"><option>1</option><option>3</option><option selected>5</option><option>7</option></select>
          </label>
        </div>
        <p class="hint" data-i18n="controls"></p>
        <footer class="foot">
          <a class="all" href="https://games.prunus.dev" data-i18n="allGames"></a>
          <a class="gh" href="https://github.com/OpenPrunus/hillshot" target="_blank" rel="noopener noreferrer">
            <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false"><path d="M12 .297c-6.63 0-12 5.373-12 12 0 5.303 3.438 9.8 8.205 11.385.6.113.82-.258.82-.577 0-.285-.01-1.04-.015-2.04-3.338.724-4.042-1.61-4.042-1.61C4.422 18.07 3.633 17.7 3.633 17.7c-1.087-.744.084-.729.084-.729 1.205.084 1.838 1.236 1.838 1.236 1.07 1.835 2.809 1.305 3.495.998.108-.776.417-1.305.76-1.605-2.665-.3-5.466-1.332-5.466-5.93 0-1.31.465-2.38 1.235-3.22-.135-.303-.54-1.523.105-3.176 0 0 1.005-.322 3.3 1.23.96-.267 1.98-.399 3-.405 1.02.006 2.04.138 3 .405 2.28-1.552 3.285-1.23 3.285-1.23.645 1.653.24 2.873.12 3.176.765.84 1.23 1.91 1.23 3.22 0 4.61-2.805 5.625-5.475 5.92.42.36.81 1.096.81 2.22 0 1.606-.015 2.896-.015 3.286 0 .315.21.69.825.57C20.565 22.092 24 17.592 24 12.297c0-6.627-5.373-12-12-12"/></svg>
            <span data-i18n="github"></span>
          </a>
          <span class="license" title="MIT License">MIT</span>
        </footer>
      </section>

      <section id="online" class="panel wide" hidden>
        <h2 data-i18n="online"></h2>
        <p id="online-status" class="status"></p>
        <form id="join" class="row">
          <input id="nick" maxlength="15" autocomplete="off" spellcheck="false" data-i18n-placeholder="nicknamePlaceholder">
          <button class="btn primary" type="submit" data-i18n="online"></button>
        </form>
        <div id="lobby" hidden>
          <div class="row">
            <button class="btn primary" id="quick" data-i18n="quickMatch"></button>
            <span id="my-rating" class="badge"></span>
          </div>
          <h3 data-i18n="lobby"></h3>
          <ul id="players" class="list"></ul>
          <h3 data-i18n="leaderboard"></h3>
          <table class="board"><thead><tr><th data-i18n="rank"></th><th data-i18n="name"></th><th data-i18n="elo"></th><th data-i18n="wl"></th></tr></thead><tbody id="board"></tbody></table>
        </div>
        <div id="invite" class="toast" hidden>
          <span id="invite-text"></span>
          <button class="btn small primary" id="invite-accept" data-i18n="accept"></button>
          <button class="btn small" id="invite-decline" data-i18n="decline"></button>
        </div>
        <button class="btn small" id="online-back" data-i18n="back"></button>
      </section>

      <section id="names-dialog" class="panel small" hidden>
        <h2 data-i18n="names"></h2>
        <form id="names-form" class="stack">
          <label class="field"><span data-i18n="player1"></span><input id="name1" maxlength="15" autocomplete="off"></label>
          <label class="field"><span data-i18n="player2"></span><input id="name2" maxlength="15" autocomplete="off"></label>
          <button class="btn primary" type="submit" data-i18n="ok"></button>
        </form>
      </section>

      <section id="help" class="panel" hidden>
        <h2 data-i18n="howTo"></h2>
        <p class="left" data-i18n="rules1"></p>
        <p class="left" data-i18n="rules2"></p>
        <p class="left" data-i18n="rules3"></p>
        <p class="left" data-i18n="keys"></p>
        <button class="btn small" data-action="closeHelp" data-i18n="ok"></button>
      </section>

      <section id="leaders" class="panel wide" hidden>
        <h2 data-i18n="leaderboard"></h2>
        <table class="board"><thead><tr><th data-i18n="rank"></th><th data-i18n="name"></th><th data-i18n="elo"></th><th data-i18n="wl"></th></tr></thead><tbody id="board-menu"></tbody></table>
        <p class="hint" data-i18n="leadersHint"></p>
        <button class="btn small" data-action="closeLeaders" data-i18n="ok"></button>
      </section>

      <section id="quit-dialog" class="panel small" hidden>
        <h2 data-i18n="quitGame"></h2>
        <p id="quit-text" class="status"></p>
        <div class="stack">
          <button class="btn primary" data-action="quit" data-i18n="yes"></button>
          <button class="btn" data-action="cancelQuit" data-i18n="no"></button>
        </div>
      </section>

      <section id="over" class="panel small" hidden>
        <h2 id="over-title"></h2>
        <p id="over-detail" class="status"></p>
        <div class="stack">
          <button class="btn primary" id="over-again"></button>
          <button class="btn" data-action="quit" data-i18n="menu"></button>
        </div>
      </section>
    </div>

    <div id="panel">
      <div class="col" data-p="0">
        <div class="lbl" data-i18n="angle"></div>
        <div class="spin"><button class="step" data-k="angle" data-d="1" aria-label="+">&#9650;</button><input class="val" id="v-angle-0" type="text" inputmode="numeric" pattern="[0-9]*" maxlength="3" autocomplete="off" spellcheck="false" value="45" data-i18n-aria="angle"><button class="step" data-k="angle" data-d="-1" aria-label="-">&#9660;</button></div>
        <canvas class="thumb" id="t-angle-0" width="46" height="46"></canvas>
      </div>
      <div class="col" data-p="0">
        <div class="lbl" data-i18n="powder"></div>
        <div class="spin"><button class="step" data-k="powder" data-d="1" aria-label="+">&#9650;</button><input class="val" id="v-powder-0" type="text" inputmode="numeric" pattern="[0-9]*" maxlength="3" autocomplete="off" spellcheck="false" value="150" data-i18n-aria="powder"><button class="step" data-k="powder" data-d="-1" aria-label="-">&#9660;</button></div>
        <canvas class="thumb" id="t-powder-0" width="46" height="46"></canvas>
      </div>
      <div id="center">
        <div class="scores"><span id="hp-0" class="hp"></span><b id="score-0">0</b><span class="dash">:</span><b id="score-1">0</b><span id="hp-1" class="hp"></span></div>
        <div class="names"><span id="name-0"></span><span id="name-1"></span></div>
        <button id="fire" class="mac-btn" data-i18n="fire"></button>
        <div id="turn-info" class="turn"></div>
        <canvas id="wind" width="90" height="22" aria-label="Wind"></canvas>
      </div>
      <div class="col" data-p="1">
        <div class="lbl" data-i18n="powder"></div>
        <div class="spin"><button class="step" data-k="powder" data-d="1" aria-label="+">&#9650;</button><input class="val" id="v-powder-1" type="text" inputmode="numeric" pattern="[0-9]*" maxlength="3" autocomplete="off" spellcheck="false" value="150" data-i18n-aria="powder"><button class="step" data-k="powder" data-d="-1" aria-label="-">&#9660;</button></div>
        <canvas class="thumb" id="t-powder-1" width="46" height="46"></canvas>
      </div>
      <div class="col" data-p="1">
        <div class="lbl" data-i18n="angle"></div>
        <div class="spin"><button class="step" data-k="angle" data-d="1" aria-label="+">&#9650;</button><input class="val" id="v-angle-1" type="text" inputmode="numeric" pattern="[0-9]*" maxlength="3" autocomplete="off" spellcheck="false" value="45" data-i18n-aria="angle"><button class="step" data-k="angle" data-d="-1" aria-label="-">&#9660;</button></div>
        <canvas class="thumb" id="t-angle-1" width="46" height="46"></canvas>
      </div>
    </div>
  </div></div>
  <script type="module" src="js/main.js"></script>
</body>
</html>
