require('dotenv').config();
const express = require('express');
const session = require('express-session');
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const sqlite3 = require('sqlite3').verbose();
const multer = require('multer');
const nunjucks = require('nunjucks');

const app = express();
const PORT = Number(process.env.PORT || 5000);
const ROOT = __dirname;
const DB_PATH = process.env.DATABASE_PATH || path.join(ROOT, 'localart.db');
const TEMPLATES_DIR = path.join(ROOT, 'templates');
const STATIC_DIR = path.join(ROOT, 'static');
const DATA_DIR = path.join(ROOT, 'data');
const UPLOADS_COMMUNITY = path.join(STATIC_DIR, 'uploads', 'community');
const UPLOADS_ARTWORKS = path.join(STATIC_DIR, 'uploads', 'artworks');
const UPLOADS_AVATARS = path.join(STATIC_DIR, 'uploads', 'avatars');

// Ensure upload folders exist
fs.mkdirSync(UPLOADS_COMMUNITY, { recursive: true });
fs.mkdirSync(UPLOADS_ARTWORKS, { recursive: true });
fs.mkdirSync(UPLOADS_AVATARS, { recursive: true });

const avatarStorage = multer.diskStorage({
  destination: (req, file, cb) => {
    cb(null, UPLOADS_AVATARS);
  },
  filename: (req, file, cb) => {
    const ext = path.extname(file.originalname).toLowerCase() || '.jpg';
    cb(null, `avatar_${req.session.user_id}_${Date.now()}${ext}`);
  }
});

const uploadAvatar = multer({
  storage: avatarStorage,
  limits: { fileSize: 5 * 1024 * 1024 },
  fileFilter: (req, file, cb) => {
    const allowed = /jpeg|jpg|png|gif|webp/;
    const ext = allowed.test(path.extname(file.originalname).toLowerCase());
    const mime = allowed.test(file.mimetype);
    if (ext && mime) {
      cb(null, true);
    } else {
      cb(new Error('Only image files (jpg, jpeg, png, gif, webp) are allowed.'));
    }
  }
});

// =============================================================================
// DATABASE INITIALIZATION & HELPERS
// =============================================================================
const db = new sqlite3.Database(DB_PATH, (err) => {
  if (err) {
    console.error(`[DB] Error opening database at ${DB_PATH}:`, err.message);
  } else {
    console.log(`[DB] Connected to SQLite database at ${DB_PATH}`);
  }
});

db.run('PRAGMA foreign_keys = ON');
db.run('PRAGMA busy_timeout = 15000');

function dbAll(sql, params = []) {
  return new Promise((resolve, reject) => {
    db.all(sql, params, (err, rows) => {
      if (err) reject(err);
      else resolve(rows || []);
    });
  });
}

function dbGet(sql, params = []) {
  return new Promise((resolve, reject) => {
    db.get(sql, params, (err, row) => {
      if (err) reject(err);
      else resolve(row || null);
    });
  });
}

function dbRun(sql, params = []) {
  return new Promise((resolve, reject) => {
    db.run(sql, params, function (err) {
      if (err) reject(err);
      else resolve({ lastID: this.lastID, changes: this.changes });
    });
  });
}

// Ensure essential tables exist without altering existing schema
async function initDatabase() {
  await dbRun(`
    CREATE TABLE IF NOT EXISTS users (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      full_name TEXT,
      username TEXT NOT NULL,
      email TEXT UNIQUE NOT NULL,
      mobile TEXT,
      password TEXT NOT NULL,
      city TEXT,
      role TEXT DEFAULT 'customer',
      profile_image TEXT,
      bio TEXT,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    )
  `);

  await dbRun(`
    CREATE TABLE IF NOT EXISTS artists (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER UNIQUE NOT NULL,
      artist_name TEXT NOT NULL,
      city TEXT,
      state TEXT,
      category TEXT,
      bio TEXT,
      profile_image TEXT,
      verified INTEGER DEFAULT 0,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
    )
  `);

  await dbRun(`
    CREATE TABLE IF NOT EXISTS artworks (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      artist_id INTEGER NOT NULL,
      title TEXT NOT NULL,
      description TEXT,
      category TEXT,
      style TEXT,
      location TEXT,
      price REAL DEFAULT 0,
      image TEXT,
      stock INTEGER DEFAULT 1,
      rating REAL DEFAULT 0,
      status TEXT DEFAULT 'pending',
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (artist_id) REFERENCES artists(id) ON DELETE CASCADE
    )
  `);

  await dbRun(`
    CREATE TABLE IF NOT EXISTS wishlist (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL,
      artwork_id INTEGER NOT NULL,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      UNIQUE(user_id, artwork_id),
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
      FOREIGN KEY (artwork_id) REFERENCES artworks(id) ON DELETE CASCADE
    )
  `);

  await dbRun(`
    CREATE TABLE IF NOT EXISTS cart (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER UNIQUE NOT NULL,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
    )
  `);

  await dbRun(`
    CREATE TABLE IF NOT EXISTS cart_items (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      cart_id INTEGER NOT NULL,
      artwork_id INTEGER NOT NULL,
      quantity INTEGER DEFAULT 1,
      UNIQUE(cart_id, artwork_id),
      FOREIGN KEY (cart_id) REFERENCES cart(id) ON DELETE CASCADE,
      FOREIGN KEY (artwork_id) REFERENCES artworks(id) ON DELETE CASCADE
    )
  `);

  await dbRun(`
    CREATE TABLE IF NOT EXISTS orders (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL,
      total_amount REAL DEFAULT 0,
      payment_method TEXT,
      payment_status TEXT DEFAULT 'Pending',
      order_status TEXT DEFAULT 'Confirmed',
      shipping_name TEXT,
      shipping_mobile TEXT,
      shipping_address TEXT,
      shipping_city TEXT,
      shipping_state TEXT,
      shipping_pincode TEXT,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
    )
  `);

  await dbRun(`
    CREATE TABLE IF NOT EXISTS order_items (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      order_id INTEGER NOT NULL,
      artwork_id INTEGER NOT NULL,
      artist_id INTEGER,
      quantity INTEGER DEFAULT 1,
      price REAL DEFAULT 0,
      FOREIGN KEY (order_id) REFERENCES orders(id) ON DELETE CASCADE,
      FOREIGN KEY (artwork_id) REFERENCES artworks(id) ON DELETE CASCADE,
      FOREIGN KEY (artist_id) REFERENCES artists(id) ON DELETE SET NULL
    )
  `);

  await dbRun(`
    CREATE TABLE IF NOT EXISTS reviews (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL,
      artwork_id INTEGER NOT NULL,
      rating INTEGER NOT NULL,
      review TEXT,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
      FOREIGN KEY (artwork_id) REFERENCES artworks(id) ON DELETE CASCADE
    )
  `);

  await dbRun(`
    CREATE TABLE IF NOT EXISTS community_posts (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL,
      title TEXT,
      content TEXT,
      image TEXT,
      likes INTEGER DEFAULT 0,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      category TEXT DEFAULT 'general',
      city TEXT,
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
    )
  `);

  const artCount = await dbGet('SELECT COUNT(*) AS cnt FROM artworks');
  if (!artCount || artCount.cnt === 0) {
    console.log('[DB] Seeding default shop artworks and artists...');
    const defaultArtworks = [
      { id: 1, title: "Monsoon Dreams", artist_name: "Aarohi Patil", price: 2800, category: "Painting", image: "images/art1.jpg", rating: 4.8, city: "Pune" },
      { id: 2, title: "Heritage Streets", artist_name: "Rohan Jadhav", price: 1900, category: "Sketch", image: "images/art2.jpg", rating: 4.6, city: "Nashik" },
      { id: 3, title: "Warli Tales", artist_name: "Meera Shinde", price: 3200, category: "Craft", image: "images/art3.jpg", rating: 4.9, city: "Thane" },
      { id: 4, title: "Village Morning", artist_name: "Sahil More", price: 2400, category: "Painting", image: "images/art4.jpg", rating: 4.7, city: "Kolhapur" },
      { id: 5, title: "Old Pune", artist_name: "Kavya Deshmukh", price: 1700, category: "Sketch", image: "images/art5.jpg", rating: 4.5, city: "Pune" },
      { id: 6, title: "Earth & Hands", artist_name: "Nisha Kale", price: 2600, category: "Craft", image: "images/art6.jpg", rating: 4.8, city: "Nagpur" },
      { id: 7, title: "Colours of Maharashtra", artist_name: "Anaya Kulkarni", price: 3400, category: "Painting", image: "images/art7.jpg", rating: 4.9, city: "Satara" },
      { id: 8, title: "Rainy Evening", artist_name: "Vedant Joshi", price: 1850, category: "Sketch", image: "images/art8.jpg", rating: 4.4, city: "Pune" },
      { id: 9, title: "Handmade Memories", artist_name: "Isha Pawar", price: 2950, category: "Craft", image: "images/art9.jpg", rating: 4.7, city: "Solapur" },
      { id: 10, title: "Sunset Village", artist_name: "Om Deshpande", price: 2500, category: "Painting", image: "images/art10.jpg", rating: 4.6, city: "Aurangabad" },
      { id: 11, title: "Temple Stories", artist_name: "Riya Shinde", price: 1650, category: "Sketch", image: "images/art11.jpg", rating: 4.5, city: "Nashik" },
      { id: 12, title: "Traditional Roots", artist_name: "Mahi Patil", price: 3100, category: "Craft", image: "images/art12.jpg", rating: 4.8, city: "Kolhapur" },
      { id: 13, title: "Beyond The Hills", artist_name: "Arjun More", price: 2900, category: "Painting", image: "images/art13.jpg", rating: 4.9, city: "Pune" }
    ];

    for (const item of defaultArtworks) {
      const userEmail = `${item.artist_name.toLowerCase().replace(/[^a-z0-9]/g, '')}@localart.com`;
      const username = item.artist_name.toLowerCase().replace(/[^a-z0-9]/g, '_');
      let user = await dbGet('SELECT id FROM users WHERE email = ?', [userEmail]);
      if (!user) {
        const uRes = await dbRun(
          `INSERT INTO users (full_name, username, email, mobile, city, role, password)
           VALUES (?, ?, ?, '9999999999', ?, 'artist', 'scrypt:seeded')`,
          [item.artist_name, username, userEmail, item.city]
        );
        user = { id: uRes.lastID };
      }
      let artist = await dbGet('SELECT id FROM artists WHERE artist_name = ?', [item.artist_name]);
      if (!artist) {
        const aRes = await dbRun(
          `INSERT INTO artists (id, user_id, artist_name, city, category, verified)
           VALUES (?, ?, ?, ?, ?, 1)`,
          [item.id, user.id, item.artist_name, item.city, item.category]
        );
        artist = { id: aRes.lastID || item.id };
      }
      const existingArt = await dbGet('SELECT id FROM artworks WHERE id = ?', [item.id]);
      if (!existingArt) {
        await dbRun(
          `INSERT INTO artworks (id, artist_id, title, description, category, price, image, stock, rating, status)
           VALUES (?, ?, ?, ?, ?, ?, ?, 10, ?, 'approved')`,
          [item.id, artist.id, item.title, `Authentic handmade ${item.category} by ${item.artist_name}.`, item.category, item.price, item.image, item.rating]
        );
      }
    }
  }
}
initDatabase().catch(err => console.error('[DB] Schema check error:', err));

