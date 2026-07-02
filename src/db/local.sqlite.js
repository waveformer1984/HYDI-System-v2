import sqlite3 from "sqlite3";
import path from "path";
import fs from "fs";

const DB_PATH = path.join(process.cwd(), "data", "hydi_local.db");
fs.mkdirSync(path.dirname(DB_PATH), { recursive: true });

const db = new sqlite3.Database(DB_PATH);

db.serialize(() => {
  db.run(`CREATE TABLE IF NOT EXISTS infrastructure_health (
    id TEXT PRIMARY KEY,
    component TEXT,
    status TEXT,
    timestamp TEXT
  )`);

  db.run(`CREATE TABLE IF NOT EXISTS pending_tasks (
    id TEXT PRIMARY KEY,
    payload TEXT,
    status TEXT,
    created_at TEXT
  )`);

  db.run(`CREATE TABLE IF NOT EXISTS user_profiles (
    user_id TEXT PRIMARY KEY,
    data TEXT
  )`);

  db.run(`CREATE TABLE IF NOT EXISTS decisions (
    id TEXT PRIMARY KEY,
    data TEXT
  )`);

  db.run(`CREATE TABLE IF NOT EXISTS revenue_events (
    id TEXT PRIMARY KEY,
    data TEXT
  )`);

  db.run(`CREATE TABLE IF NOT EXISTS system_performance (
    id TEXT PRIMARY KEY,
    data TEXT
  )`);
});

export default db;
