-- 1. Enable RLS untuk tabel wallets
ALTER TABLE wallets ENABLE ROW LEVEL SECURITY;

-- 2. Buat RLS policy (isolasi_wallet)
CREATE POLICY isolasi_wallet ON wallets
  USING (user_id = current_setting('app.current_user_id')::uuid);

-- 3. Grant permission ke role app
GRANT SELECT, INSERT, UPDATE ON wallets TO cariin_app_role;

-- 4. Constraint untuk check balance tidak boleh kurang dari 0
ALTER TABLE wallets ADD CONSTRAINT chk_balance CHECK (balance >= 0);
