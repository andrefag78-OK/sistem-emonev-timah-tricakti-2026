const express = require('express');
const cors = require('cors');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const QRCode = require('qrcode');
const path = require('path');
const db = require('./database');

const app = express();
const PORT = process.env.PORT || 3000;
const JWT_SECRET = process.env.JWT_SECRET || 'sistem-timah-tricakti-rahasia-2026';

app.use(cors());
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true, limit: '10mb' }));
app.use(express.static(path.join(__dirname, 'public')));

// Middleware autentikasi
const authenticateToken = (req, res, next) => {
  const authHeader = req.headers['authorization'];
  const token = authHeader && authHeader.split(' ')[1];

  if (!token) {
    return res.status(401).json({ success: false, message: 'Token tidak ditemukan' });
  }

  jwt.verify(token, JWT_SECRET, (err, user) => {
    if (err) {
      return res.status(403).json({ success: false, message: 'Token tidak valid' });
    }
    req.user = user;
    next();
  });
};

// Middleware admin only
const adminOnly = (req, res, next) => {
  if (req.user.role !== 'admin') {
    return res.status(403).json({ success: false, message: 'Hanya admin yang dapat mengakses' });
  }
  next();
};

// Fungsi log sistem
const logSystem = async (userId, action, tableName, recordId, details, ip) => {
  try {
    db.insert('system_logs', {
      user_id: userId,
      action,
      table_name: tableName,
      record_id: recordId,
      details,
      ip_address: ip
    });
  } catch (e) {
    console.error('Log error:', e);
  }
};

// ========== AUTH ROUTES ==========

app.post('/api/login', async (req, res) => {
  try {
    const { username, password } = req.body;

    if (!username || !password) {
      return res.status(400).json({ success: false, message: 'Username dan password harus diisi' });
    }

    const user = db.getByField('users', 'username', username);

    if (!user) {
      return res.status(401).json({ success: false, message: 'Username atau password salah' });
    }

    if (user.status !== 'aktif') {
      return res.status(401).json({ success: false, message: 'Akun tidak aktif' });
    }

    const validPassword = bcrypt.compareSync(password, user.password);

    if (!validPassword) {
      return res.status(401).json({ success: false, message: 'Username atau password salah' });
    }

    const token = jwt.sign(
      { id: user.id, username: user.username, role: user.role, fullName: user.full_name },
      JWT_SECRET,
      { expiresIn: '24h' }
    );

    await logSystem(user.id, 'LOGIN', 'users', user.id, 'Login berhasil', req.ip);

    res.json({
      success: true,
      message: 'Login berhasil',
      token,
      user: {
        id: user.id,
        username: user.username,
        full_name: user.full_name,
        rank: user.rank,
        position: user.position,
        phone: user.phone,
        post_location: user.post_location,
        sector: user.sector,
        role: user.role,
        id_card_number: user.id_card_number
      }
    });
  } catch (error) {
    res.status(500).json({ success: false, message: 'Server error', error: error.message });
  }
});

app.post('/api/change-password', authenticateToken, async (req, res) => {
  try {
    const { oldPassword, newPassword } = req.body;
    const user = db.getById('users', req.user.id);

    if (!bcrypt.compareSync(oldPassword, user.password)) {
      return res.status(400).json({ success: false, message: 'Password lama salah' });
    }

    const salt = bcrypt.genSaltSync(10);
    const hash = bcrypt.hashSync(newPassword, salt);

    db.update('users', req.user.id, { password: hash });
    await logSystem(req.user.id, 'CHANGE_PASSWORD', 'users', req.user.id, 'Password diubah', req.ip);

    res.json({ success: true, message: 'Password berhasil diubah' });
  } catch (error) {
    res.status(500).json({ success: false, message: 'Server error', error: error.message });
  }
});

// ========== USER MANAGEMENT ==========

