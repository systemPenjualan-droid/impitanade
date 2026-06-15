// ============================================================
// JIMPITAN BALI - Google Apps Script Backend API
// Deploy sebagai Web App (Execute as: Me, Access: Anyone)
// ============================================================

// Konfigurasi
const SPREADSHEET_ID = 'YOUR_SPREADSHEET_ID'; // Ganti dengan ID Google Sheets
const SHEET_NASABAH = 'nasabah';
const SHEET_TRANSAKSI = 'transaksi';

// Konfigurasi Telegram
const TELEGRAM_BOT_TOKEN = 'YOUR_BOT_TOKEN'; // Ganti dengan token bot
const TELEGRAM_CHAT_ID = 'YOUR_CHAT_ID'; // Ganti dengan chat ID group

// Konfigurasi Supabase (untuk sync balik)
const SUPABASE_URL = 'https://YOUR_PROJECT.supabase.co';
const SUPABASE_KEY = 'YOUR_SUPABASE_ANON_KEY';

/**
 * ============ MAIN API HANDLER ============
 */
function doGet(e) {
  return handleRequest(e);
}

function doPost(e) {
  return handleRequest(e);
}

function handleRequest(e) {
  const action = e.parameter.action;
  let result;

  try {
    switch (action) {
      case 'get_nasabah':
        result = getNasabah();
        break;

      case 'get_transaksi':
        result = getTransaksi(e.parameter.nasabah_id);
        break;

      case 'save_transaksi':
        result = saveTransaksi(e.parameter);
        break;

      case 'delete_transaksi':
        result = deleteTransaksi(e.parameter.id);
        break;

      case 'update_transaksi':
        result = updateTransaksi(e.parameter);
        break;

      case 'get_summary':
        result = getSummary(e.parameter.nasabah_id);
        break;

      case 'sync_all':
        result = syncAllToSupabase();
        break;

      case 'send_telegram':
        result = sendManualTelegram(e.parameter);
        break;

      default:
        result = {
          status: 'error',
          message: 'Action tidak ditemukan. Available: get_nasabah, get_transaksi, save_transaksi, delete_transaksi, update_transaksi, get_summary, sync_all, send_telegram'
        };
    }

    return ContentService
      .createTextOutput(JSON.stringify(result))
      .setMimeType(ContentService.MimeType.JSON);

  } catch (err) {
    return ContentService
      .createTextOutput(JSON.stringify({
        status: 'error',
        message: err.toString(),
        stack: err.stack
      }))
      .setMimeType(ContentService.MimeType.JSON);
  }
}

/**
 * ============ GET NASABAH ============
 * Mengambil daftar nasabah dari Google Sheets
 */
function getNasabah() {
  const sheet = getSheet(SHEET_NASABAH);
  const data = sheet.getDataRange().getValues();
  const headers = data.shift(); // Ambil header

  const result = data
    .filter(row => row[0] && row[1]) // Filter row kosong
    .map(row => ({
      id: row[0],
      nama: row[1],
      desa: row[2] || 'Desa Padang Bulia',
      target_harian: parseInt(row[3]) || 2000,
      created_at: row[4] || new Date().toISOString()
    }));

  return {
    status: 'success',
    data: result,
    total: result.length
  };
}

/**
 * ============ GET TRANSAKSI ============
 * Mengambil transaksi berdasarkan nasabah_id
 */
function getTransaksi(nasabahId) {
  if (!nasabahId) {
    return { status: 'error', message: 'nasabah_id diperlukan' };
  }

  const sheet = getSheet(SHEET_TRANSAKSI);
  const data = sheet.getDataRange().getValues();
  const headers = data.shift();

  const result = data
    .filter(row => row[1] == nasabahId)
    .map(row => ({
      id: row[0],
      nasabah_id: parseInt(row[1]),
      nominal: parseInt(row[2]),
      hari: parseInt(row[3]),
      tanggal_setor: row[4],
      created_at: row[5] || row[4]
    }))
    .sort((a, b) => new Date(b.tanggal_setor) - new Date(a.tanggal_setor)); // Terbaru dulu

  return {
    status: 'success',
    data: result,
    total: result.length
  };
}

