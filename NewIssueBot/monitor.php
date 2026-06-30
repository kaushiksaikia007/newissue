<?php
// ---------------------------------------------------------------------------
// New Issue Bot — 24/7 price monitor.
//
// Run from the always-on host via cron every minute. To get sub-minute checks
// without a sub-minute cron, each run loops internally (ITERATIONS x SLEEP_SECS
// ~= 60s), so targets are checked roughly every 12 seconds.
//
// It is browser-independent: it uses the website only as a price source
// (SITE_URL/api/prices, the same TradingView feed the UI shows), then:
//   - emails the user when a watchlist target price is hit, and
//   - auto-closes paper-trading positions that reach their stop-loss / target.
//
// cPanel -> Cron Jobs, every minute:
//   php /home/u773805129/public_html/NewIssueBot/monitor.php >/dev/null 2>&1
// (adjust the path to wherever this folder lives on your host)
// ---------------------------------------------------------------------------

require __DIR__ . '/config.php';

// When triggered over HTTP (some hosts only do URL crons) require the token.
if (php_sapi_name() !== 'cli') {
    $t = $_GET['token'] ?? '';
    if (!hash_equals($API_TOKEN, (string)$t)) {
        http_response_code(401);
        exit('unauthorized');
    }
    header('Content-Type: text/plain');
}

@set_time_limit(0);
ignore_user_abort(true);

const ITERATIONS = 11;  // checks per run
const SLEEP_SECS = 5;   // gap between checks (11 x 5 ~= 55s, then the next cron fires)

// Single-flight: skip if a previous run (which spans ~1 min) is still going.
$lock = @fopen(sys_get_temp_dir() . '/nib_monitor.lock', 'c');
if ($lock && !flock($lock, LOCK_EX | LOCK_NB)) {
    exit("busy\n");
}

/** Read live prices for a set of keys from the website's /api/prices. */
function fetch_prices(string $siteUrl, string $token, array $keys): array {
    if ($siteUrl === '' || !$keys) return [];
    $url = rtrim($siteUrl, '/') . '/api/prices?token=' . urlencode($token)
        . '&keys=' . urlencode(implode(',', $keys));
    $ch = curl_init($url);
    curl_setopt_array($ch, [
        CURLOPT_RETURNTRANSFER => true,
        CURLOPT_TIMEOUT        => 20,
        CURLOPT_FOLLOWLOCATION => true,
        CURLOPT_HTTPHEADER     => ['Accept: application/json'],
    ]);
    $out = curl_exec($ch);
    curl_close($ch);
    if (!$out) return [];
    $j = json_decode($out, true);
    return is_array($j) && isset($j['prices']) && is_array($j['prices']) ? $j['prices'] : [];
}

/** Close a paper position at $exit, recording the trade and refunding cash. */
function close_paper_position(PDO $pdo, array $p, float $exit, string $reason): void {
    $entry = (float)$p['entry'];
    $qty   = (float)$p['qty'];
    $pnl   = $p['side'] === 'buy' ? ($exit - $entry) * $qty : ($entry - $exit) * $qty;
    $pnl   = round($pnl * 100) / 100;
    $now   = (int) round(microtime(true) * 1000);
    $pdo->beginTransaction();
    try {
        $pdo->prepare('DELETE FROM positions WHERE id=?')->execute([$p['id']]);
        $pdo->prepare('INSERT INTO trades(id,instrument,side,qty,entry,sl,target,opened_at,`exit`,closed_at,pnl,reason)
            VALUES(?,?,?,?,?,?,?,?,?,?,?,?)')
            ->execute([$p['id'], $p['instrument'], $p['side'], $qty, $entry,
                $p['sl'], $p['target'], $p['opened_at'],
                round($exit * 100) / 100, $now, $pnl, $reason]);
        $pdo->prepare('UPDATE accounts SET cash = cash + ? WHERE instrument=?')
            ->execute([$entry * $qty + $pnl, $p['instrument']]);
        $pdo->commit();
    } catch (Throwable $e) {
        if ($pdo->inTransaction()) $pdo->rollBack();
    }
}

/** One monitoring pass over all armed watchlist targets + open paper positions. */
function run_tick(PDO $pdo, string $siteUrl, string $token): void {
    $watch     = $pdo->query('SELECT * FROM watchlist WHERE target IS NOT NULL AND triggered=0')->fetchAll();
    $positions = $pdo->query('SELECT * FROM positions')->fetchAll();
    if (!$watch && !$positions) return;

    // Unique price keys: TradingView symbols + paper instruments.
    $keys = [];
    foreach ($watch as $w)     $keys[$w['symbol']] = true;
    foreach ($positions as $p) $keys[$p['instrument']] = true;
    $prices = fetch_prices($siteUrl, $token, array_keys($keys));
    if (!$prices) return;

    // --- Watchlist target-price alerts ---
    foreach ($watch as $w) {
        if (!array_key_exists($w['symbol'], $prices) || $prices[$w['symbol']] === null) continue;
        $price  = (float)$prices[$w['symbol']];
        $target = (float)$w['target'];
        $hit    = $w['direction'] === 'below' ? $price <= $target : $price >= $target;
        if (!$hit) continue;

        // Claim the trigger atomically so we email exactly once.
        $upd = $pdo->prepare('UPDATE watchlist SET triggered=1, triggered_at=? WHERE id=? AND triggered=0');
        $upd->execute([(int) round(microtime(true) * 1000), $w['id']]);
        if ($upd->rowCount() !== 1) continue;

        $dir  = $w['direction'] === 'below' ? 'dropped below' : 'risen above';
        $name = $w['display'] ?: $w['symbol'];
        $rp   = round($price * 100) / 100;
        $subject = "New Issue Bot watchlist alert: $name has $dir " . $w['target'];
        $msg = "Your watchlist price alert has triggered.\n\n"
            . "$name (" . $w['symbol'] . ") is now $rp.\n"
            . "It has $dir your target of " . $w['target'] . ".\n\n— New Issue Bot";
        $headers = "From: New Issue Bot <alerts@puthibharal.com>\r\n"
            . "Content-Type: text/plain; charset=utf-8\r\n";
        @mail($w['email'], $subject, $msg, $headers);
    }

    // --- Paper-trading stop-loss / target auto-close ---
    foreach ($positions as $p) {
        if (!array_key_exists($p['instrument'], $prices) || $prices[$p['instrument']] === null) continue;
        $price = (float)$prices[$p['instrument']];
        $sl = $p['sl'] !== null ? (float)$p['sl'] : null;
        $tg = $p['target'] !== null ? (float)$p['target'] : null;
        if ($p['side'] === 'buy') {
            if ($sl !== null && $price <= $sl)      close_paper_position($pdo, $p, $sl, 'Stop-loss');
            elseif ($tg !== null && $price >= $tg)  close_paper_position($pdo, $p, $tg, 'Target');
        } else {
            if ($sl !== null && $price >= $sl)      close_paper_position($pdo, $p, $sl, 'Stop-loss');
            elseif ($tg !== null && $price <= $tg)  close_paper_position($pdo, $p, $tg, 'Target');
        }
    }
}

for ($i = 0; $i < ITERATIONS; $i++) {
    try {
        run_tick($pdo, $SITE_URL, $MONITOR_TOKEN);
    } catch (Throwable $e) {
        // Keep looping; a transient DB/price hiccup shouldn't kill the run.
    }
    if ($i < ITERATIONS - 1) sleep(SLEEP_SECS);
}

echo "ok\n";