const generateQRCode = async (data) => {
  try {
    return await QRCode.toDataURL(JSON.stringify(data), {
      width: 200, margin: 2, color: { dark: '#000000', light: '#ffffff' }
    });
  } catch (error) {
    console.error('QR Error:', error);
    return null;
  }
};

const generateIdCardNumber = (role) => {
  const prefix = role === 'admin' ? 'TRI-ADM' : 'TRI-PTG';
  const count = db.count('users') + 1;
  return `${prefix}-${String(count).padStart(4, '0')}`;
};

app.post('/api/users', authenticateToken, adminOnly, async (req, res) => {
  try {
    const { username, password, full_name, rank, position, phone, post_location, sector, role } = req.body;

    if (!username || !password || !full_name) {
      return res.status(400).json({ success: false, message: 'Field wajib harus diisi' });
    }

    const existing = db.getByField('users', 'username', username);
    if (existing) {
      return res.status(400).json({ success: false, message: 'Username sudah digunakan' });
    }

    const salt = bcrypt.genSaltSync(10);
    const hash = bcrypt.hashSync(password, salt);
    const userRole = role || 'petugas';
    const idCardNumber = generateIdCardNumber(userRole);

    const qrData = {
      id_card_number: idCardNumber,
      username,
      full_name,
      role: userRole,
      post_location,
      generated_at: new Date().toISOString()
    };

    const qrCode = await generateQRCode(qrData);

    const result = db.insert('users', {
      username,
      password: hash,
      full_name,
      rank,
      position,
      phone,
      post_location,
      sector,
      role: userRole,
      qr_code: qrCode,
      id_card_number: idCardNumber,
      status: 'aktif'
    });

    await logSystem(req.user.id, 'CREATE_USER', 'users', result.lastID, `Menambah user: ${username}`, req.ip);

    res.json({
      success: true,
      message: 'Pengguna berhasil ditambahkan',
      id: result.lastID,
      id_card_number: idCardNumber
    });
  } catch (error) {
    res.status(500).json({ success: false, message: 'Server error', error: error.message });
  }
});

app.get('/api/users', authenticateToken, (req, res) => {
  try {
    const users = db.getAll('users')
      .sort((a, b) => new Date(b.created_at) - new Date(a.created_at))
      .map(u => ({
        id: u.id, username: u.username, full_name: u.full_name, rank: u.rank,
        position: u.position, phone: u.phone, post_location: u.post_location,
        sector: u.sector, role: u.role, id_card_number: u.id_card_number,
        status: u.status, created_at: u.created_at
      }));
    res.json({ success: true, data: users });
  } catch (error) {
    res.status(500).json({ success: false, message: 'Server error' });
  }
});

app.get('/api/users/:id', authenticateToken, (req, res) => {
  try {
    const u = db.getById('users', parseInt(req.params.id));
    if (!u) {
      return res.status(404).json({ success: false, message: 'Pengguna tidak ditemukan' });
    }
    res.json({
      success: true,
      data: {
        id: u.id, username: u.username, full_name: u.full_name, rank: u.rank,
        position: u.position, phone: u.phone, post_location: u.post_location,
        sector: u.sector, role: u.role, id_card_number: u.id_card_number,
        qr_code: u.qr_code, photo: u.photo, status: u.status, created_at: u.created_at
      }
    });
  } catch (error) {
    res.status(500).json({ success: false, message: 'Server error' });
  }
});

app.put('/api/users/:id', authenticateToken, adminOnly, async (req, res) => {
  try {
    const { full_name, rank, position, phone, post_location, sector, role, status, password } = req.body;
    const userId = parseInt(req.params.id);
    const updateData = {};

    if (full_name !== undefined) updateData.full_name = full_name;
    if (rank !== undefined) updateData.rank = rank;
    if (position !== undefined) updateData.position = position;
    if (phone !== undefined) updateData.phone = phone;
    if (post_location !== undefined) updateData.post_location = post_location;
    if (sector !== undefined) updateData.sector = sector;
    if (role !== undefined) updateData.role = role;
    if (status !== undefined) updateData.status = status;
    if (password) {
      const salt = bcrypt.genSaltSync(10);
      updateData.password = bcrypt.hashSync(password, salt);
    }

    db.update('users', userId, updateData);
    await logSystem(req.user.id, 'UPDATE_USER', 'users', userId, `Mengupdate user ID: ${userId}`, req.ip);

    res.json({ success: true, message: 'Data pengguna berhasil diupdate' });
  } catch (error) {
    res.status(500).json({ success: false, message: 'Server error', error: error.message });
  }
});

