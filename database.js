const fs = require('fs');
const path = require('path');
const bcrypt = require('bcryptjs');

const DB_PATH = path.join(__dirname, 'data');
const DB_FILE = path.join(DB_PATH, 'database.json');

// Pastikan direktori ada
if (!fs.existsSync(DB_PATH)) {
  fs.mkdirSync(DB_PATH, { recursive: true });
}

// Struktur database default
const defaultDB = {
  users: [],
  posts: [],
  tin_data: [],
  activity_reports: [],
  vehicles: [],
  collectors: [],
  qr_scan_logs: [],
  system_logs: [],
  _counters: {
    users: 0,
    posts: 0,
    tin_data: 0,
    activity_reports: 0,
    vehicles: 0,
    collectors: 0,
    qr_scan_logs: 0,
    system_logs: 0
  }
};

// Load database
let db = loadDatabase();

function loadDatabase() {
  try {
    if (fs.existsSync(DB_FILE)) {
      const data = fs.readFileSync(DB_FILE, 'utf8');
      return JSON.parse(data);
    }
  } catch (e) {
    console.error('Error loading database:', e);
  }
  return JSON.parse(JSON.stringify(defaultDB));
}

function saveDatabase() {
  fs.writeFileSync(DB_FILE, JSON.stringify(db, null, 2), 'utf8');
}

// Auto-save setiap 5 detik jika ada perubahan
let dirty = false;
function markDirty() {
  dirty = true;
}

setInterval(() => {
  if (dirty) {
    saveDatabase();
    dirty = false;
  }
}, 5000);

// Simpan saat process exit
process.on('SIGINT', () => {
  saveDatabase();
  process.exit(0);
});

// ========== OPERASI DATABASE ==========

function getAll(table) {
  return [...db[table]];
}

function getById(table, id) {
  return db[table].find(item => item.id === id) || null;
}

function getByField(table, field, value) {
  return db[table].find(item => item[field] === value) || null;
}

function filterByFields(table, conditions) {
  return db[table].filter(item => {
    return Object.entries(conditions).every(([key, value]) => {
      if (value === undefined || value === null || value === '') return true;
      return item[key] === value;
    });
  });
}

function insert(table, data) {
  db._counters[table]++;
  const id = db._counters[table];
  const record = {
    id,
    ...data,
    created_at: new Date().toISOString()
  };
  db[table].push(record);
  markDirty();
  return { lastID: id, record };
}

function update(table, id, data) {
  const index = db[table].findIndex(item => item.id === id);
  if (index === -1) return { changes: 0 };
  
  db[table][index] = {
    ...db[table][index],
    ...data,
    updated_at: new Date().toISOString()
  };
  markDirty();
  return { changes: 1 };
}

function remove(table, id) {
  const initialLength = db[table].length;
  db[table] = db[table].filter(item => item.id !== id);
  markDirty();
  return { changes: initialLength - db[table].length };
}

function count(table, conditions = {}) {
  if (Object.keys(conditions).length === 0) {
    return db[table].length;
  }
  return filterByFields(table, conditions).length;
}

// ========== INISIALISASI DATA DEFAULT ==========

async function initDatabase() {
  // Admin default
  if (db.users.length === 0) {
    const salt = bcrypt.genSaltSync(10);
    const hash = bcrypt.hashSync('admin123', salt);
    
    insert('users', {
      username: 'admin',
      password: hash,
      full_name: 'Administrator Sistem',
      rank: 'Admin',
      position: 'Pengelola Sistem',
      phone: '081234567890',
      post_location: 'Markas Satlap',
      sector: 'Pusat',
      role: 'admin',
      qr_code: null,
      id_card_number: 'TRI-ADM-0001',
      status: 'aktif'
    });
    
    console.log('========================================');
    console.log('  AKUN ADMIN DEFAULT DIBUAT');
    console.log('========================================');
    console.log('  Username: admin');
    console.log('  Password: admin123');
    console.log('  SEGERA UBAH SETELAH LOGIN PERTAMA!');
    console.log('========================================');
  }

  // Data pos default
  if (db.posts.length === 0) {
    const defaultPosts = [
      { post_name: 'Pos Koba', sector: 'Sektor Selatan', leader: 'Serma Nurwawi', location_coords: '48M 656491 9723596', phone: '08179966442', areas: 'Koba, Merbuk Kenari, Air Risi, Simpang Perlang, Namang, Penyak, Lubuk Besar', personnel_count: 5 },
      { post_name: 'Pos Sukadamai', sector: 'Sektor Selatan', leader: 'Kapten Arm Jayadi', location_coords: '48M 663521 9667151', phone: '081382628790', areas: 'Sukadamai, Teladan, Parit 8, Kolong 2, Puput, Parit 9, Kaposang, Paribukit, Parit 2, Bukit Terap, Rias', personnel_count: 6 },
      { post_name: 'Pos Tepus', sector: 'Sektor Selatan', leader: 'Pelda Rudi Triyana', location_coords: '48M 656027 9699083', phone: '085652211259', areas: 'Air Gegas, Bencah, Tepus', personnel_count: 5 },
      { post_name: 'Pos Beriga', sector: 'Sektor Selatan', leader: 'Serma Rusmanto', location_coords: '48M 689438 9711508', phone: '081252128187', areas: 'Pantai Beriket, Batu Beriga, Melingai', personnel_count: 2 },
      { post_name: 'Pos Permis', sector: 'Sektor Selatan', leader: 'Mayor Inf Slamet', location_coords: '48M 601413 9714110', phone: '081310417145', areas: 'Permis, Rajik, Sebagin, Payung', personnel_count: 4 },
      { post_name: 'Pos Tanjung Gunung', sector: 'Sektor Selatan', leader: 'Kapten Inf Dodi Wahyono', location_coords: '48M 623295 9766191', phone: '085371332624', areas: 'Tj Gunung, Batu Belubang', personnel_count: 5 },
      { post_name: 'Pos Sampur', sector: 'Sektor Selatan', leader: 'Mayor Cpm Didik Siswantoro', location_coords: '48M 630246 9761872', phone: '081346052324', areas: 'Pangkal Balam, Tanjung Bunga, Simpang Katis, Sungai Selan, Mendo Barat, Bukit Intan, Sampur', personnel_count: 7 },
      { post_name: 'Pos Sadai', sector: 'Sektor Selatan', leader: 'Peltu Suryadi', location_coords: '48M 693042 9667494', phone: '081317171409', areas: 'Sadai', personnel_count: 3 },
      { post_name: 'Pos Belinyu', sector: 'Sektor Utara', leader: 'Serka Khoirul Anwar', location_coords: '48M 600000 9800000', phone: '081234567890', areas: 'Belinyu, Tg Penyusuk, Romodong', personnel_count: 4 },
      { post_name: 'Pos Pelabuhan Tg Pandan', sector: 'Sektor Belitung', leader: 'Mayor Kav Bambang', location_coords: '48M 700000 9600000', phone: '081234567891', areas: 'Pelabuhan Tg Pandan', personnel_count: 7 }
    ];

    for (const post of defaultPosts) {
      insert('posts', post);
    }
    console.log('Data pos default berhasil ditambahkan');
  }

  saveDatabase();
  console.log('Database JSON berhasil diinisialisasi');
}

// Jalankan inisialisasi
initDatabase().catch(err => {
  console.error('Gagal inisialisasi database:', err);
  process.exit(1);
});

module.exports = {
  getAll,
  getById,
  getByField,
  filterByFields,
  insert,
  update,
  remove,
  count,
  save: saveDatabase
};