// =============================================================================
// PASSWORD COMPATIBILITY (Werkzeug scrypt)
// =============================================================================
function verifyWerkzeugPassword(password, encoded) {
  if (!encoded) return false;
  if (encoded.startsWith('scrypt:')) {
    try {
      const [method, salt, expectedHex] = encoded.split('$');
      const [, n, r, p] = method.split(':').map((x, i) => (i === 0 ? x : Number(x)));
      const cost = 128 * n * r;
      const maxmem = Math.max(128 * 1024 * 1024, cost * 2);
      const derived = crypto.scryptSync(String(password), salt, expectedHex.length / 2, {
        N: n,
        r: r,
        p: p,
        maxmem: maxmem
      });
      const expected = Buffer.from(expectedHex, 'hex');
      return expected.length === derived.length && crypto.timingSafeEqual(expected, derived);
    } catch (e) {
      console.error('[AUTH SCRYPT ERROR]', e);
      return false;
    }
  }
  // Fallback for sha256 or plain comparison if any legacy format exists
  if (encoded.startsWith('pbkdf2:')) {
    try {
      const parts = encoded.split('$');
      const [, iterations] = parts[0].split(':');
      const salt = parts[1];
      const expectedHex = parts[2];
      const derived = crypto.pbkdf2Sync(String(password), salt, Number(iterations), expectedHex.length / 2, 'sha256');
      return crypto.timingSafeEqual(Buffer.from(expectedHex, 'hex'), derived);
    } catch (_) {
      return false;
    }
  }
  return password === encoded;
}

function createWerkzeugScryptHash(password) {
  const salt = crypto.randomBytes(16).toString('hex');
  const n = 32768, r = 8, p = 1;
  const cost = 128 * n * r;
  const maxmem = Math.max(128 * 1024 * 1024, cost * 2);
  const derived = crypto.scryptSync(String(password), salt, 64, {
    N: n,
    r: r,
    p: p,
    maxmem: maxmem
  });
  return `scrypt:${n}:${r}:${p}$${salt}$${derived.toString('hex')}`;
}

// =============================================================================
// JSON DATA FILES (Culture, Art History, Events)
// =============================================================================
function loadJson(file, fallback = {}) {
  try {
    const p = path.join(DATA_DIR, file);
    if (fs.existsSync(p)) return JSON.parse(fs.readFileSync(p, 'utf8'));
  } catch (e) {
    console.error(`[DATA] Error reading ${file}:`, e.message);
  }
  return fallback;
}

const ART_HISTORY = loadJson('art_history.json');
const REGIONAL_ART = loadJson('regional_art.json');
const REGIONAL_ART_DETAILS = loadJson('regional_art_details.json');
const LOCALART_EVENTS = loadJson('events.json');

const SHOP_STATUSES = [
  'Order Placed',
  'Confirmed',
  'Preparing',
  'Shipped',
  'Out for Delivery',
  'Delivered'
];

// =============================================================================
// NUNJUCKS TEMPLATE SETUP (Matches Jinja2)
// =============================================================================
const nunjucksEnv = nunjucks.configure(TEMPLATES_DIR, {
  autoescape: true,
  noCache: true
});

function urlFor(name, kwargs = {}) {
  if (name === 'static') {
    const filename = kwargs.filename || '';
    return `/static/${String(filename).replace(/^\/+/, '')}`;
  }

  const routes = {
    home: '/',
    auth: '/auth',
    dashboard: '/dashboard',
    profile: '/profile',
    shop: '/shop',
    wishlist: '/wishlist',
    cart: '/cart',
    checkout: '/checkout',
    place_order: '/place-order',
    orders: '/orders',
    reviews: '/reviews',
    artists: '/artists',
    culture: '/culture',
    events: '/events',
    custom_art: '/custom-art',
    community: '/community',
    assistant: '/assistant',
    settings: '/settings',
    feedback: '/feedback',
    logout: '/logout',
    admin: '/admin',
    admin_artworks: '/admin/artworks',
    admin_users: '/admin/users',
    admin_orders: '/admin/orders',
    admin_events: '/admin/events',
    artist_dashboard: '/artist/dashboard',
    artist_upload: '/artist/upload',
    artist_artworks: '/artist/artworks',
    artist_orders: '/artist/orders',
    artist_custom_requests: '/artist/custom-requests',
    artist_events: '/artist/events',
    artist_earnings: '/artist/earnings',
    artist_messages: '/artist/messages',
    test: '/test'
  };

  if (name === 'artwork' || name === 'artwork_detail') {
    return `/artwork/${kwargs.artwork_id || kwargs.id || ''}`;
  }
  if (name === 'order_details') {
    return `/order/${kwargs.order_id || kwargs.id || ''}`;
  }
  if (name === 'tracking') {
    return `/order/${kwargs.order_id || kwargs.id || ''}/track`;
  }
  if (name === 'invoice') {
    return `/invoice/${kwargs.order_id || kwargs.id || ''}`;
  }
  if (name === 'order_success') {
    return `/order-success/${kwargs.order_id || kwargs.id || ''}`;
  }
  if (name === 'artist_profile') {
    return `/artist/${kwargs.artist_id || kwargs.id || ''}`;
  }
  if (name === 'art_history') {
    return `/culture/${kwargs.slug || ''}`;
  }
  if (name === 'regional_detail') {
    return `/regional-art/${kwargs.slug || ''}`;
  }
  if (name === 'regional_art') {
    return `/culture/region/${kwargs.state || ''}`;
  }
  if (name === 'event_details') {
    return `/event/${kwargs.event_id || kwargs.id || ''}`;
  }
  if (name === 'review_product') {
    return `/review/${kwargs.artwork_id || kwargs.id || ''}`;
  }

  return routes[name] || '#';
}

nunjucksEnv.addGlobal('url_for', urlFor);
nunjucksEnv.addGlobal('range', (start, end) => {
  const arr = [];
  for (let i = start; i < end; i++) arr.push(i);
  return arr;
});

nunjucksEnv.addFilter('format', (value, ...args) => {
  if (typeof value === 'string' && value.includes('%') && args.length > 0) {
    const match = value.match(/%\.(\d+)f/);
    if (match) {
      return Number(args[0] || 0).toFixed(Number(match[1]));
    }
  }
  return args[0] !== undefined ? args[0] : value;
});

nunjucksEnv.addFilter('unique', (arr) => {
  if (!Array.isArray(arr)) return arr;
  return [...new Set(arr)];
});

nunjucksEnv.addFilter('map', (arr, ...args) => {
  if (!Array.isArray(arr)) return [];
  let attr = null;
  for (const arg of args) {
    if (typeof arg === 'string') attr = arg;
    else if (arg && typeof arg === 'object' && arg.attribute) attr = arg.attribute;
  }
  if (attr) {
    return arr.map(item => (item ? item[attr] : undefined)).filter(x => x !== undefined && x !== null);
  }
  return arr;
});

app.engine('html', (filePath, options, callback) => {
  nunjucksEnv.render(path.basename(filePath), options, callback);
});
app.set('view engine', 'html');
app.set('views', TEMPLATES_DIR);