app.delete('/api/users/:id', authenticateToken, adminOnly, async (req, res) => {
  try {
    db.remove('users', parseInt(req.params.id));
    await logSystem(req.user.id, 'DELETE_USER', 'users', req.params.id, `Menghapus user ID: ${req.params.id}`, req.ip);
    res.json({ success: true, message: 'Pengguna berhasil dihapus' });
  } catch (error) {
    res.status(500).json({ success: false, message: 'Server error' });
  }
});

app.post('/api/users/:id/regenerate-qr', authenticateToken, adminOnly, async (req, res) => {
  try {
    const user = db.getById('users', parseInt(req.params.id));
    if (!user) {
      return res.status(404).json({ success: false, message: 'Pengguna tidak ditemukan' });
    }

    const qrData = {
      id_card_number: user.id_card_number,
      username: user.username,
      full_name: user.full_name,
      role: user.role,
      post_location: user.post_location,
      regenerated_at: new Date().toISOString()
    };

    const qrCode = await generateQRCode(qrData);
    db.update('users', user.id, { qr_code: qrCode });

    res.json({ success: true, message: 'QR Code berhasil digenerate ulang', qr_code: qrCode });
  } catch (error) {
    res.status(500).json({ success: false, message: 'Server error' });
  }
});

// ========== POSTS ==========

app.get('/api/posts', authenticateToken, (req, res) => {
  try {
    const posts = db.getAll('posts').sort((a, b) => {
      if (a.sector !== b.sector) return a.sector.localeCompare(b.sector);
      return a.post_name.localeCompare(b.post_name);
    });
    res.json({ success: true, data: posts });
  } catch (error) {
    res.status(500).json({ success: false, message: 'Server error' });
  }
});

app.post('/api/posts', authenticateToken, adminOnly, async (req, res) => {
  try {
    const { post_name, sector, leader, location_coords, phone, areas, personnel_count } = req.body;
    const result = db.insert('posts', {
      post_name, sector, leader, location_coords, phone, areas,
      personnel_count: personnel_count || 0, status: 'aktif'
    });
    await logSystem(req.user.id, 'CREATE_POST', 'posts', result.lastID, `Menambah pos: ${post_name}`, req.ip);
    res.json({ success: true, message: 'Pos berhasil ditambahkan', id: result.lastID });
  } catch (error) {
    res.status(500).json({ success: false, message: 'Server error' });
  }
});

// ========== TIN DATA ==========

app.get('/api/tin-data', authenticateToken, (req, res) => {
  try {
    const { start_date, end_date, sector, post_location } = req.query;
    
    let data = db.getAll('tin_data');
    
    if (start_date) data = data.filter(d => d.transaction_date >= start_date);
    if (end_date) data = data.filter(d => d.transaction_date <= end_date);
    if (sector) data = data.filter(d => d.sector === sector);
    if (post_location) data = data.filter(d => d.post_location === post_location);
    
    data = data.sort((a, b) => {
      if (a.transaction_date !== b.transaction_date) 
        return b.transaction_date.localeCompare(a.transaction_date);
      return (b.transaction_time || '').localeCompare(a.transaction_time || '');
    }).slice(0, 500);
    
    // Tambah officer_name
    const users = db.getAll('users');
    data = data.map(d => {
      const officer = users.find(u => u.id === d.officer_id);
      return { ...d, officer_name: officer ? officer.full_name : '-' };
    });
    
    res.json({ success: true, data });
  } catch (error) {
    res.status(500).json({ success: false, message: 'Server error', error: error.message });
  }
});

