<?php
// ---------------------------------------------------------------------------
// New Issue Bot — paper-trading DB connection + table bootstrap.
// Upload this folder to your hosting so it is reachable at:
//   https://puthibharal.com/NewIssueBot/
// ---------------------------------------------------------------------------

$DB_HOST = 'localhost';
$DB_NAME = 'u773805129_newissue';
$DB_USER = 'u773805129_newissue';
$DB_PASS = 'Pnlmasters@456';

// Shared secret — MUST match PAPER_API_TOKEN in the Next.js .env.local file.
$API_TOKEN = 'nib_a7f3c9e21b8d4056ab12cd34ef56';

try {
    $pdo = new PDO(
        "mysql:host=$DB_HOST;dbname=$DB_NAME;charset=utf8mb4",
        $DB_USER,
        $DB_PASS,
        [
            PDO::ATTR_ERRMODE => PDO::ERRMODE_EXCEPTION,
            PDO::ATTR_DEFAULT_FETCH_MODE => PDO::FETCH_ASSOC,
        ]
    );
} catch (Throwable $e) {
    http_response_code(500);
    header('Content-Type: application/json');
    echo json_encode(['error' => 'db_connection_failed']);
    exit;
}

// Auto-create the tables on first run. ("starting" and "exit" are MySQL
// reserved words, so we use "beginning" / backtick `exit`.)
try {
$pdo->exec("CREATE TABLE IF NOT EXISTS accounts (
    instrument VARCHAR(16) PRIMARY KEY,
    cash DOUBLE NOT NULL,
    beginning DOUBLE NOT NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4");

$pdo->exec("CREATE TABLE IF NOT EXISTS positions (
    id VARCHAR(40) PRIMARY KEY,
    instrument VARCHAR(16) NOT NULL,
    side VARCHAR(4) NOT NULL,
    qty DOUBLE NOT NULL,
    entry DOUBLE NOT NULL,
    sl DOUBLE NULL,
    target DOUBLE NULL,
    opened_at BIGINT NOT NULL,
    INDEX idx_pos_inst (instrument)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4");

$pdo->exec("CREATE TABLE IF NOT EXISTS trades (
    id VARCHAR(40) PRIMARY KEY,
    instrument VARCHAR(16) NOT NULL,
    side VARCHAR(4) NOT NULL,
    qty DOUBLE NOT NULL,
    entry DOUBLE NOT NULL,
    sl DOUBLE NULL,
    target DOUBLE NULL,
    opened_at BIGINT NOT NULL,
    `exit` DOUBLE NOT NULL,
    closed_at BIGINT NOT NULL,
    pnl DOUBLE NOT NULL,
    reason VARCHAR(16) NOT NULL,
    INDEX idx_tr_inst (instrument),
    INDEX idx_tr_closed (closed_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4");

$pdo->exec("CREATE TABLE IF NOT EXISTS alerts (
    id VARCHAR(40) PRIMARY KEY,
    instrument VARCHAR(16) NOT NULL,
    email VARCHAR(190) NOT NULL,
    threshold DOUBLE NOT NULL,
    direction VARCHAR(8) NOT NULL,
    created_at BIGINT NOT NULL,
    triggered TINYINT NOT NULL DEFAULT 0,
    triggered_at BIGINT NULL,
    INDEX idx_al_active (triggered)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4");

// --- Authentication (registered users, e-mail OTP signup, sessions) ---
$pdo->exec("CREATE TABLE IF NOT EXISTS users (
    id INT AUTO_INCREMENT PRIMARY KEY,
    name VARCHAR(120) NOT NULL,
    email VARCHAR(190) NOT NULL UNIQUE,
    pass_hash VARCHAR(255) NOT NULL,
    created_at BIGINT NOT NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4");

$pdo->exec("CREATE TABLE IF NOT EXISTS pending_signups (
    email VARCHAR(190) PRIMARY KEY,
    name VARCHAR(120) NOT NULL,
    pass_hash VARCHAR(255) NOT NULL,
    otp VARCHAR(6) NOT NULL,
    expires_at BIGINT NOT NULL,
    attempts INT NOT NULL DEFAULT 0
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4");

$pdo->exec("CREATE TABLE IF NOT EXISTS sessions (
    token VARCHAR(64) PRIMARY KEY,
    user_id INT NOT NULL,
    created_at BIGINT NOT NULL,
    INDEX idx_sess_user (user_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4");
} catch (Throwable $e) {
    http_response_code(500);
    header('Content-Type: application/json');
    echo json_encode(['error' => 'table_create_failed', 'detail' => $e->getMessage()]);
    exit;
}