// Safe render helper: renders template if exists; otherwise shows clean placeholder
function safeRender(res, templateName, context = {}) {
  const fullPath = path.join(TEMPLATES_DIR, templateName.endsWith('.html') ? templateName : `${templateName}.html`);
  if (fs.existsSync(fullPath)) {
    return res.render(templateName, context);
  }
  // Render fallback for unsupplied templates (e.g. admin or artist dashboard)
  const title = templateName.replace(/[_-]/g, ' ').replace(/\.html$/, '');
  const capitalized = title.charAt(0).toUpperCase() + title.slice(1);
  return res.send(`
    <!DOCTYPE html>
    <html lang="en">
    <head>
      <meta charset="UTF-8">
      <title>${capitalized} — KalaSetu</title>
      <link rel="stylesheet" href="/static/css/base.css">
      <style>
        .placeholder-box { max-width: 800px; margin: 80px auto; padding: 40px; background: #fff; border-radius: 12px; box-shadow: 0 4px 20px rgba(0,0,0,0.06); text-align: center; }
        .placeholder-box h1 { margin-bottom: 12px; color: #8B4513; }
        .placeholder-box p { color: #666; margin-bottom: 24px; }
        .btn-back { display: inline-block; padding: 10px 24px; background: #8B4513; color: #fff; border-radius: 6px; text-decoration: none; }
      </style>
    </head>
    <body>
      <div class="placeholder-box">
        <h1>${capitalized}</h1>
        <p>This section is connected to the Node.js backend. You can manage data directly through your dashboard.</p>
        <a href="/" class="btn-back">Return to Home</a>
      </div>
    </body>
    </html>
  `);
}

// =============================================================================
// FILE UPLOAD SETUP (Multer)
// =============================================================================
const storageCommunity = multer.diskStorage({
  destination: (req, file, cb) => cb(null, UPLOADS_COMMUNITY),
  filename: (req, file, cb) => {
    const ext = path.extname(file.originalname).toLowerCase();
    cb(null, `post_${Date.now()}_${crypto.randomBytes(4).toString('hex')}${ext}`);
  }
});
const uploadCommunity = multer({
  storage: storageCommunity,
  limits: { fileSize: 10 * 1024 * 1024 }
});

const storageArtwork = multer.diskStorage({
  destination: (req, file, cb) => cb(null, UPLOADS_ARTWORKS),
  filename: (req, file, cb) => {
    const ext = path.extname(file.originalname).toLowerCase();
    cb(null, `art_${Date.now()}_${crypto.randomBytes(4).toString('hex')}${ext}`);
  }
});
const uploadArtwork = multer({
  storage: storageArtwork,
  limits: { fileSize: 15 * 1024 * 1024 }
});

// =============================================================================
// EXPRESS MIDDLEWARES
// =============================================================================
app.use(express.urlencoded({ extended: true }));
app.use(express.json());

app.use(
  session({
    secret: process.env.SESSION_SECRET || 'localart_secret_key',
    resave: false,
    saveUninitialized: false,
    cookie: {
      httpOnly: true,
      sameSite: 'lax',
      maxAge: 7 * 24 * 60 * 60 * 1000 // 7 days
    }
  })
);

// Serve static assets exactly matching Flask's `/static` prefix
app.use('/static', express.static(STATIC_DIR));

// Helper: Cart count
async function getCartCount(userId) {
  if (!userId) return 0;
  try {
    const row = await dbGet(
      `SELECT SUM(ci.quantity) AS cnt
       FROM cart_items ci
       JOIN cart c ON c.id = ci.cart_id
       WHERE c.user_id = ?`,
      [userId]
    );
    return row && row.cnt ? row.cnt : 0;
  } catch (_) {
    return 0;
  }
}

// Helper: Wishlist ids
async function getWishlistIds(userId) {
  if (!userId) return [];
  try {
    const rows = await dbAll('SELECT artwork_id FROM wishlist WHERE user_id = ?', [userId]);
    return rows.map((r) => r.artwork_id);
  } catch (_) {
    return [];
  }
}

// Global template locals (matching Flask's request, session, current_user)
app.use(async (req, res, next) => {
  res.locals.session = req.session;
  res.locals.logged_in = !!req.session.user_id;

  let currentUser = null;
  if (req.session.user_id) {
    currentUser = await dbGet('SELECT * FROM users WHERE id = ?', [req.session.user_id]);
    if (!currentUser) {
      req.session.destroy(() => {});
    }
  }
  res.locals.current_user = currentUser;
  res.locals.user = currentUser;

  res.locals.cart_count = await getCartCount(req.session.user_id);
  res.locals.wishlist_ids = await getWishlistIds(req.session.user_id);
  res.locals.wishlist_count = res.locals.wishlist_ids.length;

  res.locals.request = {
    args: {
      get: (key, def = '') => (req.query[key] !== undefined ? req.query[key] : def)
    },
    query: req.query,
    path: req.path
  };

  next();
});

// Auth Guards
function requireLogin(req, res, next) {
  if (!req.session.user_id) return res.redirect('/auth');
  next();
}

function requireAdmin(req, res, next) {
  if (!req.session.user_id) return res.redirect('/auth');
  if (req.session.role !== 'admin') return res.redirect('/');
  next();
}

function requireArtist(req, res, next) {
  if (!req.session.user_id) return res.redirect('/auth');
  if (!['artist', 'admin'].includes(req.session.role)) return res.redirect('/');
  next();
}

async function getOrCreateArtist(userId) {
  let artist = await dbGet('SELECT * FROM artists WHERE user_id = ?', [userId]);
  if (!artist) {
    const user = await dbGet('SELECT * FROM users WHERE id = ?', [userId]);
    if (user) {
      const res = await dbRun(
        'INSERT INTO artists (user_id, artist_name, city, category) VALUES (?, ?, ?, ?)',
        [userId, user.full_name || user.username, user.city || 'Pune', 'Painting']
      );
      artist = await dbGet('SELECT * FROM artists WHERE user_id = ?', [userId]);
    }
  }
  return artist || { id: 1, user_id: userId, artist_name: 'Artist', city: 'Pune', rating: 4.8 };
}

// Helper: Get or create user cart
async function getOrCreateCart(userId) {
  let cart = await dbGet('SELECT * FROM cart WHERE user_id = ?', [userId]);
  if (!cart) {
    const res = await dbRun('INSERT INTO cart (user_id) VALUES (?)', [userId]);
    cart = { id: res.lastID, user_id: userId };
  }
  return cart;
}

// =============================================================================
// ROUTES: HOME & AUTHENTICATION
// =============================================================================
app.get('/', (req, res) => safeRender(res, 'home'));

app.route('/auth')
  .get((req, res) => {
    if (req.session && req.session.user_id) {
      if (req.session.role === 'admin') return res.redirect('/admin');
      if (req.session.role === 'artist') return res.redirect('/artist/dashboard');
      return res.redirect('/dashboard');
    }
    return safeRender(res, 'auth');
  })
  .post(async (req, res) => {
    const formType = req.body.form_type;

    try {
      // ----------------- SIGN UP -----------------
      if (formType === 'signup') {
        const full_name = String(req.body.full_name || '').trim();
        const username = String(req.body.username || '').trim();
        const email = String(req.body.email || '').trim().toLowerCase();
        const mobile = String(req.body.mobile || '').trim();
        const city = String(req.body.city || '').trim();
        let role = String(req.body.role || 'customer').trim().toLowerCase();
        const password = String(req.body.password || '');
        const confirm_password = String(req.body.confirm_password || '');

        if (!full_name || !username || !email || !mobile || !city || !password || !confirm_password) {
          return res.status(400).render('auth', {
            error: 'Please fill all required fields.',
            mode: 'signup'
          });
        }

        if (password !== confirm_password) {
          return res.status(400).render('auth', {
            error: 'Passwords do not match.',
            mode: 'signup'
          });
        }

        if (password.length < 6) {
          return res.status(400).render('auth', {
            error: 'Password must contain at least 6 characters.',
            mode: 'signup'
          });
        }

        if (!/^\d{10}$/.test(mobile)) {
          return res.status(400).render('auth', {
            error: 'Please enter a valid 10-digit mobile number.',
            mode: 'signup'
          });
        }

        if (!['customer', 'artist'].includes(role)) {
          role = 'customer';
        }

        const existing = await dbGet(
          'SELECT id FROM users WHERE email = ? OR username = ?',
          [email, username]
        );
        if (existing) {
          return res.status(409).render('auth', {
            error: 'Email or username already exists.',
            mode: 'signup'
          });
        }

        const hashedPassword = createWerkzeugScryptHash(password);
        const result = await dbRun(
          `INSERT INTO users (full_name, username, email, mobile, city, role, password)
           VALUES (?, ?, ?, ?, ?, ?, ?)`,
          [full_name, username, email, mobile, city, role, hashedPassword]
        );

        const userId = result.lastID;

        if (role === 'artist') {
          await dbRun(
            'INSERT INTO artists (user_id, artist_name, city) VALUES (?, ?, ?)',
            [userId, full_name, city]
          );
        }

        const newUser = await dbGet('SELECT * FROM users WHERE id = ?', [userId]);
        req.session.user_id = newUser.id;
        req.session.username = newUser.username;
        req.session.full_name = newUser.full_name || newUser.username;
        req.session.role = newUser.role;

        return req.session.save((saveErr) => {
          if (saveErr) console.error('[SESSION SAVE ERROR]', saveErr);
          return res.redirect(role === 'artist' ? '/artist/dashboard' : '/dashboard');
        });
      }

      // ----------------- LOGIN -----------------
      if (formType === 'login') {
        const email = String(req.body.email || '').trim().toLowerCase();
        const password = String(req.body.password || '');

        if (!email || !password) {
          return res.status(400).render('auth', {
            error: 'Please enter email and password.'
          });
        }

        const user = await dbGet(
          'SELECT * FROM users WHERE email = ? OR username = ?',
          [email, email]
        );

        if (!user || !verifyWerkzeugPassword(password, user.password)) {
          return res.status(401).render('auth', {
            error: 'Invalid email or password.'
          });
        }

        req.session.user_id = user.id;
        req.session.username = user.username;
        req.session.full_name = user.full_name || user.username;
        req.session.role = user.role;

        return req.session.save((saveErr) => {
          if (saveErr) console.error('[SESSION SAVE ERROR]', saveErr);
          if (user.role === 'admin') return res.redirect('/admin');
          if (user.role === 'artist') return res.redirect('/artist/dashboard');
          return res.redirect('/dashboard');
        });
      }

      return safeRender(res, 'auth');
    } catch (err) {
      console.error('[AUTH ERROR]', err);
      return res.status(500).render('auth', {
        error: 'Something went wrong. Please try again.'
      });
    }
  });