app.post('/api/tin-data', authenticateToken, async (req, res) => {
  try {
    const result = db.insert('tin_data', { ...req.body, officer_id: req.user.id, status: 'valid' });
    await logSystem(req.user.id, 'CREATE_TIN_DATA', 'tin_data', result.lastID, `Input data timah: ${req.body.weight_kg || 0}kg`, req.ip);
    res.json({ success: true, message: 'Data timah berhasil disimpan', id: result.lastID });
  } catch (error) {
    res.status(500).json({ success: false, message: 'Server error', error: error.message });
  }
});

app.delete('/api/tin-data/:id', authenticateToken, async (req, res) => {
  try {
    if (req.user.role !== 'admin') {
      return res.status(403).json({ success: false, message: 'Hanya admin yang bisa menghapus' });
    }
    db.remove('tin_data', parseInt(req.params.id));
    await logSystem(req.user.id, 'DELETE_TIN_DATA', 'tin_data', req.params.id, `Menghapus data timah ID: ${req.params.id}`, req.ip);
    res.json({ success: true, message: 'Data berhasil dihapus' });
  } catch (error) {
    res.status(500).json({ success: false, message: 'Server error' });
  }
});

// ========== ACTIVITY REPORTS ==========

app.get('/api/activity-reports', authenticateToken, (req, res) => {
  try {
    const users = db.getAll('users');
    const reports = db.getAll('activity_reports')
      .sort((a, b) => {
        if (a.report_date !== b.report_date) return b.report_date.localeCompare(a.report_date);
        return new Date(b.created_at) - new Date(a.created_at);
      })
      .slice(0, 200)
      .map(r => {
        const officer = users.find(u => u.id === r.officer_id);
        return { ...r, officer_name: officer ? officer.full_name : '-' };
      });
    res.json({ success: true, data: reports });
  } catch (error) {
    res.status(500).json({ success: false, message: 'Server error' });
  }
});

app.post('/api/activity-reports', authenticateToken, async (req, res) => {
  try {
    const result = db.insert('activity_reports', { ...req.body, officer_id: req.user.id, status: 'lengkap' });
    await logSystem(req.user.id, 'CREATE_REPORT', 'activity_reports', result.lastID, `Laporan: ${req.body.activity_title}`, req.ip);
    res.json({ success: true, message: 'Laporan berhasil disimpan', id: result.lastID });
  } catch (error) {
    res.status(500).json({ success: false, message: 'Server error', error: error.message });
  }
});

// ========== VEHICLES ==========

app.get('/api/vehicles', authenticateToken, (req, res) => {
  try {
    const users = db.getAll('users');
    const vehicles = db.getAll('vehicles')
      .sort((a, b) => {
        if (a.check_date !== b.check_date) return (b.check_date || '').localeCompare(a.check_date || '');
        return (b.check_time || '').localeCompare(a.check_time || '');
      })
      .slice(0, 200)
      .map(v => {
        const officer = users.find(u => u.id === v.officer_id);
        return { ...v, officer_name: officer ? officer.full_name : '-' };
      });
    res.json({ success: true, data: vehicles });
  } catch (error) {
    res.status(500).json({ success: false, message: 'Server error' });
  }
});

app.post('/api/vehicles', authenticateToken, async (req, res) => {
  try {
    const data = { ...req.body, officer_id: req.user.id, is_suspected: req.body.is_suspected || 0 };
    const result = db.insert('vehicles', data);
    await logSystem(req.user.id, 'CREATE_VEHICLE', 'vehicles', result.lastID, `Kendaraan: ${req.body.plate_number}`, req.ip);
    res.json({ success: true, message: 'Data kendaraan berhasil disimpan', id: result.lastID });
  } catch (error) {
    res.status(500).json({ success: false, message: 'Server error', error: error.message });
  }
});

// ========== COLLECTORS ==========

