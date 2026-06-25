<?php
// New Issue Bot — paper-trading API (MySQL-backed).
// Actions: get | open | close | reset | import
require __DIR__ . '/config.php';

header('Content-Type: application/json');
header('Access-Control-Allow-Origin: *');
header('Access-Control-Allow-Methods: GET, POST, OPTIONS');
header('Access-Control-Allow-Headers: Content-Type, X-Api-Token');
if ($_SERVER['REQUEST_METHOD'] === 'OPTIONS') { exit; }

$raw  = file_get_contents('php://input');
$body = json_decode($raw, true);
if (!is_array($body)) $body = [];

$token = $_GET['token'] ?? $body['token'] ?? ($_SERVER['HTTP_X_API_TOKEN'] ?? '');
if (!hash_equals($API_TOKEN, (string)$token)) {
    http_response_code(401);
    echo json_encode(['error' => 'unauthorized']);
    exit;
}

$action = $_GET['action'] ?? $body['action'] ?? 'get';
$inst   = $_GET['instrument'] ?? $body['instrument'] ?? 'nifty';
if ($inst !== 'gold' && $inst !== 'nifty') $inst = 'nifty';

function ensure_account($pdo, $inst) {
    $s = $pdo->prepare('SELECT cash, beginning FROM accounts WHERE instrument=?');
    $s->execute([$inst]);
    $a = $s->fetch();
    if (!$a) {
        $pdo->prepare('INSERT INTO accounts(instrument,cash,beginning) VALUES(?,1000000,1000000)')
            ->execute([$inst]);
        return ['cash' => 1000000.0, 'starting' => 1000000.0];
    }
    return ['cash' => (float)$a['cash'], 'starting' => (float)$a['beginning']];
}
function fnum($v) { return $v === null ? null : (float)$v; }
function map_pos($r) {
    return ['id'=>$r['id'],'side'=>$r['side'],'qty'=>(float)$r['qty'],'entry'=>(float)$r['entry'],
        'sl'=>fnum($r['sl']),'target'=>fnum($r['target']),'openedAt'=>(int)$r['opened_at']];
}
function map_trade($r) {
    return ['id'=>$r['id'],'side'=>$r['side'],'qty'=>(float)$r['qty'],'entry'=>(float)$r['entry'],
        'sl'=>fnum($r['sl']),'target'=>fnum($r['target']),'openedAt'=>(int)$r['opened_at'],
        'exit'=>(float)$r['exit'],'closedAt'=>(int)$r['closed_at'],'pnl'=>(float)$r['pnl'],'reason'=>$r['reason']];
}
function state($pdo, $inst) {
    $acc = ensure_account($pdo, $inst);
    $p = $pdo->prepare('SELECT * FROM positions WHERE instrument=? ORDER BY opened_at DESC');
    $p->execute([$inst]);
    $t = $pdo->prepare('SELECT * FROM trades WHERE instrument=? ORDER BY closed_at DESC LIMIT 300');
    $t->execute([$inst]);
    return [
        'instrument' => $inst,
        'cash' => $acc['cash'],
        'starting' => $acc['starting'],
        'positions' => array_map('map_pos', $p->fetchAll()),
        'history' => array_map('map_trade', $t->fetchAll()),
    ];
}