/**
 * ============ SAVE TRANSAKSI ============
 * Menyimpan transaksi baru + kirim notif Telegram
 */
function saveTransaksi(params) {
  const nasabahId = parseInt(params.nasabah_id);
  const nominal = parseInt(params.nominal);
  const hari = parseInt(params.hari);
  const desa = params.desa || 'Desa Padang Bulia';
  const target = parseInt(params.target) || 2000;

  if (!nasabahId || !nominal || !hari) {
    return { status: 'error', message: 'Parameter tidak lengkap: nasabah_id, nominal, hari' };
  }

  const sheet = getSheet(SHEET_TRANSAKSI);
  const id = Date.now();
  const tanggalSetor = new Date().toISOString();

  // Append row ke spreadsheet
  sheet.appendRow([id, nasabahId, nominal, hari, tanggalSetor, tanggalSetor]);

  // Ambil nama nasabah
  const namaNasabah = getNamaNasabah(nasabahId);

  // Auto sync ke Supabase
  try {
    syncSingleToSupabase({
      id: id,
      nasabah_id: nasabahId,
      nominal: nominal,
      hari: hari,
      tanggal_setor: tanggalSetor
    });
  } catch (e) {
    console.log('Sync Supabase gagal:', e);
  }

  // Auto kirim Telegram
  try {
    sendTelegramNotification({
      nama: namaNasabah,
      desa: desa,
      nominal: nominal,
      hari: hari,
      target: target
    });
  } catch (e) {
    console.log('Kirim Telegram gagal:', e);
  }

  return {
    status: 'success',
    message: 'Transaksi berhasil disimpan',
    data: {
      id: id,
      nasabah_id: nasabahId,
      nama_nasabah: namaNasabah,
      nominal: nominal,
      hari: hari,
      tanggal_setor: tanggalSetor
    }
  };
}

/**
 * ============ DELETE TRANSAKSI ============
 */
function deleteTransaksi(id) {
  if (!id) {
    return { status: 'error', message: 'ID transaksi diperlukan' };
  }

  const sheet = getSheet(SHEET_TRANSAKSI);
  const data = sheet.getDataRange().getValues();
  const targetId = parseInt(id);

  for (let i = data.length - 1; i >= 0; i--) {
    if (data[i][0] == targetId) {
      sheet.deleteRow(i + 1); // +1 karena index 0-based
      return { status: 'success', message: 'Transaksi berhasil dihapus', id: targetId };
    }
  }

  return { status: 'error', message: 'Transaksi tidak ditemukan' };
}

/**
 * ============ UPDATE TRANSAKSI ============
 */
function updateTransaksi(params) {
  const id = parseInt(params.id);
  const nominal = parseInt(params.nominal);

  if (!id || !nominal) {
    return { status: 'error', message: 'Parameter tidak lengkap: id, nominal' };
  }

  const sheet = getSheet(SHEET_TRANSAKSI);
  const data = sheet.getDataRange().getValues();

  for (let i = data.length - 1; i >= 0; i--) {
    if (data[i][0] == id) {
      const target = parseInt(params.target) || 2000;
      const hari = Math.floor(nominal / target);

      // Update cells: nominal (col 3), hari (col 4)
      sheet.getRange(i + 1, 3).setValue(nominal);
      sheet.getRange(i + 1, 4).setValue(hari);

      return {
        status: 'success',
        message: 'Transaksi berhasil diupdate',
        data: {
          id: id,
          nominal: nominal,
          hari: hari
        }
      };
    }
  }

  return { status: 'error', message: 'Transaksi tidak ditemukan' };
}

/**
 * ============ GET SUMMARY ============
 */