app.get('/api/collectors', authenticateToken, (req, res) => {
  try {
    const collectors = db.getAll('collectors').sort((a, b) => a.name.localeCompare(b.name));
    res.json({ success: true, data: collectors });
  } catch (error) {
    res.status(500).json({ success: false, message: 'Server error' });
  }
});

app.post('/api/collectors', authenticateToken, async (req, res) => {
  try {
    const result = db.insert('collectors', { ...req.body, status: 'terdaftar' });
    await logSystem(req.user.id, 'CREATE_COLLECTOR', 'collectors', result.lastID, `Kolektor: ${req.body.name}`, req.ip);
    res.json({ success: true, message: 'Kolektor berhasil ditambahkan', id: result.lastID });
  } catch (error) {
    res.status(500).json({ success: false, message: 'Server error' });
  }
});

// ========== QR SCAN LOGS ==========

app.post('/api/qr-scan', authenticateToken, async (req, res) => {
  try {
    const { scan_type, scan_data, location, device_info } = req.body;
    db.insert('qr_scan_logs', {
      user_id: req.user.id, scan_type, scan_data, location, device_info,
      scan_time: new Date().toISOString()
    });

    let userFound = null;
    try {
      const qrParsed = JSON.parse(scan_data);
      if (qrParsed.id_card_number) {
        const u = db.getByField('users', 'id_card_number', qrParsed.id_card_number);
        if (u) {
          userFound = {
            id: u.id, username: u.username, full_name: u.full_name,
            rank: u.rank, position: u.position, post_location: u.post_location,
            sector: u.sector, role: u.role, id_card_number: u.id_card_number, status: u.status
          };
        }
      }
    } catch (e) {}

    res.json({ success: true, message: 'Scan tercatat', user_found: userFound });
  } catch (error) {
    res.status(500).json({ success: false, message: 'Server error' });
  }
});

// ========== DASHBOARD STATISTICS ==========

