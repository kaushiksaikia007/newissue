<?php
// New Issue Bot — authentication API (MySQL-backed).
// Actions: signup_start | signup_verify | login | me | logout
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

$action = $_GET['action'] ?? $body['action'] ?? '';

function fail($code, $msg) {
    http_response_code($code);
    echo json_encode(['error' => $msg]);
    exit;
}
function new_session($pdo, $userId) {
    $tok = bin2hex(random_bytes(32));
    $pdo->prepare('INSERT INTO sessions(token, user_id, created_at) VALUES(?,?,?)')
        ->execute([$tok, $userId, round(microtime(true) * 1000)]);
    return $tok;
}
function user_public($u) {
    return ['id' => (int)$u['id'], 'name' => $u['name'], 'email' => $u['email']];
}
function send_otp($email, $name, $otp) {
    $subject = "Your New Issue Bot verification code: $otp";
    $msg = "Hi $name,\n\n"
        . "Your New Issue Bot verification code is:\n\n"
        . "    $otp\n\n"
        . "Enter this code to finish creating your account. "
        . "It expires in 10 minutes.\n\n"
        . "If you didn't request this, you can ignore this email.\n\n"
        . "— New Issue Bot";
    $headers = "From: New Issue Bot <no-reply@puthibharal.com>\r\n"
        . "Content-Type: text/plain; charset=utf-8\r\n";
    @mail($email, $subject, $msg, $headers);
}

try {
    if ($action === 'signup_start') {
        $name  = trim((string)($body['name'] ?? ''));
        $email = strtolower(trim((string)($body['email'] ?? '')));
        $pass  = (string)($body['password'] ?? '');
        if ($name === '' || mb_strlen($name) < 2) fail(400, 'invalid_name');
        if (!filter_var($email, FILTER_VALIDATE_EMAIL)) fail(400, 'invalid_email');
        if (strlen($pass) < 6) fail(400, 'weak_password');

        $s = $pdo->prepare('SELECT id FROM users WHERE email=?');
        $s->execute([$email]);
        if ($s->fetch()) fail(409, 'email_taken');

        $otp = str_pad((string)random_int(0, 999999), 6, '0', STR_PAD_LEFT);
        $hash = password_hash($pass, PASSWORD_DEFAULT);
        $expires = round(microtime(true) * 1000) + 10 * 60 * 1000;
        $pdo->prepare('REPLACE INTO pending_signups(email,name,pass_hash,otp,expires_at,attempts)
            VALUES(?,?,?,?,?,0)')->execute([$email, $name, $hash, $otp, $expires]);
        send_otp($email, $name, $otp);
        echo json_encode(['ok' => true]);

    } elseif ($action === 'signup_verify') {
        $email = strtolower(trim((string)($body['email'] ?? '')));
        $otp   = trim((string)($body['otp'] ?? ''));
        $s = $pdo->prepare('SELECT * FROM pending_signups WHERE email=?');
        $s->execute([$email]);
        $p = $s->fetch();
        if (!$p) fail(400, 'no_pending');
        if ((int)$p['attempts'] >= 5) { $pdo->prepare('DELETE FROM pending_signups WHERE email=?')->execute([$email]); fail(429, 'too_many_attempts'); }
        if ((float)$p['expires_at'] < microtime(true) * 1000) { $pdo->prepare('DELETE FROM pending_signups WHERE email=?')->execute([$email]); fail(410, 'otp_expired'); }
        if (!hash_equals((string)$p['otp'], $otp)) {
            $pdo->prepare('UPDATE pending_signups SET attempts=attempts+1 WHERE email=?')->execute([$email]);
            fail(400, 'wrong_otp');
        }
        // Guard against a race where the email got registered meanwhile.
        $u = $pdo->prepare('SELECT id FROM users WHERE email=?');
        $u->execute([$email]);
        if ($u->fetch()) { $pdo->prepare('DELETE FROM pending_signups WHERE email=?')->execute([$email]); fail(409, 'email_taken'); }

        $pdo->prepare('INSERT INTO users(name,email,pass_hash,created_at) VALUES(?,?,?,?)')
            ->execute([$p['name'], $email, $p['pass_hash'], round(microtime(true) * 1000)]);
        $id = (int)$pdo->lastInsertId();
        $pdo->prepare('DELETE FROM pending_signups WHERE email=?')->execute([$email]);
        $tok = new_session($pdo, $id);
        echo json_encode(['ok' => true, 'token' => $tok,
            'user' => ['id' => $id, 'name' => $p['name'], 'email' => $email]]);

    } elseif ($action === 'login') {
        $email = strtolower(trim((string)($body['email'] ?? '')));
        $pass  = (string)($body['password'] ?? '');
        $s = $pdo->prepare('SELECT * FROM users WHERE email=?');
        $s->execute([$email]);
        $u = $s->fetch();
        if (!$u || !password_verify($pass, $u['pass_hash'])) fail(401, 'bad_credentials');
        $tok = new_session($pdo, (int)$u['id']);
        echo json_encode(['ok' => true, 'token' => $tok, 'user' => user_public($u)]);

    } elseif ($action === 'me') {
        $sess = (string)($body['session'] ?? $_GET['session'] ?? '');
        if ($sess === '') fail(401, 'no_session');
        $s = $pdo->prepare('SELECT u.* FROM sessions s JOIN users u ON u.id=s.user_id WHERE s.token=?');
        $s->execute([$sess]);
        $u = $s->fetch();
        if (!$u) fail(401, 'invalid_session');
        echo json_encode(['ok' => true, 'user' => user_public($u)]);

    } elseif ($action === 'logout') {
        $sess = (string)($body['session'] ?? '');
        if ($sess !== '') $pdo->prepare('DELETE FROM sessions WHERE token=?')->execute([$sess]);
        echo json_encode(['ok' => true]);

    } else {
        fail(400, 'unknown_action');
    }
} catch (Throwable $e) {
    http_response_code(500);
    echo json_encode(['error' => 'server_error', 'detail' => $e->getMessage()]);
}