try {
    if ($action === 'get') {
        echo json_encode(state($pdo, $inst));
    } elseif ($action === 'open') {
        ensure_account($pdo, $inst);
        $p = $body['position'] ?? [];
        $pdo->prepare('INSERT INTO positions(id,instrument,side,qty,entry,sl,target,opened_at) VALUES(?,?,?,?,?,?,?,?)')
            ->execute([$p['id'], $inst, $p['side'], $p['qty'], $p['entry'],
                $p['sl'] ?? null, $p['target'] ?? null, $p['openedAt']]);
        $pdo->prepare('UPDATE accounts SET cash=? WHERE instrument=?')->execute([(float)$body['cash'], $inst]);
        echo json_encode(state($pdo, $inst));
    } elseif ($action === 'close') {
        ensure_account($pdo, $inst);
        $t = $body['trade'] ?? [];
        $pdo->prepare('DELETE FROM positions WHERE id=? AND instrument=?')->execute([$t['id'], $inst]);
        $pdo->prepare('INSERT INTO trades(id,instrument,side,qty,entry,sl,target,opened_at,`exit`,closed_at,pnl,reason)
            VALUES(?,?,?,?,?,?,?,?,?,?,?,?) ON DUPLICATE KEY UPDATE `exit`=VALUES(`exit`), pnl=VALUES(pnl)')
            ->execute([$t['id'], $inst, $t['side'], $t['qty'], $t['entry'], $t['sl'] ?? null,
                $t['target'] ?? null, $t['openedAt'], $t['exit'], $t['closedAt'], $t['pnl'], $t['reason']]);
        $pdo->prepare('UPDATE accounts SET cash=? WHERE instrument=?')->execute([(float)$body['cash'], $inst]);
        echo json_encode(state($pdo, $inst));
    } elseif ($action === 'reset') {
        ensure_account($pdo, $inst);
        $pdo->prepare('DELETE FROM positions WHERE instrument=?')->execute([$inst]);
        $pdo->prepare('DELETE FROM trades WHERE instrument=?')->execute([$inst]);
        $pdo->prepare('UPDATE accounts SET cash=beginning WHERE instrument=?')->execute([$inst]);
        echo json_encode(state($pdo, $inst));
    } elseif ($action === 'import') {
        $acc = $body['account'] ?? [];
        ensure_account($pdo, $inst);
        $pdo->beginTransaction();
        $pdo->prepare('DELETE FROM positions WHERE instrument=?')->execute([$inst]);
        $pdo->prepare('DELETE FROM trades WHERE instrument=?')->execute([$inst]);
        $cash = isset($acc['cash']) ? (float)$acc['cash'] : 1000000;
        $starting = isset($acc['starting']) ? (float)$acc['starting'] : 1000000;
        $pdo->prepare('UPDATE accounts SET cash=?, beginning=? WHERE instrument=?')->execute([$cash, $starting, $inst]);
        $pi = $pdo->prepare('INSERT INTO positions(id,instrument,side,qty,entry,sl,target,opened_at) VALUES(?,?,?,?,?,?,?,?)');
        foreach (($acc['positions'] ?? []) as $p) {
            $pi->execute([$p['id'] ?? uniqid('p', true), $inst, $p['side'], $p['qty'], $p['entry'],
                $p['sl'] ?? null, $p['target'] ?? null, $p['openedAt'] ?? 0]);
        }
        $ti = $pdo->prepare('INSERT IGNORE INTO trades(id,instrument,side,qty,entry,sl,target,opened_at,`exit`,closed_at,pnl,reason)
            VALUES(?,?,?,?,?,?,?,?,?,?,?,?)');
        foreach (($acc['history'] ?? []) as $t) {
            $ti->execute([$t['id'] ?? uniqid('t', true), $inst, $t['side'], $t['qty'], $t['entry'],
                $t['sl'] ?? null, $t['target'] ?? null, $t['openedAt'] ?? 0,
                $t['exit'] ?? 0, $t['closedAt'] ?? 0, $t['pnl'] ?? 0, $t['reason'] ?? 'Manual']);
        }
        $pdo->commit();
        echo json_encode(state($pdo, $inst));
    } elseif ($action === 'alert_add') {
        $id = $body['id'] ?? uniqid('a', true);
        $email = trim((string)($body['email'] ?? ''));
        $threshold = (float)($body['threshold'] ?? 0);
        $dir = ($body['direction'] ?? 'above') === 'below' ? 'below' : 'above';
        if (!filter_var($email, FILTER_VALIDATE_EMAIL) || $threshold <= 0) {
            http_response_code(400);
            echo json_encode(['error' => 'invalid_alert']);
        } else {
            $pdo->prepare('INSERT INTO alerts(id,instrument,email,threshold,direction,created_at,triggered)
                VALUES(?,?,?,?,?,?,0)')
                ->execute([$id, $inst, $email, $threshold, $dir, round(microtime(true) * 1000)]);
            echo json_encode(['ok' => true, 'id' => $id]);
        }
    } elseif ($action === 'alert_active') {
        $rows = $pdo->query('SELECT * FROM alerts WHERE triggered=0')->fetchAll();
        $alerts = array_map(function ($r) {
            return ['id' => $r['id'], 'instrument' => $r['instrument'], 'email' => $r['email'],
                'threshold' => (float)$r['threshold'], 'direction' => $r['direction']];
        }, $rows);
        echo json_encode(['alerts' => $alerts]);
    } elseif ($action === 'alert_trigger') {
        $id = (string)($body['id'] ?? '');
        $price = (float)($body['price'] ?? 0);
        $s = $pdo->prepare('SELECT * FROM alerts WHERE id=? AND triggered=0');
        $s->execute([$id]);
        $a = $s->fetch();
        if ($a) {
            $name = $a['instrument'] === 'gold' ? 'Gold' : 'Nifty 50';
            $dir = $a['direction'] === 'above' ? 'risen above' : 'dropped below';
            $subject = "New Issue Bot alert: $name has $dir " . $a['threshold'];
            $msg = "Your $name price alert has triggered.\n\n"
                . "$name is now $price.\n"
                . "It has $dir your alert level of " . $a['threshold'] . ".\n\n"
                . "— New Issue Bot";
            $headers = "From: New Issue Bot <alerts@puthibharal.com>\r\n"
                . "Content-Type: text/plain; charset=utf-8\r\n";
            @mail($a['email'], $subject, $msg, $headers);
            $pdo->prepare('UPDATE alerts SET triggered=1, triggered_at=? WHERE id=?')
                ->execute([round(microtime(true) * 1000), $id]);
            echo json_encode(['ok' => true]);
        } else {
            echo json_encode(['ok' => false]);
        }
    } else {
        http_response_code(400);
        echo json_encode(['error' => 'unknown_action']);
    }
} catch (Throwable $e) {
    if ($pdo->inTransaction()) $pdo->rollBack();
    http_response_code(500);
    echo json_encode(['error' => 'server_error', 'detail' => $e->getMessage()]);
}
