-- 1. Enable RLS
ALTER TABLE wallets ENABLE ROW LEVEL SECURITY;
ALTER TABLE wallet_transactions ENABLE ROW LEVEL SECURITY;

-- 2. Buat RLS Policy (User Self Isolation)
DROP POLICY IF EXISTS user_self_isolation_wallets ON wallets;
CREATE POLICY user_self_isolation_wallets ON wallets
  USING (user_id = current_setting('app.current_user_id')::uuid);

DROP POLICY IF EXISTS user_self_isolation_wallet_tx ON wallet_transactions;
CREATE POLICY user_self_isolation_wallet_tx ON wallet_transactions
  USING (user_id = current_setting('app.current_user_id')::uuid);

-- 3. Grant permission ke role app
GRANT SELECT, INSERT, UPDATE ON wallets TO cariin_app_role;
GRANT SELECT, INSERT, UPDATE ON wallet_transactions TO cariin_app_role;

-- 4. DEFAULT PRIVILEGES (WAJIB SESUAI ATURAN SQL MIGRATION)
ALTER DEFAULT PRIVILEGES IN SCHEMA public
  GRANT SELECT, INSERT, UPDATE ON TABLES TO cariin_app_role;

-- 5. Check constraints (Cegah saldo minus / nominal invalid)
ALTER TABLE wallets ADD CONSTRAINT chk_wallet_balance_positive CHECK (balance >= 0);
ALTER TABLE wallet_transactions ADD CONSTRAINT chk_tx_amount_positive CHECK (amount > 0);

-- 6. Indexes untuk performa
CREATE INDEX IF NOT EXISTS idx_wallets_user_id ON wallets(user_id);
CREATE INDEX IF NOT EXISTS idx_wallet_tx_user_id ON wallet_transactions(user_id);
CREATE INDEX IF NOT EXISTS idx_wallet_tx_status ON wallet_transactions(status);