function getSummary(nasabahId) {
  if (!nasabahId) {
    return { status: 'error', message: 'nasabah_id diperlukan' };
  }

  const sheet = getSheet(SHEET_TRANSAKSI);
  const data = sheet.getDataRange().getValues();
  data.shift(); // Remove header

  let totalSetor = 0;
  let totalHari = 0;
  let count = 0;

  data.forEach(row => {
    if (row[1] == nasabahId) {
      totalSetor += parseInt(row[2]) || 0;
      totalHari += parseInt(row[3]) || 0;
      count++;
    }
  });

  const namaNasabah = getNamaNasabah(nasabahId);
  const nasabahData = getNasabahData(nasabahId);
  const target = nasabahData ? nasabahData.target_harian : 2000;
  const totalTarget = 210 * target;
  const upahPetugas = 10 * target;
  const saldoNasabah = Math.max(0, totalSetor - upahPetugas);

  return {
    status: 'success',
    data: {
      nasabah_id: parseInt(nasabahId),
      nama: namaNasabah,
      total_setor: totalSetor,
      total_hari: totalHari,
      total_transaksi: count,
      target_harian: target,
      total_target_210_hari: totalTarget,
      upah_petugas_10_hari: upahPetugas,
      saldo_nasabah: saldoNasabah,
      sisa_hari: Math.max(0, 210 - totalHari)
    }
  };
}

/**
 * ============ SYNC TO SUPABASE ============
 */
function syncSingleToSupabase(trx) {
  const url = `${SUPABASE_URL}/rest/v1/transaksi`;
  const payload = {
    id: trx.id,
    nasabah_id: trx.nasabah_id,
    nominal: trx.nominal,
    hari: trx.hari,
    tanggal_setor: trx.tanggal_setor,
    created_at: new Date().toISOString()
  };

  const options = {
    method: 'POST',
    contentType: 'application/json',
    headers: {
      'apikey': SUPABASE_KEY,
      'Authorization': 'Bearer ' + SUPABASE_KEY,
      'Prefer': 'return=minimal'
    },
    payload: JSON.stringify(payload),
    muteHttpExceptions: true
  };

  const response = UrlFetchApp.fetch(url, options);
  return JSON.parse(response.getContentText());
}

function syncAllToSupabase() {
  const sheet = getSheet(SHEET_TRANSAKSI);
  const data = sheet.getDataRange().getValues();
  const headers = data.shift();

  let synced = 0;
  let errors = 0;

  data.forEach(row => {
    if (!row[0]) return;
    try {
      syncSingleToSupabase({
        id: row[0],
        nasabah_id: parseInt(row[1]),
        nominal: parseInt(row[2]),
        hari: parseInt(row[3]),
        tanggal_setor: row[4]
      });
      synced++;
    } catch (e) {
      errors++;
      console.log('Error sync row', row[0], e);
    }
  });

  return {
    status: 'success',
    message: `Sync selesai: ${synced} berhasil, ${errors} gagal`
  };
}

/**
 * ============ TELEGRAM NOTIFICATION ============
 */
function sendTelegramNotification(data) {
  const nominalFormatted = data.nominal.toLocaleString('id-ID');
  const today = new Date();
  const tglFormatted = today.getDate() + '/' + (today.getMonth() + 1) + '/' + today.getFullYear();
  const jamFormatted = String(today.getHours()).padStart(2, '0') + ':' + String(today.getMinutes()).padStart(2, '0');

  const message = [
    '📋 *JIMPITAN Mangsatria*',
    '📍 ' + data.desa,
    '',
    '👤 *Nasabah:* ' + data.nama,
    '💰 *Setor:* Rp' + nominalFormatted + ' (' + data.hari + ' hari)',
    '🎯 *Target:* Rp' + data.target.toLocaleString('id-ID') + '/hari',
    '📅 *Tanggal:* ' + tglFormatted + ' ' + jamFormatted,
    '',
    '🙏 *Om Swastiastu*'
  ].join('\n');

  const url = 'https://api.telegram.org/bot' + TELEGRAM_BOT_TOKEN + '/sendMessage';
  const payload = {
    chat_id: TELEGRAM_CHAT_ID,
    text: message,
    parse_mode: 'Markdown',
    disable_web_page_preview: true
  };

  const options = {
    method: 'POST',
    contentType: 'application/json',
    payload: JSON.stringify(payload),
    muteHttpExceptions: true
  };

  const response = UrlFetchApp.fetch(url, options);
  return JSON.parse(response.getContentText());
}

