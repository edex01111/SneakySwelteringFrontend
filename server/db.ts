import Database from "better-sqlite3";
import fs from "node:fs";
import path from "node:path";

export type CopySettings = {
  enabled: boolean;
  sizeMode: "fixed" | "percent";
  sizeUsd: number;
  percentOfTrader: number;
  maxPerTradeUsd: number;
  dailyBudgetUsd: number;
  minTraderTradeUsd: number;
};

export type LinkedUser = {
  privyId: string;
  telegramId: string;
  walletId: string;
  walletAddress: string;
  signerEnabled: boolean;
};

const dataDir = path.resolve(process.env.DATA_DIR || "data");
fs.mkdirSync(dataDir, { recursive: true });
const db = new Database(path.join(dataDir, "copybot.sqlite"));
db.pragma("journal_mode = WAL");
db.pragma("foreign_keys = ON");

db.exec(`
  CREATE TABLE IF NOT EXISTS users (
    privy_id TEXT PRIMARY KEY,
    telegram_id TEXT UNIQUE,
    wallet_id TEXT,
    wallet_address TEXT,
    signer_enabled INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
  );

  CREATE TABLE IF NOT EXISTS settings (
    privy_id TEXT PRIMARY KEY REFERENCES users(privy_id) ON DELETE CASCADE,
    enabled INTEGER NOT NULL DEFAULT 0,
    size_mode TEXT NOT NULL DEFAULT 'fixed',
    size_usd REAL NOT NULL DEFAULT 5,
    percent_of_trader REAL NOT NULL DEFAULT 5,
    max_per_trade_usd REAL NOT NULL DEFAULT 10,
    daily_budget_usd REAL NOT NULL DEFAULT 25,
    min_trader_trade_usd REAL NOT NULL DEFAULT 20,
    updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
  );

  CREATE TABLE IF NOT EXISTS traders (
    privy_id TEXT NOT NULL REFERENCES users(privy_id) ON DELETE CASCADE,
    handle TEXT NOT NULL,
    display_name TEXT,
    active INTEGER NOT NULL DEFAULT 1,
    added_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (privy_id, handle)
  );

  CREATE TABLE IF NOT EXISTS signals (
    id TEXT PRIMARY KEY,
    privy_id TEXT NOT NULL REFERENCES users(privy_id) ON DELETE CASCADE,
    event_id TEXT NOT NULL,
    handle TEXT NOT NULL,
    alert_type TEXT NOT NULL,
    chain_id TEXT,
    token_address TEXT,
    token_symbol TEXT,
    status TEXT NOT NULL,
    reason TEXT,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    UNIQUE (privy_id, event_id)
  );

  CREATE TABLE IF NOT EXISTS orders (
    id TEXT PRIMARY KEY,
    privy_id TEXT NOT NULL REFERENCES users(privy_id) ON DELETE CASCADE,
    event_id TEXT NOT NULL,
    handle TEXT NOT NULL,
    direction TEXT NOT NULL,
    token_address TEXT NOT NULL,
    amount_usd REAL NOT NULL,
    status TEXT NOT NULL,
    reason TEXT,
    tx_hash TEXT,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    UNIQUE (privy_id, event_id)
  );

  CREATE TABLE IF NOT EXISTS positions (
    privy_id TEXT NOT NULL REFERENCES users(privy_id) ON DELETE CASCADE,
    token_address TEXT NOT NULL,
    token_symbol TEXT,
    amount_raw TEXT NOT NULL,
    updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (privy_id, token_address)
  );

  CREATE INDEX IF NOT EXISTS idx_traders_active ON traders(active, handle);
  CREATE INDEX IF NOT EXISTS idx_signals_user_time ON signals(privy_id, created_at);
  CREATE INDEX IF NOT EXISTS idx_orders_user_time ON orders(privy_id, created_at);
`);

export function ensureUser(privyId: string): void {
  db.prepare("INSERT OR IGNORE INTO users (privy_id) VALUES (?)").run(privyId);
  db.prepare("INSERT OR IGNORE INTO settings (privy_id) VALUES (?)").run(privyId);
}

export function linkUserWallet(input: {
  privyId: string;
  telegramId: string;
  walletId: string;
  walletAddress: string;
}): void {
  const update = db.transaction(() => {
    ensureUser(input.privyId);
    const conflict = db
      .prepare("SELECT privy_id FROM users WHERE telegram_id = ? AND privy_id <> ?")
      .get(input.telegramId, input.privyId) as { privy_id: string } | undefined;
    if (conflict) throw new Error("This Telegram account is already linked.");

    db.prepare(`
      UPDATE users
      SET telegram_id = ?, wallet_id = ?, wallet_address = ?, signer_enabled = 0
      WHERE privy_id = ?
    `).run(input.telegramId, input.walletId, input.walletAddress, input.privyId);
  });
  update();
}

export function markSignerEnabled(privyId: string, walletAddress: string): void {
  const result = db
    .prepare(`
      UPDATE users SET signer_enabled = 1
      WHERE privy_id = ? AND lower(wallet_address) = lower(?)
    `)
    .run(privyId, walletAddress);
  if (result.changes !== 1) throw new Error("Wallet is not linked to this account.");
}

