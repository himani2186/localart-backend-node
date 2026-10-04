const sqlite3 = require('sqlite3').verbose();
const path = require('path');
require('dotenv').config();

const dbPath = process.env.DATABASE_PATH || path.join(__dirname, '../local art/localart.db');
const db = new sqlite3.Database(dbPath);

function dbGet(query, params = []) {
  return new Promise((resolve, reject) => {
    db.get(query, params, (err, row) => (err ? reject(err) : resolve(row)));
  });
}

function dbRun(query, params = []) {
  return new Promise((resolve, reject) => {
    db.run(query, params, function (err) {
      if (err) reject(err);
      else resolve(this);
    });
  });
}

async function runTest() {
  console.log('--- TESTING PROFILE UPDATE INTEGRATION ---');
  try {
    // 1. Fetch an existing user or create a temporary test user
    let user = await dbGet("SELECT * FROM users WHERE email = 'test_profile_user@localart.com'");
    if (!user) {
      const res = await dbRun(
        `INSERT INTO users (full_name, username, email, mobile, city, role, password, bio)
         VALUES ('Test Original', 'testprofileuser', 'test_profile_user@localart.com', '9876543210', 'Mumbai', 'customer', 'scrypt:test', 'Initial bio')`
      );
      user = await dbGet('SELECT * FROM users WHERE id = ?', [res.lastID]);
    }
    console.log('[1] Target User Loaded:', { id: user.id, full_name: user.full_name, city: user.city, mobile: user.mobile, bio: user.bio });

    // 2. Perform Profile Update
    const newName = 'Himani Updated Profile';
    const newMobile = '9123456789';
    const newCity = 'Pune';
    const newBio = 'Passionate Indian art collector and local craft lover.';

    await dbRun(
      `UPDATE users SET full_name = ?, mobile = ?, city = ?, bio = ? WHERE id = ?`,
      [newName, newMobile, newCity, newBio, user.id]
    );

    // 3. Verify in SQLite Database
    const updatedUser = await dbGet('SELECT * FROM users WHERE id = ?', [user.id]);
    console.log('[2] Updated User from DB:', {
      id: updatedUser.id,
      full_name: updatedUser.full_name,
      mobile: updatedUser.mobile,
      city: updatedUser.city,
      bio: updatedUser.bio
    });

    if (
      updatedUser.full_name === newName &&
      updatedUser.mobile === newMobile &&
      updatedUser.city === newCity &&
      updatedUser.bio === newBio
    ) {
      console.log('✅ TEST PASSED: Profile updated and verified in SQLite Database!');
    } else {
      console.error('❌ TEST FAILED: Updated fields do not match expected values.');
      process.exit(1);
    }
  } catch (err) {
    console.error('❌ TEST ERRORED:', err);
    process.exit(1);
  } finally {
    db.close();
  }
}

runTest();
