-- ============================================================
-- JIMPITAN BALI - Supabase Database Schema
-- Run di SQL Editor Supabase
-- ============================================================

-- ============ TABEL NASABAH ============
CREATE TABLE IF NOT EXISTS nasabah (
  id SERIAL PRIMARY KEY,
  nama VARCHAR(100) NOT NULL,
  desa VARCHAR(100) DEFAULT 'Desa Padang Bulia',
  target_harian INTEGER DEFAULT 2000,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- ============ TABEL TRANSAKSI ============
CREATE TABLE IF NOT EXISTS transaksi (
  id BIGINT PRIMARY KEY,
  nasabah_id INTEGER REFERENCES nasabah(id) ON DELETE CASCADE,
  nominal INTEGER NOT NULL CHECK (nominal > 0),
  hari INTEGER NOT NULL CHECK (hari > 0),
  tanggal_setor TIMESTAMPTZ DEFAULT NOW(),
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- ============ TABEL PETUGAS (Opsional) ============
CREATE TABLE IF NOT EXISTS petugas (
  id SERIAL PRIMARY KEY,
  nama VARCHAR(100) NOT NULL,
  username VARCHAR(50) UNIQUE NOT NULL,
  password_hash VARCHAR(255) NOT NULL,
  role VARCHAR(20) DEFAULT 'petugas',
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- ============ TABEL LOG AKTIVITAS (Opsional) ============
CREATE TABLE IF NOT EXISTS log_aktivitas (
  id SERIAL PRIMARY KEY,
  petugas_id INTEGER REFERENCES petugas(id) ON DELETE SET NULL,
  nasabah_id INTEGER REFERENCES nasabah(id) ON DELETE SET NULL,
  aksi VARCHAR(50) NOT NULL,
  deskripsi TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- ============ INDEX ============
CREATE INDEX IF NOT EXISTS idx_transaksi_nasabah ON transaksi(nasabah_id);
CREATE INDEX IF NOT EXISTS idx_transaksi_tanggal ON transaksi(tanggal_setor DESC);
CREATE INDEX IF NOT EXISTS idx_transaksi_nasabah_tanggal ON transaksi(nasabah_id, tanggal_setor DESC);
CREATE INDEX IF NOT EXISTS idx_nasabah_nama ON nasabah(nama);
CREATE INDEX IF NOT EXISTS idx_log_petugas ON log_aktivitas(petugas_id);
CREATE INDEX IF NOT EXISTS idx_log_tanggal ON log_aktivitas(created_at DESC);

-- ============ FUNGSI UPDATE TIMESTAMP ============
CREATE OR REPLACE FUNCTION update_timestamp()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- ============ TRIGGER UPDATE NASABAH ============
DROP TRIGGER IF EXISTS trigger_nasabah_update ON nasabah;
CREATE TRIGGER trigger_nasabah_update
  BEFORE UPDATE ON nasabah
  FOR EACH ROW
  EXECUTE FUNCTION update_timestamp();

-- ============ ROW LEVEL SECURITY ============
ALTER TABLE nasabah ENABLE ROW LEVEL SECURITY;
ALTER TABLE transaksi ENABLE ROW LEVEL SECURITY;
ALTER TABLE petugas ENABLE ROW LEVEL SECURITY;
ALTER TABLE log_aktivitas ENABLE ROW LEVEL SECURITY;

-- Policy: Allow all (untuk development)
-- Untuk production, batasi sesuai user auth
CREATE POLICY "Allow all on nasabah" ON nasabah FOR ALL USING (true);
CREATE POLICY "Allow all on transaksi" ON transaksi FOR ALL USING (true);
CREATE POLICY "Allow all on petugas" ON petugas FOR ALL USING (true);
CREATE POLICY "Allow all on log_aktivitas" ON log_aktivitas FOR ALL USING (true);

-- ============ VIEW: RINGKASAN NASABAH ============
CREATE OR REPLACE VIEW ringkasan_nasabah AS
SELECT
  n.id,
  n.nama,
  n.desa,
  n.target_harian,
  COUNT(t.id) AS total_transaksi,
  COALESCE(SUM(t.nominal), 0) AS total_setor,
  COALESCE(SUM(t.hari), 0) AS total_hari,
  210 AS target_hari_bali,
  (10 * n.target_harian) AS upah_petugas,
  GREATEST(0, COALESCE(SUM(t.nominal), 0) - (10 * n.target_harian)) AS saldo_nasabah,
  GREATEST(0, 210 - COALESCE(SUM(t.hari), 0)) AS sisa_hari,
  n.created_at
FROM nasabah n
LEFT JOIN transaksi t ON n.id = t.nasabah_id
GROUP BY n.id, n.nama, n.desa, n.target_harian, n.created_at
ORDER BY n.nama;

-- ============ VIEW: TRANSAKSI HARIAN ============
CREATE OR REPLACE VIEW transaksi_harian AS
SELECT
  DATE(tanggal_setor) AS tanggal,
  COUNT(*) AS jumlah_transaksi,
  COALESCE(SUM(nominal), 0) AS total_nominal,
  COALESCE(SUM(hari), 0) AS total_hari
FROM transaksi
GROUP BY DATE(tanggal_setor)
ORDER BY tanggal DESC;

-- ============ VIEW: TRANSAKSI PER NASABAH PER BULAN ============
CREATE OR REPLACE VIEW transaksi_bulanan AS
SELECT
  n.nama,
  DATE_TRUNC('month', t.tanggal_setor) AS bulan,
  COUNT(t.id) AS jumlah_transaksi,
  COALESCE(SUM(t.nominal), 0) AS total_nominal,
  COALESCE(SUM(t.hari), 0) AS total_hari
FROM nasabah n
LEFT JOIN transaksi t ON n.id = t.nasabah_id
GROUP BY n.nama, DATE_TRUNC('month', t.tanggal_setor)
ORDER BY bulan DESC, n.nama;

-- ============ SEED DATA NASABAH ============
INSERT INTO nasabah (id, nama, desa, target_harian) VALUES
  (1, 'Ni Luh Sari', 'Desa Padang Bulia', 2000),
  (2, 'I Made Arta', 'Desa Padang Bulia', 2000),
  (3, 'I Nyoman Budi', 'Desa Padang Bulia', 3000),
  (4, 'Ni Ketut Ayu', 'Desa Padang Bulia', 2000),
  (5, 'I Gusti Ngurah', 'Desa Padang Bulia', 5000),
  (6, 'I Kadek Dewi', 'Desa Padang Bulia', 2000)
ON CONFLICT (id) DO UPDATE SET
  nama = EXCLUDED.nama,
  desa = EXCLUDED.desa,
  target_harian = EXCLUDED.target_harian;

-- Reset sequence
SELECT setval('nasabah_id_seq', (SELECT MAX(id) FROM nasabah));

-- ============ SEED DATA PETUGAS (Opsional) ============
-- Password: admin123 (hashed with bcrypt)
INSERT INTO petugas (nama, username, password_hash, role) VALUES
  ('Admin Mangsatria', 'admin', '$2a$10$placeholder_hash_for_admin123', 'admin'),
  ('Petugas 1', 'petugas1', '$2a$10$placeholder_hash_for_petugas1', 'petugas')
ON CONFLICT (username) DO NOTHING;

-- ============ GRANT PERMISSIONS ============
-- Untuk Supabase, permissions diatur via Dashboard
-- GRANT ALL ON ALL TABLES IN SCHEMA public TO authenticated;
-- GRANT ALL ON ALL SEQUENCES IN SCHEMA public TO authenticated;
-- GRANT SELECT ON ALL TABLES IN SCHEMA public TO anon;