export function disableCopying(privyId: string): void {
  ensureUser(privyId);
  db.prepare("UPDATE settings SET enabled = 0, updated_at = CURRENT_TIMESTAMP WHERE privy_id = ?")
    .run(privyId);
}

export function getLinkedUser(privyId: string): LinkedUser | null {
  const row = db
    .prepare("SELECT * FROM users WHERE privy_id = ?")
    .get(privyId) as
    | {
        privy_id: string;
        telegram_id: string | null;
        wallet_id: string | null;
        wallet_address: string | null;
        signer_enabled: number;
      }
    | undefined;
  if (!row?.telegram_id || !row.wallet_id || !row.wallet_address) return null;
  return {
    privyId: row.privy_id,
    telegramId: row.telegram_id,
    walletId: row.wallet_id,
    walletAddress: row.wallet_address,
    signerEnabled: row.signer_enabled === 1,
  };
}

export function getSettings(privyId: string): CopySettings {
  ensureUser(privyId);
  const row = db.prepare("SELECT * FROM settings WHERE privy_id = ?").get(privyId) as {
    enabled: number;
    size_mode: "fixed" | "percent";
    size_usd: number;
    percent_of_trader: number;
    max_per_trade_usd: number;
    daily_budget_usd: number;
    min_trader_trade_usd: number;
  };
  return {
    enabled: row.enabled === 1,
    sizeMode: row.size_mode,
    sizeUsd: row.size_usd,
    percentOfTrader: row.percent_of_trader,
    maxPerTradeUsd: row.max_per_trade_usd,
    dailyBudgetUsd: row.daily_budget_usd,
    minTraderTradeUsd: row.min_trader_trade_usd,
  };
}

export function saveSettings(privyId: string, settings: CopySettings): void {
  ensureUser(privyId);
  db.prepare(`
    UPDATE settings
    SET enabled = ?, size_mode = ?, size_usd = ?, percent_of_trader = ?,
        max_per_trade_usd = ?, daily_budget_usd = ?, min_trader_trade_usd = ?,
        updated_at = CURRENT_TIMESTAMP
    WHERE privy_id = ?
  `).run(
    settings.enabled ? 1 : 0,
    settings.sizeMode,
    settings.sizeUsd,
    settings.percentOfTrader,
    settings.maxPerTradeUsd,
    settings.dailyBudgetUsd,
    settings.minTraderTradeUsd,
    privyId,
  );
}

export function addTrader(privyId: string, handle: string, displayName?: string): void {
  ensureUser(privyId);
  db.prepare(`
    INSERT INTO traders (privy_id, handle, display_name, active)
    VALUES (?, ?, ?, 1)
    ON CONFLICT(privy_id, handle) DO UPDATE SET active = 1, display_name = excluded.display_name
  `).run(privyId, handle.toLowerCase(), displayName || handle);
}

export function removeTrader(privyId: string, handle: string): void {
  db.prepare("DELETE FROM traders WHERE privy_id = ? AND handle = ?")
    .run(privyId, handle.toLowerCase());
}

export function listTraders(privyId: string): Array<{ handle: string; displayName: string; active: boolean }> {
  return (db.prepare(`
    SELECT handle, display_name, active FROM traders
    WHERE privy_id = ? ORDER BY added_at DESC
  `).all(privyId) as Array<{ handle: string; display_name: string | null; active: number }>)
    .map((row) => ({
      handle: row.handle,
      displayName: row.display_name || row.handle,
      active: row.active === 1,
    }));
}

export type CopyFollower = {
  privyId: string;
  telegramId: string | null;
  walletId: string | null;
  walletAddress: string | null;
  signerEnabled: boolean;
  settings: CopySettings;
};

export function followersOf(handle: string): CopyFollower[] {
  const rows = db.prepare(`
    SELECT u.privy_id, u.telegram_id, u.wallet_id, u.wallet_address, u.signer_enabled,
           s.enabled, s.size_mode, s.size_usd, s.percent_of_trader,
           s.max_per_trade_usd, s.daily_budget_usd, s.min_trader_trade_usd
    FROM traders t
    JOIN users u ON u.privy_id = t.privy_id
    JOIN settings s ON s.privy_id = u.privy_id
    WHERE t.handle = ? AND t.active = 1
  `).all(handle.toLowerCase()) as Array<Record<string, unknown>>;
  return rows.map((row) => ({
    privyId: String(row.privy_id),
    telegramId: row.telegram_id ? String(row.telegram_id) : null,
    walletId: row.wallet_id ? String(row.wallet_id) : null,
    walletAddress: row.wallet_address ? String(row.wallet_address) : null,
    signerEnabled: Number(row.signer_enabled) === 1,
    settings: {
      enabled: Number(row.enabled) === 1,
      sizeMode: row.size_mode as "fixed" | "percent",
      sizeUsd: Number(row.size_usd),
      percentOfTrader: Number(row.percent_of_trader),
      maxPerTradeUsd: Number(row.max_per_trade_usd),
      dailyBudgetUsd: Number(row.daily_budget_usd),
      minTraderTradeUsd: Number(row.min_trader_trade_usd),
    },
  }));
}

