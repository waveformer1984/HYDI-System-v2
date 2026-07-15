import db from "./local.sqlite.js";

function run(sql, params = []) {
  return new Promise((res, rej) => {
    db.run(sql, params, function (err) {
      if (err) rej(err);
      else res({ id: this.lastID });
    });
  });
}

function all(sql, params = []) {
  return new Promise((res, rej) => {
    db.all(sql, params, (err, rows) => {
      if (err) rej(err);
      else res(rows);
    });
  });
}

export const DB = {

  async insertHealth(r) {
    return run(
      `INSERT OR REPLACE INTO infrastructure_health VALUES (?, ?, ?, ?)`,
      [r.id, r.component, r.status, r.timestamp]
    );
  },

  async queueTask(t) {
    return run(
      `INSERT INTO pending_tasks VALUES (?, ?, ?, ?)`,
      [t.id, JSON.stringify(t.payload), "queued", new Date().toISOString()]
    );
  },

  async saveProfile(p) {
    return run(
      `INSERT OR REPLACE INTO user_profiles VALUES (?, ?)`,
      [p.user_id, JSON.stringify(p)]
    );
  },

  async getProfile(id) {
    const rows = await all(
      `SELECT * FROM user_profiles WHERE user_id = ?`,
      [id]
    );
    return rows[0] || null;
  }

};