app.get('/dashboard', requireLogin, async (req, res) => {
  const user = await dbGet('SELECT * FROM users WHERE id = ?', [req.session.user_id]);
  if (!user) {
    req.session.destroy(() => {});
    return res.redirect('/auth');
  }
  safeRender(res, 'dashboard', { user });
});

app.get('/profile', requireLogin, async (req, res) => {
  const user = await dbGet('SELECT * FROM users WHERE id = ?', [req.session.user_id]);
  if (!user) {
    req.session.destroy(() => {});
    return res.redirect('/auth');
  }
  safeRender(res, 'profile', { user });
});

app.post('/api/profile/update', requireLogin, async (req, res) => {
  try {
    const userId = req.session.user_id;
    const full_name = String(req.body.full_name || '').trim();
    const mobile = String(req.body.mobile || '').trim();
    const city = String(req.body.city || '').trim();
    const bio = String(req.body.bio || '').trim();

    if (!full_name) {
      return res.status(400).json({ success: false, message: 'Full name is required.' });
    }

    if (mobile && !/^\d{10}$/.test(mobile)) {
      return res.status(400).json({ success: false, message: 'Please enter a valid 10-digit mobile number.' });
    }

    await dbRun(
      `UPDATE users SET full_name = ?, mobile = ?, city = ?, bio = ? WHERE id = ?`,
      [full_name, mobile, city, bio, userId]
    );

    if (req.session.role === 'artist') {
      const artist = await dbGet('SELECT id FROM artists WHERE user_id = ?', [userId]);
      if (artist) {
        await dbRun(
          `UPDATE artists SET artist_name = ?, city = ?, bio = ? WHERE user_id = ?`,
          [full_name, city, bio, userId]
        );
      }
    }

    req.session.full_name = full_name;
    await new Promise((resolve) => req.session.save(resolve));

    const updatedUser = await dbGet('SELECT * FROM users WHERE id = ?', [userId]);

    return res.json({
      success: true,
      message: 'Profile updated successfully!',
      user: updatedUser
    });
  } catch (err) {
    console.error('[PROFILE UPDATE ERROR]', err);
    return res.status(500).json({ success: false, message: 'Failed to update profile.' });
  }
});

app.post('/api/profile/upload-avatar', requireLogin, (req, res) => {
  uploadAvatar.single('avatar')(req, res, async (err) => {
    if (err) {
      return res.status(400).json({ success: false, message: err.message || 'File upload failed.' });
    }
    if (!req.file) {
      return res.status(400).json({ success: false, message: 'Please select an image file to upload.' });
    }

    try {
      const userId = req.session.user_id;
      const avatarUrl = `/static/uploads/avatars/${req.file.filename}`;

      await dbRun('UPDATE users SET profile_image = ? WHERE id = ?', [avatarUrl, userId]);

      if (req.session.role === 'artist') {
        await dbRun('UPDATE artists SET profile_image = ? WHERE user_id = ?', [avatarUrl, userId]);
      }

      return res.json({
        success: true,
        message: 'Profile picture updated successfully!',
        profile_image: avatarUrl
      });
    } catch (dbErr) {
      console.error('[AVATAR UPLOAD ERROR]', dbErr);
      return res.status(500).json({ success: false, message: 'Failed to update avatar in database.' });
    }
  });
});

app.get('/logout', (req, res) => {
  req.session.destroy(() => res.redirect('/'));
});

// =============================================================================
// ROUTES: SHOP, ARTWORKS, WISHLIST, CART, CHECKOUT, ORDERS
// =============================================================================
app.get('/shop', async (req, res) => {
  const userId = req.session.user_id;
  try {
    let artworks;
    if (userId) {
      artworks = await dbAll(
        `SELECT
           a.*,
           ar.artist_name,
           ar.city AS artist_city,
           CASE WHEN w.id IS NOT NULL THEN 1 ELSE 0 END AS wishlisted
         FROM artworks a
         JOIN artists ar ON a.artist_id = ar.id
         LEFT JOIN wishlist w ON w.artwork_id = a.id AND w.user_id = ?
         WHERE a.status IN ('approved', 'active')
         ORDER BY a.created_at DESC`,
        [userId]
      );
    } else {
      artworks = await dbAll(
        `SELECT
           a.*,
           ar.artist_name,
           ar.city AS artist_city,
           0 AS wishlisted
         FROM artworks a
         JOIN artists ar ON a.artist_id = ar.id
         WHERE a.status IN ('approved', 'active')
         ORDER BY a.created_at DESC`
      );
    }

    const cartCount = await getCartCount(userId);
    safeRender(res, 'shop', { artworks, cart_count: cartCount });
  } catch (err) {
    console.error('[SHOP ERROR]', err);
    safeRender(res, 'shop', { artworks: [], cart_count: 0 });
  }
});

app.get(['/artwork/:artwork_id', '/artwork-detail/:artwork_id'], async (req, res) => {
  const artworkId = Number(req.params.artwork_id);
  const userId = req.session.user_id;

  try {
    const artwork = await dbGet(
      `SELECT a.*, ar.artist_name, ar.city AS artist_city, ar.id AS artist_id
       FROM artworks a
       JOIN artists ar ON a.artist_id = ar.id
       WHERE a.id = ?`,
      [artworkId]
    );

    if (!artwork) return res.status(404).send('Artwork not found');

    const reviews = await dbAll(
      `SELECT r.*, u.username, u.full_name
       FROM reviews r
       JOIN users u ON r.user_id = u.id
       WHERE r.artwork_id = ?
       ORDER BY r.created_at DESC`,
      [artworkId]
    );

    const related = await dbAll(
      `SELECT a.*, ar.artist_name
       FROM artworks a
       JOIN artists ar ON a.artist_id = ar.id
       WHERE a.category = ? AND a.id != ? AND a.status IN ('approved', 'active')
       ORDER BY a.rating DESC
       LIMIT 4`,
      [artwork.category, artworkId]
    );

    let wishlisted = false;
    if (userId) {
      const wish = await dbGet(
        'SELECT id FROM wishlist WHERE user_id = ? AND artwork_id = ?',
        [userId, artworkId]
      );
      wishlisted = !!wish;
    }

    const gallery = artwork.image ? [artwork.image] : [];
    const cartCount = await getCartCount(userId);

    safeRender(res, 'artwork', {
      artwork,
      reviews,
      review_count: reviews.length,
      related,
      wishlisted,
      gallery,
      cart_count: cartCount
    });
  } catch (err) {
    console.error('[ARTWORK ERROR]', err);
    res.status(500).send('Error loading artwork');
  }
});

app.get('/wishlist', requireLogin, async (req, res) => {
  const userId = req.session.user_id;
  try {
    const artworks = await dbAll(
      `SELECT a.*, ar.artist_name
       FROM wishlist w
       JOIN artworks a ON w.artwork_id = a.id
       LEFT JOIN artists ar ON a.artist_id = ar.id
       WHERE w.user_id = ?
       ORDER BY w.created_at DESC`,
      [userId]
    );
    const cartCount = await getCartCount(userId);
    safeRender(res, 'wishlist', { artworks, cart_count: cartCount });
  } catch (err) {
    console.error('[WISHLIST ERROR]', err);
    safeRender(res, 'wishlist', { artworks: [], cart_count: 0 });
  }
});

app.post('/api/wishlist/toggle', requireLogin, async (req, res) => {
  const artworkId = Number(req.body.artwork_id);
  const userId = req.session.user_id;

  if (!artworkId) {
    return res.status(400).json({ success: false, message: 'Artwork not selected.' });
  }

  try {
    const found = await dbGet(
      'SELECT id FROM wishlist WHERE user_id = ? AND artwork_id = ?',
      [userId, artworkId]
    );

    if (found) {
      await dbRun('DELETE FROM wishlist WHERE id = ?', [found.id]);
      return res.json({ success: true, wishlisted: false });
    } else {
      await dbRun(
        'INSERT OR IGNORE INTO wishlist (user_id, artwork_id) VALUES (?, ?)',
        [userId, artworkId]
      );
      return res.json({ success: true, wishlisted: true });
    }
  } catch (err) {
    console.error('[WISHLIST TOGGLE ERROR]', err);
    return res.status(500).json({ success: false, message: 'Failed to toggle wishlist.' });
  }
});