export function allActiveHandles(): string[] {
  return (db.prepare("SELECT DISTINCT handle FROM traders WHERE active = 1").all() as Array<{ handle: string }>)
    .map((row) => row.handle);
}

export function recordSignal(input: {
  id: string;
  privyId: string;
  eventId: string;
  handle: string;
  alertType: string;
  chainId: string;
  tokenAddress: string;
  tokenSymbol: string;
  status: string;
  reason: string;
}): boolean {
  const result = db.prepare(`
    INSERT OR IGNORE INTO signals
      (id, privy_id, event_id, handle, alert_type, chain_id, token_address, token_symbol, status, reason)
    VALUES
      (@id, @privyId, @eventId, @handle, @alertType, @chainId, @tokenAddress, @tokenSymbol, @status, @reason)
  `).run(input);
  return result.changes === 1;
}

export function updateSignal(
  privyId: string,
  eventId: string,
  status: string,
  reason: string,
): void {
  db.prepare(`
    UPDATE signals SET status = ?, reason = ?
    WHERE privy_id = ? AND event_id = ?
  `).run(status, reason, privyId, eventId);
}

export function recentSignals(privyId: string, limit = 25): Array<Record<string, unknown>> {
  return db.prepare(`
    SELECT handle, alert_type AS alertType, chain_id AS chainId,
           token_address AS tokenAddress, token_symbol AS tokenSymbol,
           status, reason, created_at AS createdAt
    FROM signals WHERE privy_id = ? ORDER BY created_at DESC LIMIT ?
  `).all(privyId, limit) as Array<Record<string, unknown>>;
}

export function dailySpendUsd(privyId: string): number {
  const row = db.prepare(`
    SELECT COALESCE(SUM(amount_usd), 0) AS total
    FROM orders
    WHERE privy_id = ? AND direction = 'buy' AND status IN ('submitted', 'confirmed')
      AND created_at >= datetime('now', 'start of day')
  `).get(privyId) as { total: number };
  return Number(row.total);
}

export function createOrder(input: {
  id: string;
  privyId: string;
  eventId: string;
  handle: string;
  direction: "buy" | "sell";
  tokenAddress: string;
  amountUsd: number;
}): boolean {
  const result = db.prepare(`
    INSERT OR IGNORE INTO orders
      (id, privy_id, event_id, handle, direction, token_address, amount_usd, status)
    VALUES
      (@id, @privyId, @eventId, @handle, @direction, @tokenAddress, @amountUsd, 'pending')
  `).run(input);
  return result.changes === 1;
}

export function finishOrder(
  id: string,
  status: "submitted" | "confirmed" | "failed",
  reason: string,
  txHash = "",
): void {
  db.prepare("UPDATE orders SET status = ?, reason = ?, tx_hash = ? WHERE id = ?")
    .run(status, reason, txHash, id);
}

export function getPosition(privyId: string, tokenAddress: string): { amountRaw: bigint; symbol: string } | null {
  const row = db.prepare(`
    SELECT amount_raw, token_symbol FROM positions
    WHERE privy_id = ? AND lower(token_address) = lower(?)
  `).get(privyId, tokenAddress) as { amount_raw: string; token_symbol: string | null } | undefined;
  return row
    ? { amountRaw: BigInt(row.amount_raw), symbol: row.token_symbol || "" }
    : null;
}

export function increasePosition(
  privyId: string,
  tokenAddress: string,
  amountRaw: bigint,
  symbol: string,
): void {
  const update = db.transaction(() => {
    const current = getPosition(privyId, tokenAddress);
    const nextAmount = (current?.amountRaw ?? 0n) + amountRaw;
    db.prepare(`
      INSERT INTO positions (privy_id, token_address, token_symbol, amount_raw)
      VALUES (?, lower(?), ?, ?)
      ON CONFLICT(privy_id, token_address) DO UPDATE SET
        amount_raw = excluded.amount_raw,
        token_symbol = CASE WHEN excluded.token_symbol <> '' THEN excluded.token_symbol ELSE positions.token_symbol END,
        updated_at = CURRENT_TIMESTAMP
    `).run(privyId, tokenAddress, symbol || current?.symbol || "", nextAmount.toString());
  });
  update();
}

export function closePosition(privyId: string, tokenAddress: string): void {
  db.prepare("DELETE FROM positions WHERE privy_id = ? AND lower(token_address) = lower(?)")
    .run(privyId, tokenAddress);
}

export function listPositions(privyId: string): Array<{ tokenAddress: string; symbol: string; amountRaw: string }> {
  return db.prepare(`
    SELECT token_address AS tokenAddress, token_symbol AS symbol, amount_raw AS amountRaw
    FROM positions WHERE privy_id = ?
    ORDER BY updated_at DESC
  `).all(privyId) as Array<{ tokenAddress: string; symbol: string; amountRaw: string }>;
}

