#!/usr/bin/env node
const mysql = require('mysql2/promise');
const fs = require('fs');
const path = require('path');

async function runMigration() {
  const config = {
    host: process.env.DB_HOST,
    user: process.env.DB_USER,
    password: process.env.DB_PASSWORD,
    database: process.env.DB_NAME,
    multipleStatements: true
  };

  console.log('Connecting to database...');
  const conn = await mysql.createConnection(config);
  
  const sqlPath = path.join(__dirname, '2026-10-14-fix-confirmed-status.sql');
  const sql = fs.readFileSync(sqlPath, 'utf8');
  
  console.log('Running migration...');
  const [result] = await conn.query(sql);
  
  console.log('Migration completed successfully!');
  console.log('Result:', result);
  
  await conn.end();
}

runMigration().catch(err => {
  console.error('Migration failed:', err.message);
  process.exit(1);
});