function sendManualTelegram(params) {
  const message = params.message || 'Test message from Jimpitan Bali';
  const chatId = params.chat_id || TELEGRAM_CHAT_ID;

  const url = 'https://api.telegram.org/bot' + TELEGRAM_BOT_TOKEN + '/sendMessage';
  const payload = {
    chat_id: chatId,
    text: message,
    parse_mode: 'Markdown'
  };

  const options = {
    method: 'POST',
    contentType: 'application/json',
    payload: JSON.stringify(payload),
    muteHttpExceptions: true
  };

  const response = UrlFetchApp.fetch(url, options);
  return {
    status: 'success',
    telegram_response: JSON.parse(response.getContentText())
  };
}

/**
 * ============ HELPER FUNCTIONS ============
 */
function getSheet(sheetName) {
  const ss = SpreadsheetApp.openById(SPREADSHEET_ID);
  let sheet = ss.getSheetByName(sheetName);

  if (!sheet) {
    sheet = ss.insertSheet(sheetName);
    if (sheetName === SHEET_NASABAH) {
      sheet.appendRow(['id', 'nama', 'desa', 'target_harian', 'created_at']);
      // Seed data
      const seedData = [
        [1, 'Ni Luh Sari', 'Desa Padang Bulia', 2000, new Date().toISOString()],
        [2, 'I Made Arta', 'Desa Padang Bulia', 2000, new Date().toISOString()],
        [3, 'I Nyoman Budi', 'Desa Padang Bulia', 3000, new Date().toISOString()],
        [4, 'Ni Ketut Ayu', 'Desa Padang Bulia', 2000, new Date().toISOString()],
        [5, 'I Gusti Ngurah', 'Desa Padang Bulia', 5000, new Date().toISOString()],
        [6, 'I Kadek Dewi', 'Desa Padang Bulia', 2000, new Date().toISOString()]
      ];
      seedData.forEach(row => sheet.appendRow(row));
    }
    if (sheetName === SHEET_TRANSAKSI) {
      sheet.appendRow(['id', 'nasabah_id', 'nominal', 'hari', 'tanggal_setor', 'created_at']);
    }
  }

  return sheet;
}

function getNamaNasabah(id) {
  const sheet = getSheet(SHEET_NASABAH);
  const data = sheet.getDataRange().getValues();
  const found = data.find(row => row[0] == id);
  return found ? found[1] : 'Unknown';
}

function getNasabahData(id) {
  const sheet = getSheet(SHEET_NASABAH);
  const data = sheet.getDataRange().getValues();
  const found = data.find(row => row[0] == id);
  return found ? {
    id: found[0],
    nama: found[1],
    desa: found[2],
    target_harian: parseInt(found[3]) || 2000
  } : null;
}

/**
 * ============ SETUP TRIGGER (Optional) ============
 * Jalan otomatis tiap jam untuk sync
 */
function setupTrigger() {
  ScriptApp.newTrigger('syncAllToSupabase')
    .timeBased()
    .everyHours(1)
    .create();
}

/**
 * ============ WEB APP SETUP HELPER ============
 * Jalankan sekali untuk inisialisasi
 */
function initSpreadsheet() {
  getSheet(SHEET_NASABAH);
  getSheet(SHEET_TRANSAKSI);
  return { status: 'success', message: 'Spreadsheet siap pakai' };
}