app.get('/api/dashboard/stats', authenticateToken, (req, res) => {
  try {
    const today = new Date().toISOString().split('T')[0];
    const tinData = db.getAll('tin_data');
    
    // Helper filter tanggal
    const daysAgo = (n) => {
      const d = new Date();
      d.setDate(d.getDate() - n);
      return d.toISOString().split('T')[0];
    };

    // Hari ini
    const todayData = tinData.filter(d => d.transaction_date === today);
    const tinToday = {
      total_weight: todayData.reduce((sum, d) => sum + (d.weight_kg || 0), 0),
      total_sacks: todayData.reduce((sum, d) => sum + (d.sack_count || 0), 0),
      total_transactions: todayData.length
    };

    // Bulan ini
    const thisMonth = new Date().toISOString().slice(0, 7);
    const monthData = tinData.filter(d => d.transaction_date && d.transaction_date.startsWith(thisMonth));
    const tinMonth = {
      total_weight: monthData.reduce((sum, d) => sum + (d.weight_kg || 0), 0),
      total_sacks: monthData.reduce((sum, d) => sum + (d.sack_count || 0), 0)
    };

    // Personel
    const activeUsers = db.getAll('users').filter(u => u.status === 'aktif');
    const personnel = {
      total: activeUsers.length,
      admins: activeUsers.filter(u => u.role === 'admin').length,
      officers: activeUsers.filter(u => u.role === 'petugas').length
    };

    // Posts
    const posts = { total: db.getAll('posts').filter(p => p.status === 'aktif').length };

    // 7 hari terakhir per sektor
    const sevenDaysAgo = daysAgo(7);
    const last7Days = tinData.filter(d => d.transaction_date >= sevenDaysAgo);
    
    const sectorMap = {};
    last7Days.forEach(d => {
      const key = d.sector || 'Tidak diketahui';
      if (!sectorMap[key]) sectorMap[key] = { sector: key, total_weight: 0, transactions: 0 };
      sectorMap[key].total_weight += d.weight_kg || 0;
      sectorMap[key].transactions++;
    });
    const bySector = Object.values(sectorMap).sort((a, b) => b.total_weight - a.total_weight);

    // Per pos
    const postMap = {};
    last7Days.forEach(d => {
      const key = d.post_location || '-';
      if (!postMap[key]) postMap[key] = { post_location: key, total_weight: 0, transactions: 0 };
      postMap[key].total_weight += d.weight_kg || 0;
      postMap[key].transactions++;
    });
    const byPost = Object.values(postMap).sort((a, b) => b.total_weight - a.total_weight);

    // Trend harian 7 hari
    const dailyTrend = [];
    for (let i = 6; i >= 0; i--) {
      const date = daysAgo(i);
      const dayData = tinData.filter(d => d.transaction_date === date);
      dailyTrend.push({
        date,
        total_weight: dayData.reduce((sum, d) => sum + (d.weight_kg || 0), 0),
        total_sacks: dayData.reduce((sum, d) => sum + (d.sack_count || 0), 0),
        transactions: dayData.length
      });
    }

    // Kendaraan dicurigai
    const suspectedVehicles = { total: db.getAll('vehicles').filter(v => v.is_suspected === 1).length };

    // Laporan hari ini
    const reportsToday = { total: db.getAll('activity_reports').filter(r => r.report_date === today).length };

    // Sumber timah 30 hari
    const thirtyDaysAgo = daysAgo(30);
    const last30Days = tinData.filter(d => d.transaction_date >= thirtyDaysAgo);
    
    const sourceMap = {};
    last30Days.forEach(d => {
      const key = d.source_type || '-';
      if (!sourceMap[key]) sourceMap[key] = { source_type: key, total_weight: 0 };
      sourceMap[key].total_weight += d.weight_kg || 0;
    });
    const bySource = Object.values(sourceMap);

    // Tujuan
    const destMap = {};
    last30Days.forEach(d => {
      const key = d.destination_type || '-';
      if (!destMap[key]) destMap[key] = { destination_type: key, total_weight: 0 };
      destMap[key].total_weight += d.weight_kg || 0;
    });
    const byDestination = Object.values(destMap);

    res.json({
      success: true,
      data: {
        tin_today: tinToday,
        tin_month: tinMonth,
        personnel,
        posts,
        by_sector: bySector,
        by_post: byPost,
        daily_trend: dailyTrend,
        suspected_vehicles: suspectedVehicles.total,
        reports_today: reportsToday.total,
        by_source: bySource,
        by_destination: byDestination
      }
    });
  } catch (error) {
    res.status(500).json({ success: false, message: 'Server error', error: error.message });
  }
});

// ========== SYSTEM LOGS ==========

app.get('/api/system-logs', authenticateToken, adminOnly, (req, res) => {
  try {
    const users = db.getAll('users');
    const logs = db.getAll('system_logs')
      .sort((a, b) => new Date(b.created_at) - new Date(a.created_at))
      .slice(0, 500)
      .map(l => {
        const u = users.find(x => x.id === l.user_id);
        return { ...l, username: u ? u.username : '-', full_name: u ? u.full_name : '-' };
      });
    res.json({ success: true, data: logs });
  } catch (error) {
    res.status(500).json({ success: false, message: 'Server error' });
  }
});

// ========== ROUTE UTAMA ==========

app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// Jalankan server
setTimeout(() => {
  app.listen(PORT, '0.0.0.0', () => {
    console.log('');
    console.log('========================================');
    console.log('  SISTEM PENDATAAN TIMAH SATLAP TRICAKTI');
    console.log('========================================');
    console.log(`  Server berjalan di http://localhost:${PORT}`);
    console.log(`  Akses jaringan: http://<IP-ANDA>:${PORT}`);
    console.log('');
    console.log('  Akun Admin Default:');
    console.log('    Username: admin');
    console.log('    Password: admin123');
    console.log('');
    console.log('  Deployment VPS: pm2 start server.js --name sistem-timah');
    console.log('========================================');
  });
}, 1500);