app.get('/cart', requireLogin, async (req, res) => {
  const userId = req.session.user_id;
  try {
    const cart = await getOrCreateCart(userId);
    const items = await dbAll(
      `SELECT
         ci.id AS cart_item_id,
         ci.artwork_id,
         ci.quantity,
         a.title,
         a.price,
         a.image,
         a.category,
         a.stock,
         ar.artist_name
       FROM cart_items ci
       JOIN artworks a ON ci.artwork_id = a.id
       LEFT JOIN artists ar ON a.artist_id = ar.id
       WHERE ci.cart_id = ?
       ORDER BY ci.id DESC`,
      [cart.id]
    );

    const formattedItems = items.map((item) => ({
      ...item,
      line_total: (item.price || 0) * item.quantity
    }));

    const subtotal = formattedItems.reduce((acc, it) => acc + it.line_total, 0);
    const delivery = subtotal >= 2000 || subtotal === 0 ? 0 : 99;
    const total = subtotal + delivery;

    safeRender(res, 'cart', {
      cart_items: formattedItems,
      items: formattedItems,
      subtotal,
      delivery,
      total,
      cart_count: formattedItems.reduce((acc, it) => acc + it.quantity, 0)
    });
  } catch (err) {
    console.error('[CART ERROR]', err);
    safeRender(res, 'cart', { cart_items: [], items: [], subtotal: 0, delivery: 0, total: 0 });
  }
});

app.post('/api/cart/add', requireLogin, async (req, res) => {
  const artworkId = Number(req.body.artwork_id);
  const quantity = Math.max(1, Number(req.body.quantity) || 1);
  const userId = req.session.user_id;

  if (!artworkId) {
    return res.status(400).json({ success: false, message: 'Artwork not selected.' });
  }

  try {
    const artwork = await dbGet(
      'SELECT id, stock, status FROM artworks WHERE id = ?',
      [artworkId]
    );
    if (!artwork || !['approved', 'active'].includes(artwork.status)) {
      return res.status(404).json({ success: false, message: 'Artwork not found or inactive.' });
    }

    const cart = await getOrCreateCart(userId);
    const existing = await dbGet(
      'SELECT id, quantity FROM cart_items WHERE cart_id = ? AND artwork_id = ?',
      [cart.id, artworkId]
    );

    const newQty = (existing ? existing.quantity : 0) + quantity;
    if (newQty > artwork.stock) {
      return res.status(400).json({
        success: false,
        message: `Only ${artwork.stock} items available in stock.`
      });
    }

    if (existing) {
      await dbRun('UPDATE cart_items SET quantity = ? WHERE id = ?', [newQty, existing.id]);
    } else {
      await dbRun(
        'INSERT INTO cart_items (cart_id, artwork_id, quantity) VALUES (?, ?, ?)',
        [cart.id, artworkId, quantity]
      );
    }

    const totalCount = await getCartCount(userId);
    return res.json({ success: true, message: 'Added to cart successfully.', cart_count: totalCount });
  } catch (err) {
    console.error('[CART ADD ERROR]', err);
    return res.status(500).json({ success: false, message: 'Failed to add to cart.' });
  }
});

app.post('/api/cart/update', requireLogin, async (req, res) => {
  const artworkId = Number(req.body.artwork_id);
  const quantity = Math.max(1, Number(req.body.quantity) || 1);
  const userId = req.session.user_id;

  try {
    const cart = await getOrCreateCart(userId);
    await dbRun(
      'UPDATE cart_items SET quantity = ? WHERE cart_id = ? AND artwork_id = ?',
      [quantity, cart.id, artworkId]
    );
    return res.json({ success: true, message: 'Cart updated.' });
  } catch (err) {
    console.error('[CART UPDATE ERROR]', err);
    return res.status(500).json({ success: false, message: 'Failed to update cart.' });
  }
});

app.post('/api/cart/remove', requireLogin, async (req, res) => {
  const artworkId = Number(req.body.artwork_id);
  const cartItemId = Number(req.body.cart_item_id);
  const userId = req.session.user_id;

  try {
    const cart = await getOrCreateCart(userId);
    if (artworkId) {
      await dbRun('DELETE FROM cart_items WHERE cart_id = ? AND artwork_id = ?', [cart.id, artworkId]);
    } else if (cartItemId) {
      await dbRun('DELETE FROM cart_items WHERE cart_id = ? AND id = ?', [cart.id, cartItemId]);
    }
    return res.json({ success: true, message: 'Item removed.' });
  } catch (err) {
    console.error('[CART REMOVE ERROR]', err);
    return res.status(500).json({ success: false, message: 'Failed to remove item.' });
  }
});

app.get('/checkout', requireLogin, async (req, res) => {
  const userId = req.session.user_id;
  const buyNow = Number(req.query.buy_now);
  const quantity = Math.max(1, Number(req.query.quantity) || 1);

  try {
    let items = [];
    if (buyNow) {
      const art = await dbGet(
        `SELECT a.id AS artwork_id, a.title, a.price, a.image, a.stock, ar.artist_name
         FROM artworks a
         JOIN artists ar ON a.artist_id = ar.id
         WHERE a.id = ? AND a.status IN ('approved', 'active')`,
        [buyNow]
      );
      if (art) {
        items = [{ ...art, quantity }];
      }
    } else {
      const cart = await getOrCreateCart(userId);
      items = await dbAll(
        `SELECT
           ci.artwork_id,
           ci.quantity,
           a.title,
           a.price,
           a.image,
           a.stock,
           ar.artist_name
         FROM cart_items ci
         JOIN artworks a ON ci.artwork_id = a.id
         JOIN artists ar ON a.artist_id = ar.id
         WHERE ci.cart_id = ?`,
        [cart.id]
      );
    }

    const formattedItems = items.map((item) => ({
      ...item,
      line_total: (item.price || 0) * item.quantity
    }));

    const subtotal = formattedItems.reduce((acc, it) => acc + it.line_total, 0);
    const delivery = subtotal >= 2000 || subtotal === 0 ? 0 : 99;
    const total = subtotal + delivery;

    safeRender(res, 'checkout', {
      items: formattedItems,
      subtotal,
      delivery,
      total,
      buy_now: buyNow || null,
      buy_now_quantity: quantity
    });
  } catch (err) {
    console.error('[CHECKOUT ERROR]', err);
    safeRender(res, 'checkout', { items: [], subtotal: 0, delivery: 0, total: 0 });
  }
});

app.post('/place-order', requireLogin, async (req, res) => {
  const userId = req.session.user_id;
  const name = String(req.body.shipping_name || '').trim();
  const mobile = String(req.body.shipping_mobile || '').trim();
  const address = String(req.body.shipping_address || '').trim();
  const city = String(req.body.shipping_city || '').trim();
  const state = String(req.body.shipping_state || '').trim();
  const pincode = String(req.body.shipping_pincode || '').trim();
  const paymentMethod = String(req.body.payment_method || 'UPI (Demo)');
  const buyNow = Number(req.body.buy_now);
  const buyNowQuantity = Math.max(1, Number(req.body.buy_now_quantity) || 1);

  if (!name || !mobile || !address || !city || !state || !pincode) {
    return res.redirect(`/checkout${buyNow ? `?buy_now=${buyNow}&quantity=${buyNowQuantity}` : ''}`);
  }

  try {
    let orderItems = [];

    if (buyNow) {
      const art = await dbGet(
        `SELECT id AS artwork_id, artist_id, price, stock
         FROM artworks
         WHERE id = ? AND status IN ('approved', 'active')`,
        [buyNow]
      );
      if (!art) return res.status(404).send('Artwork not found.');
      if (art.stock < buyNowQuantity) return res.status(400).send('Not enough stock available.');
      orderItems = [{ ...art, quantity: buyNowQuantity }];
    } else {
      const cart = await getOrCreateCart(userId);
      const cartItems = await dbAll(
        `SELECT
           ci.artwork_id,
           ci.quantity,
           a.artist_id,
           a.price,
           a.stock
         FROM cart_items ci
         JOIN artworks a ON ci.artwork_id = a.id
         WHERE ci.cart_id = ?`,
        [cart.id]
      );
      if (!cartItems.length) return res.redirect('/cart');
      orderItems = cartItems;
    }

    const subtotal = orderItems.reduce((acc, it) => acc + (it.price || 0) * it.quantity, 0);
    const delivery = subtotal >= 2000 ? 0 : 99;
    const totalAmount = subtotal + delivery;

    // Create Order
    const orderRes = await dbRun(
      `INSERT INTO orders (
         user_id, total_amount, payment_method, payment_status, order_status,
         shipping_name, shipping_mobile, shipping_address, shipping_city,
         shipping_state, shipping_pincode
       ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        userId,
        totalAmount,
        paymentMethod,
        'Completed',
        'Order Placed',
        name,
        mobile,
        address,
        city,
        state,
        pincode
      ]
    );

    const orderId = orderRes.lastID;

    // Insert Order Items and decrement stock
    for (const it of orderItems) {
      await dbRun(
        `INSERT INTO order_items (order_id, artwork_id, artist_id, quantity, price)
         VALUES (?, ?, ?, ?, ?)`,
        [orderId, it.artwork_id, it.artist_id, it.quantity, it.price || 0]
      );
      await dbRun(
        'UPDATE artworks SET stock = MAX(0, stock - ?) WHERE id = ?',
        [it.quantity, it.artwork_id]
      );
    }

    // Clear cart if standard checkout
    if (!buyNow) {
      const cart = await getOrCreateCart(userId);
      await dbRun('DELETE FROM cart_items WHERE cart_id = ?', [cart.id]);
    }

    const createdOrder = await dbGet('SELECT * FROM orders WHERE id = ?', [orderId]);
    return safeRender(res, 'order_success', { order: createdOrder, order_id: orderId });
  } catch (err) {
    console.error('[PLACE ORDER ERROR]', err);
    return res.status(500).send('Unable to place order. Please try again.');
  }
});

app.get('/order-success/:order_id', requireLogin, async (req, res) => {
  const orderId = Number(req.params.order_id);
  const order = await dbGet('SELECT * FROM orders WHERE id = ? AND user_id = ?', [
    orderId,
    req.session.user_id
  ]);
  if (!order) return res.status(404).send('Order not found');
  safeRender(res, 'order_success', { order, order_id: orderId });
});

app.get('/orders', requireLogin, async (req, res) => {
  const userId = req.session.user_id;
  try {
    const rawOrders = await dbAll(
      'SELECT * FROM orders WHERE user_id = ? ORDER BY created_at DESC',
      [userId]
    );

    const ordersList = [];
    for (const order of rawOrders) {
      const items = await dbAll(
        `SELECT oi.*, a.title, a.image
         FROM order_items oi
         LEFT JOIN artworks a ON oi.artwork_id = a.id
         WHERE oi.order_id = ?`,
        [order.id]
      );
      ordersList.push({
        id: order.id,
        created_at: order.created_at,
        total_amount: order.total_amount,
        order_status: order.order_status,
        payment_method: order.payment_method,
        item_count: items.reduce((acc, it) => acc + it.quantity, 0),
        items
      });
    }

    const cartCount = await getCartCount(userId);
    safeRender(res, 'orders', { orders: ordersList, cart_count: cartCount });
  } catch (err) {
    console.error('[ORDERS ERROR]', err);
    safeRender(res, 'orders', { orders: [], cart_count: 0 });
  }
});

app.get('/order/:order_id', requireLogin, async (req, res) => {
  const orderId = Number(req.params.order_id);
  const userId = req.session.user_id;

  try {
    const order = await dbGet(
      'SELECT * FROM orders WHERE id = ? AND user_id = ?',
      [orderId, userId]
    );
    if (!order) return res.status(404).send('Order not found');

    const items = await dbAll(
      `SELECT oi.*, a.title, a.image, ar.artist_name
       FROM order_items oi
       LEFT JOIN artworks a ON oi.artwork_id = a.id
       LEFT JOIN artists ar ON oi.artist_id = ar.id
       WHERE oi.order_id = ?`,
      [orderId]
    );

    const cartCount = await getCartCount(userId);
    safeRender(res, 'order_details', { order, items, cart_count: cartCount });
  } catch (err) {
    console.error('[ORDER DETAILS ERROR]', err);
    res.status(500).send('Error loading order details');
  }
});

app.get('/order/:order_id/track', requireLogin, async (req, res) => {
  const orderId = Number(req.params.order_id);
  const userId = req.session.user_id;

  try {
    const order = await dbGet(
      'SELECT * FROM orders WHERE id = ? AND user_id = ?',
      [orderId, userId]
    );
    if (!order) return res.status(404).send('Order not found');

    let currentIndex = SHOP_STATUSES.indexOf(order.order_status);
    if (currentIndex === -1) currentIndex = 0;

    const stepText = {
      'Order Placed': 'Your order has been received.',
      'Confirmed': 'The order has been confirmed.',
      'Preparing': 'The artist is preparing your artwork.',
      'Shipped': 'Your artwork has been handed to delivery.',
      'Out for Delivery': 'Your artwork is on the way.',
      'Delivered': 'Your artwork has been delivered.'
    };

    const icons = [
      'ri-shopping-bag-line',
      'ri-checkbox-circle-line',
      'ri-brush-line',
      'ri-truck-line',
      'ri-road-map-line',
      'ri-home-smile-line'
    ];

    const steps = SHOP_STATUSES.map((status, index) => ({
      label: status,
      text: stepText[status],
      icon: icons[index] || 'ri-check-line',
      completed: index < currentIndex,
      current: index === currentIndex
    }));

    safeRender(res, 'order_details', { order, steps, tracking: true });
  } catch (err) {
    console.error('[TRACKING ERROR]', err);
    res.status(500).send('Error loading tracking page');
  }
});

app.post('/api/order/:order_id/advance', requireLogin, async (req, res) => {
  const orderId = Number(req.params.order_id);
  const userId = req.session.user_id;

  try {
    const order = await dbGet(
      'SELECT * FROM orders WHERE id = ? AND user_id = ?',
      [orderId, userId]
    );
    if (!order) return res.status(404).json({ success: false, message: 'Order not found.' });

    let index = SHOP_STATUSES.indexOf(order.order_status);
    if (index === -1) index = 0;

    let newStatus = order.order_status;
    if (index < SHOP_STATUSES.length - 1) {
      newStatus = SHOP_STATUSES[index + 1];
      await dbRun('UPDATE orders SET order_status = ? WHERE id = ? AND user_id = ?', [
        newStatus,
        orderId,
        userId
      ]);
    }

    return res.json({ success: true, status: newStatus });
  } catch (err) {
    console.error('[ORDER ADVANCE ERROR]', err);
    return res.status(500).json({ success: false, message: 'Failed to update order status.' });
  }
});

app.get('/invoice/:order_id', requireLogin, async (req, res) => {
  const orderId = Number(req.params.order_id);
  const userId = req.session.user_id;

  try {
    const order = await dbGet(
      'SELECT * FROM orders WHERE id = ? AND user_id = ?',
      [orderId, userId]
    );
    if (!order) return res.status(404).send('Invoice not found');

    const items = await dbAll(
      `SELECT oi.*, a.title, ar.artist_name
       FROM order_items oi
       LEFT JOIN artworks a ON oi.artwork_id = a.id
       LEFT JOIN artists ar ON oi.artist_id = ar.id
       WHERE oi.order_id = ?`,
      [orderId]
    );

    const subtotal = items.reduce((acc, it) => acc + (it.price || 0) * it.quantity, 0);
    const delivery = Math.max(0, order.total_amount - subtotal);

    safeRender(res, 'invoice', { order, items, subtotal, delivery });
  } catch (err) {
    console.error('[INVOICE ERROR]', err);
    res.status(500).send('Error loading invoice');
  }
});

// =============================================================================
// ROUTES: REVIEWS
// =============================================================================
app.get('/reviews', requireLogin, async (req, res) => {
  const userId = req.session.user_id;
  try {
    const reviews = await dbAll(
      `SELECT r.*, a.title, a.image, ar.artist_name
       FROM reviews r
       JOIN artworks a ON r.artwork_id = a.id
       JOIN artists ar ON a.artist_id = ar.id
       WHERE r.user_id = ?
       ORDER BY r.created_at DESC`,
      [userId]
    );
    const cartCount = await getCartCount(userId);
    safeRender(res, 'reviews', { reviews, cart_count: cartCount });
  } catch (err) {
    console.error('[REVIEWS ERROR]', err);
    safeRender(res, 'reviews', { reviews: [], cart_count: 0 });
  }
});

app.get('/review/:artwork_id', requireLogin, async (req, res) => {
  const artworkId = Number(req.params.artwork_id);
  const userId = req.session.user_id;

  try {
    const artwork = await dbGet(
      `SELECT a.*, ar.artist_name
       FROM artworks a
       JOIN artists ar ON a.artist_id = ar.id
       WHERE a.id = ?`,
      [artworkId]
    );
    if (!artwork) return res.status(404).send('Artwork not found');

    const existingReview = await dbGet(
      'SELECT * FROM reviews WHERE artwork_id = ? AND user_id = ?',
      [artworkId, userId]
    );

    safeRender(res, 'review_product', { artwork, review: existingReview });
  } catch (err) {
    console.error('[REVIEW PRODUCT ERROR]', err);
    res.status(500).send('Error loading review page');
  }
});

app.post('/review/:artwork_id/submit', requireLogin, async (req, res) => {
  const artworkId = Number(req.params.artwork_id);
  const userId = req.session.user_id;
  const rating = Number(req.body.rating);
  const reviewText = String(req.body.review || '').trim();

  if (![1, 2, 3, 4, 5].includes(rating)) {
    return res.redirect(`/review/${artworkId}`);
  }

  try {
    const existing = await dbGet(
      'SELECT id FROM reviews WHERE user_id = ? AND artwork_id = ?',
      [userId, artworkId]
    );

    if (existing) {
      await dbRun(
        'UPDATE reviews SET rating = ?, review = ?, created_at = CURRENT_TIMESTAMP WHERE id = ?',
        [rating, reviewText, existing.id]
      );
    } else {
      await dbRun(
        'INSERT INTO reviews (user_id, artwork_id, rating, review) VALUES (?, ?, ?, ?)',
        [userId, artworkId, rating, reviewText]
      );
    }

    // Recalculate average rating
    const avgRow = await dbGet(
      'SELECT AVG(rating) as avg_rating FROM reviews WHERE artwork_id = ?',
      [artworkId]
    );
    if (avgRow && avgRow.avg_rating) {
      await dbRun('UPDATE artworks SET rating = ? WHERE id = ?', [
        Number(avgRow.avg_rating.toFixed(1)),
        artworkId
      ]);
    }

    return res.redirect('/reviews');
  } catch (err) {
    console.error('[SUBMIT REVIEW ERROR]', err);
    return res.redirect('/reviews');
  }
});

app.post('/review/delete/:review_id', requireLogin, async (req, res) => {
  const reviewId = Number(req.params.review_id);
  const userId = req.session.user_id;

  try {
    const review = await dbGet(
      'SELECT artwork_id FROM reviews WHERE id = ? AND user_id = ?',
      [reviewId, userId]
    );

    if (review) {
      await dbRun('DELETE FROM reviews WHERE id = ?', [reviewId]);
      const avgRow = await dbGet(
        'SELECT AVG(rating) as avg_rating FROM reviews WHERE artwork_id = ?',
        [review.artwork_id]
      );
      const newRating = avgRow && avgRow.avg_rating ? Number(avgRow.avg_rating.toFixed(1)) : 0;
      await dbRun('UPDATE artworks SET rating = ? WHERE id = ?', [newRating, review.artwork_id]);
    }
    return res.redirect('/reviews');
  } catch (err) {
    console.error('[DELETE REVIEW ERROR]', err);
    return res.redirect('/reviews');
  }
});

// =============================================================================
// ROUTES: ARTISTS & ARTIST DASHBOARD
// =============================================================================
app.get('/artists', async (req, res) => {
  try {
    const artists = await dbAll(
      `SELECT ar.*, u.full_name, u.email
       FROM artists ar
       JOIN users u ON ar.user_id = u.id
       ORDER BY ar.artist_name`
    );
    safeRender(res, 'artists', { artists });
  } catch (err) {
    console.error('[ARTISTS ERROR]', err);
    safeRender(res, 'artists', { artists: [] });
  }
});

app.get('/artist/dashboard', requireArtist, async (req, res) => {
  try {
    const artist = await getOrCreateArtist(req.session.user_id);
    const artworks = await dbAll(
      'SELECT * FROM artworks WHERE artist_id = ? ORDER BY created_at DESC',
      [artist.id]
    );

    const orderItems = await dbAll(
      `SELECT oi.*, o.created_at, o.order_status, o.payment_status, u.full_name AS customer_name, a.title AS artwork_title, a.image AS artwork_image
       FROM order_items oi
       JOIN orders o ON oi.order_id = o.id
       JOIN users u ON o.user_id = u.id
       JOIN artworks a ON oi.artwork_id = a.id
       WHERE a.artist_id = ?
       ORDER BY o.created_at DESC`,
      [artist.id]
    );

    const displayOrders = orderItems.length > 0 ? orderItems : [
      { id: 1023, artwork_title: 'Madhubani Harmony', artwork_image: 'images/events/event1.jpg', customer_name: 'Priya Deshmukh', price: 2500, quantity: 1, order_status: 'Delivered' },
      { id: 1024, artwork_title: 'Terracotta Lamp', artwork_image: 'images/events/event2.jpg', customer_name: 'Rahul Mehta', price: 700, quantity: 1, order_status: 'Shipped' },
      { id: 1025, artwork_title: 'Lotus Serenity', artwork_image: 'images/events/event3.jpg', customer_name: 'Sneha Jain', price: 1800, quantity: 1, order_status: 'Processing' }
    ];

    const displayArtworks = artworks.length > 0 ? artworks : [
      { id: 1, title: 'Madhubani Harmony', category: 'Painting', price: 2500, status: 'approved', image: 'images/events/event1.jpg' },
      { id: 2, title: 'Lotus Serenity', category: 'Painting', price: 1800, status: 'approved', image: 'images/events/event2.jpg' },
      { id: 3, title: 'Terracotta Lamp', category: 'Craft', price: 700, status: 'approved', image: 'images/events/event3.jpg' }
    ];

    const totalSales = displayOrders.reduce((acc, item) => acc + (item.price * (item.quantity || 1)), 0);

    safeRender(res, 'artist_dashboard', {
      artist,
      artworks: displayArtworks,
      recent_orders: displayOrders.slice(0, 5),
      total_artworks: artworks.length || 12,
      total_orders: displayOrders.length || 28,
      total_earnings: totalSales || 24500,
      rating: artist.rating || 4.8
    });
  } catch (err) {
    console.error('[ARTIST DASHBOARD ERROR]', err);
    safeRender(res, 'artist_dashboard', { artist: {}, artworks: [], recent_orders: [], total_artworks: 12, total_orders: 28, total_earnings: 24500, rating: 4.8 });
  }
});

app.get('/artist/upload', requireArtist, async (req, res) => {
  const artist = await getOrCreateArtist(req.session.user_id);
  safeRender(res, 'artist_upload', { artist });
});

app.post('/artist/upload', requireArtist, uploadArtwork.single('image'), async (req, res) => {
  try {
    const artist = await getOrCreateArtist(req.session.user_id);

    const title = String(req.body.title || '').trim();
    const description = String(req.body.description || '').trim();
    const category = String(req.body.category || 'Painting').trim();
    const style = String(req.body.style || req.body.medium || '').trim();
    const price = Number(req.body.price) || 0;
    const stock = Number(req.body.stock) || 1;
    const imagePath = req.file ? `uploads/artworks/${req.file.filename}` : 'images/events/event1.jpg';

    if (!title) {
      return res.status(400).render('artist_upload', { error: 'Artwork title is required.', artist });
    }

    await dbRun(
      `INSERT INTO artworks (artist_id, title, description, category, style, price, stock, image, status)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'approved')`,
      [artist.id, title, description, category, style, price, stock, imagePath]
    );

    return res.redirect('/artist/artworks');
  } catch (err) {
    console.error('[ARTIST UPLOAD ERROR]', err);
    return res.status(500).send('Failed to upload artwork.');
  }
});

app.get('/artist/artworks', requireArtist, async (req, res) => {
  try {
    const artist = await getOrCreateArtist(req.session.user_id);
    let artworks = await dbAll('SELECT * FROM artworks WHERE artist_id = ? ORDER BY created_at DESC', [artist.id]);

    if (artworks.length === 0) {
      artworks = [
        { id: 1, title: 'Madhubani Harmony', category: 'Painting', price: 2500, status: 'approved', image: 'images/events/event1.jpg' },
        { id: 2, title: 'Lotus Serenity', category: 'Painting', price: 1800, status: 'approved', image: 'images/events/event2.jpg' },
        { id: 3, title: 'Terracotta Lamp', category: 'Craft', price: 700, status: 'approved', image: 'images/events/event3.jpg' },
        { id: 4, title: 'Warli Village', category: 'Folk Art', price: 1600, status: 'approved', image: 'images/events/event4.jpg' },
        { id: 5, title: 'Blue Pottery Plate', category: 'Craft', price: 1200, status: 'inactive', image: 'images/events/event5.jpg' },
        { id: 6, title: 'Elephant Elegance', category: 'Painting', price: 2200, status: 'approved', image: 'images/events/event6.jpg' }
      ];
    }
    safeRender(res, 'artist_artworks', { artist, artworks });
  } catch (err) {
    console.error('[ARTIST ARTWORKS ERROR]', err);
    safeRender(res, 'artist_artworks', { artist: {}, artworks: [] });
  }
});

app.get('/artist/orders', requireArtist, async (req, res) => {
  try {
    const artist = await getOrCreateArtist(req.session.user_id);
    let orders = await dbAll(
      `SELECT oi.*, o.id AS order_id, o.created_at, o.order_status, o.payment_status, u.full_name AS customer_name, a.title AS artwork_title, a.image AS artwork_image
       FROM order_items oi
       JOIN orders o ON oi.order_id = o.id
       JOIN users u ON o.user_id = u.id
       JOIN artworks a ON oi.artwork_id = a.id
       WHERE a.artist_id = ?
       ORDER BY o.created_at DESC`,
      [artist.id]
    );

    if (orders.length === 0) {
      orders = [
        { order_id: 1023, artwork_title: 'Madhubani Harmony', artwork_image: 'images/events/event1.jpg', customer_name: 'Priya Deshmukh', price: 2500, order_status: 'Delivered' },
        { order_id: 1024, artwork_title: 'Terracotta Lamp', artwork_image: 'images/events/event2.jpg', customer_name: 'Rahul Mehta', price: 700, order_status: 'Shipped' },
        { order_id: 1025, artwork_title: 'Lotus Serenity', artwork_image: 'images/events/event3.jpg', customer_name: 'Sneha Jain', price: 1800, order_status: 'Processing' },
        { order_id: 1026, artwork_title: 'Hand Painted Bottle', artwork_image: 'images/events/event4.jpg', customer_name: 'Karan Patel', price: 950, order_status: 'Pending' },
        { order_id: 1027, artwork_title: 'Elephant Elegance', artwork_image: 'images/events/event5.jpg', customer_name: 'Aditi Sharma', price: 2200, order_status: 'Cancelled' }
      ];
    }

    safeRender(res, 'artist_orders', { artist, orders });
  } catch (err) {
    console.error('[ARTIST ORDERS ERROR]', err);
    safeRender(res, 'artist_orders', { artist: {}, orders: [] });
  }
});

app.get('/artist/custom-requests', requireArtist, async (req, res) => {
  const artist = await getOrCreateArtist(req.session.user_id);
  const requests = [
    { id: 'CR1001', title: 'Traditional Portrait (Madhubani)', customer_name: 'Neha Verma', date: '12 Sept 2026', status: 'Pending', image: 'images/events/event1.jpg' },
    { id: 'CR1002', title: 'Personalized Name Art', customer_name: 'Aman Gupta', date: '10 Sept 2026', status: 'In Progress', image: 'images/events/event2.jpg' },
    { id: 'CR1003', title: 'Home Décor Painting', customer_name: 'Riya Kapoor', date: '8 Sept 2026', status: 'Completed', image: 'images/events/event3.jpg' }
  ];
  safeRender(res, 'artist_custom_requests', { artist, requests });
});

app.get('/artist/events', requireArtist, async (req, res) => {
  const artist = await getOrCreateArtist(req.session.user_id);
  const events = [
    { id: 1, title: 'Madhubani Painting Workshop', date: '25 Sept 2026', time: '10:00 AM - 1:00 PM', location: 'Nagpur, Maharashtra', status: 'Upcoming', image: 'images/events/event1.jpg' },
    { id: 2, title: 'Terracotta Art Workshop', date: '10 Oct 2026', time: '11:00 AM - 2:00 PM', location: 'Online', status: 'Ongoing', image: 'images/events/event2.jpg' },
    { id: 3, title: 'Art Exhibition - Local Voices', date: '15 Nov 2026', time: '10:00 AM - 5:00 PM', location: 'Nagpur, Maharashtra', status: 'Upcoming', image: 'images/events/event3.jpg' }
  ];
  safeRender(res, 'artist_events', { artist, events });
});

app.get('/artist/earnings', requireArtist, async (req, res) => {
  const artist = await getOrCreateArtist(req.session.user_id);
  const transactions = [
    { id: '#KS1023', amount: '2,500', date: '20 Sept 2026' },
    { id: '#KS1024', amount: '700', date: '18 Sept 2026' },
    { id: '#KS1025', amount: '1,800', date: '15 Sept 2026' },
    { id: '#KS1026', amount: '950', date: '10 Sept 2026' }
  ];
  safeRender(res, 'artist_earnings', {
    artist,
    total_earnings: '24,500',
    completed_orders: '18,000',
    pending_payout: '5,500',
    total_orders: 12,
    transactions
  });
});

app.get('/artist/messages', requireArtist, async (req, res) => {
  const artist = await getOrCreateArtist(req.session.user_id);
  const chats = [
    { id: 1, name: 'Priya Deshmukh', time: '10:24 AM', snippet: 'Hi! Is this artwork available...', active: true },
    { id: 2, name: 'Aman Gupta', time: 'Yesterday', snippet: 'Can you make a custom portrait...', active: false },
    { id: 3, name: 'Sneha Jain', time: '15 Sept', snippet: 'Thank you! I loved the artwork...', active: false }
  ];
  safeRender(res, 'artist_messages', { artist, chats });
});

app.get('/artist/:artist_id', async (req, res) => {
  const artistId = Number(req.params.artist_id);
  if (isNaN(artistId)) {
    return res.status(404).send('Artist not found');
  }
  try {
    const artist = await dbGet(
      `SELECT ar.*, u.full_name
       FROM artists ar
       JOIN users u ON ar.user_id = u.id
       WHERE ar.id = ?`,
      [artistId]
    );
    if (!artist) return res.status(404).send('Artist not found');

    const artworks = await dbAll(
      'SELECT * FROM artworks WHERE artist_id = ? ORDER BY created_at DESC',
      [artistId]
    );

    safeRender(res, 'artist_profile', { artist, artworks, artist_id: artistId });
  } catch (err) {
    console.error('[ARTIST PROFILE ERROR]', err);
    safeRender(res, 'artist_profile', { artist_id: artistId });
  }
});

// =============================================================================
// ROUTES: CULTURE, REGIONAL ART & EVENTS
// =============================================================================
app.get('/culture', (req, res) => safeRender(res, 'culture'));

app.get('/culture/:slug', (req, res) => {
  const art = ART_HISTORY[req.params.slug];
  if (!art) return res.status(404).send('Art history topic not found');
  safeRender(res, 'art_history', { art });
});

app.get('/regional-art/:slug', (req, res) => {
  const art = REGIONAL_ART_DETAILS[req.params.slug];
  if (!art) return res.status(404).send('Regional art details not found');
  safeRender(res, 'regional_detail', { art });
});

app.get('/culture/region/:state', (req, res) => {
  const region = REGIONAL_ART[req.params.state];
  if (!region) return res.status(404).send('Region not found');
  safeRender(res, 'regional_art', { region });
});

app.get('/events', async (req, res) => {
  try {
    const dbEvents = await dbAll('SELECT * FROM events ORDER BY event_date, event_time');
    safeRender(res, 'events', {
      events: dbEvents,
      workshops: dbEvents,
      upcoming: dbEvents,
      localart_events: LOCALART_EVENTS
    });
  } catch (err) {
    console.error('[EVENTS ERROR]', err);
    safeRender(res, 'events', { events: [], workshops: [], upcoming: [] });
  }
});

app.get('/event/:event_id', async (req, res) => {
  const eventId = req.params.event_id;
  const staticEvent = LOCALART_EVENTS[eventId];
  if (staticEvent) {
    return safeRender(res, 'event_details', { event: staticEvent });
  }

  // If numeric ID, check database events
  if (/^\d+$/.test(eventId)) {
    const dbEvent = await dbGet('SELECT * FROM events WHERE id = ?', [Number(eventId)]);
    if (dbEvent) return safeRender(res, 'event_details', { event: dbEvent });
  }

  return res.status(404).send('Event not found');
});

app.get('/custom-art', (req, res) => safeRender(res, 'custom_art', { active_custom: true }));

// =============================================================================
// ROUTES: COMMUNITY
// =============================================================================
app.get('/community', async (req, res) => {
  try {
    const posts = await dbAll(
      `SELECT
         p.*,
         u.username,
         u.full_name,
         u.profile_image,
         u.city,
         u.role
       FROM community_posts p
       JOIN users u ON p.user_id = u.id
       ORDER BY p.created_at DESC`
    );
    safeRender(res, 'community', { posts });
  } catch (err) {
    console.error('[COMMUNITY ERROR]', err);
    safeRender(res, 'community', { posts: [] });
  }
});

app.post('/community/create', requireLogin, uploadCommunity.single('image'), async (req, res) => {
  const title = String(req.body.title || '').trim();
  const content = String(req.body.content || '').trim();
  const imagePath = req.file ? `uploads/community/${req.file.filename}` : null;
  const userId = req.session.user_id;

  try {
    await dbRun(
      `INSERT INTO community_posts (user_id, title, content, image)
       VALUES (?, ?, ?, ?)`,
      [userId, title, content, imagePath]
    );
    return res.redirect('/community');
  } catch (err) {
    console.error('[COMMUNITY CREATE ERROR]', err);
    return res.redirect('/community');
  }
});

app.post('/api/community/posts', requireLogin, uploadCommunity.single('image'), async (req, res) => {
  const title = String(req.body.title || '').trim();
  const content = String(req.body.content || '').trim();
  const imagePath = req.file ? `uploads/community/${req.file.filename}` : null;
  const userId = req.session.user_id;

  try {
    await dbRun(
      `INSERT INTO community_posts (user_id, title, content, image)
       VALUES (?, ?, ?, ?)`,
      [userId, title, content, imagePath]
    );
    return res.redirect('/community');
  } catch (err) {
    console.error('[API COMMUNITY POST ERROR]', err);
    return res.redirect('/community');
  }
});

// =============================================================================
// ROUTES: ASSISTANT, SETTINGS, FEEDBACK
// =============================================================================
app.get('/assistant', (req, res) => safeRender(res, 'assistant'));
app.get('/settings', requireLogin, (req, res) => safeRender(res, 'settings'));
app.get('/feedback', requireLogin, (req, res) => safeRender(res, 'feedback'));

// =============================================================================
// ROUTES: ADMIN
// =============================================================================
app.get('/admin', requireAdmin, (req, res) => safeRender(res, 'admin'));

app.get('/admin/artworks', requireAdmin, async (req, res) => {
  try {
    const artworks = await dbAll(
      `SELECT a.*, ar.artist_name
       FROM artworks a
       JOIN artists ar ON a.artist_id = ar.id
       ORDER BY a.created_at DESC`
    );
    safeRender(res, 'admin_artworks', { artworks });
  } catch (err) {
    console.error('[ADMIN ARTWORKS ERROR]', err);
    safeRender(res, 'admin_artworks', { artworks: [] });
  }
});

app.get('/admin/users', requireAdmin, async (req, res) => {
  try {
    const users = await dbAll(
      `SELECT id, full_name, username, email, mobile, city, role, created_at
       FROM users
       ORDER BY created_at DESC`
    );
    safeRender(res, 'admin_users', { users });
  } catch (err) {
    console.error('[ADMIN USERS ERROR]', err);
    safeRender(res, 'admin_users', { users: [] });
  }
});

app.get('/admin/orders', requireAdmin, async (req, res) => {
  try {
    const orders = await dbAll(
      `SELECT o.*, u.username, u.full_name
       FROM orders o
       JOIN users u ON o.user_id = u.id
       ORDER BY o.created_at DESC`
    );
    safeRender(res, 'admin_orders', { orders });
  } catch (err) {
    console.error('[ADMIN ORDERS ERROR]', err);
    safeRender(res, 'admin_orders', { orders: [] });
  }
});

app.get('/admin/events', requireAdmin, async (req, res) => {
  try {
    const events = await dbAll('SELECT * FROM events ORDER BY event_date, event_time');
    safeRender(res, 'admin_events', { events });
  } catch (err) {
    console.error('[ADMIN EVENTS ERROR]', err);
    safeRender(res, 'admin_events', { events: [] });
  }
});

// =============================================================================
// TEST & HEALTH CHECK ROUTE
// =============================================================================
app.get('/test', (req, res) => {
  res.json({
    status: 'success',
    message: 'LocalArt Node.js/Express server is running!'
  });
});

// =============================================================================
// 404 & ERROR HANDLER
// =============================================================================
app.use((req, res) => {
  res.status(404).send('Page not found');
});

app.use((err, req, res, next) => {
  console.error('[SERVER UNCAUGHT ERROR]', err);
  res.status(500).send('Internal server error');
});

// Start Server
app.listen(PORT, () => {
  console.log(`====================================================`);
  console.log(`  LocalArt Node.js Server is running!`);
  console.log(`  URL: http://localhost:${PORT}`);
  console.log(`  Database: ${DB_PATH}`);
  console.log(`====================================================`);
});
