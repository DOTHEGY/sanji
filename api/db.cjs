const { DatabaseSync } = require("node:sqlite");
const fs = require("node:fs"),
  path = require("node:path"),
  crypto = require("node:crypto");
function openDatabase(file) {
  fs.mkdirSync(path.dirname(file), { recursive: true, mode: 0o700 });
  const db = new DatabaseSync(file);
  db.exec(`PRAGMA journal_mode=WAL; PRAGMA foreign_keys=ON; PRAGMA busy_timeout=5000;
CREATE TABLE IF NOT EXISTS users(id TEXT PRIMARY KEY,email TEXT UNIQUE NOT NULL,password TEXT NOT NULL,created TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS sessions(token TEXT PRIMARY KEY,user_id TEXT NOT NULL REFERENCES users(id),csrf TEXT NOT NULL,expires INTEGER NOT NULL);
CREATE TABLE IF NOT EXISTS records(id TEXT PRIMARY KEY,user_id TEXT NOT NULL REFERENCES users(id),kind TEXT NOT NULL,data TEXT NOT NULL,version INTEGER NOT NULL DEFAULT 1,updated TEXT NOT NULL);
CREATE INDEX IF NOT EXISTS records_owner ON records(user_id,kind);
CREATE TABLE IF NOT EXISTS connections(user_id TEXT NOT NULL REFERENCES users(id),provider TEXT NOT NULL,encrypted TEXT NOT NULL,PRIMARY KEY(user_id,provider));
CREATE TABLE IF NOT EXISTS oauth_states(state TEXT PRIMARY KEY,user_id TEXT NOT NULL REFERENCES users(id),provider TEXT NOT NULL,session TEXT NOT NULL,verifier TEXT NOT NULL,expires INTEGER NOT NULL);
CREATE TABLE IF NOT EXISTS drafts(id TEXT PRIMARY KEY,user_id TEXT NOT NULL REFERENCES users(id),data TEXT NOT NULL,hash TEXT NOT NULL,expires INTEGER NOT NULL,used INTEGER NOT NULL DEFAULT 0);
CREATE TABLE IF NOT EXISTS outbox(id TEXT PRIMARY KEY,user_id TEXT NOT NULL REFERENCES users(id),target TEXT NOT NULL,channel TEXT NOT NULL,fingerprint TEXT NOT NULL UNIQUE,status TEXT NOT NULL,data TEXT NOT NULL,created TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS suppression(user_id TEXT NOT NULL REFERENCES users(id),identity TEXT NOT NULL,reason TEXT NOT NULL,PRIMARY KEY(user_id,identity));
CREATE TABLE IF NOT EXISTS audit(id INTEGER PRIMARY KEY AUTOINCREMENT,user_id TEXT NOT NULL,action TEXT NOT NULL,data TEXT NOT NULL,created TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS webhook_events(id TEXT PRIMARY KEY,created TEXT NOT NULL);`);
  return db;
}
const id = () => crypto.randomUUID(),
  now = () => new Date().toISOString(),
  hash = (s) => crypto.createHash("sha256").update(s).digest("hex");
function passwordHash(password) {
  const salt = crypto.randomBytes(16).toString("hex");
  return salt + ":" + crypto.scryptSync(password, salt, 64).toString("hex");
}
function passwordValid(password, stored) {
  const [salt, key] = stored.split(":");
  return crypto.timingSafeEqual(
    Buffer.from(key, "hex"),
    crypto.scryptSync(password, salt, 64),
  );
}
function vault(master) {
  const key = crypto.createHash("sha256").update(master).digest();
  return {
    encrypt(value) {
      const iv = crypto.randomBytes(12),
        c = crypto.createCipheriv("aes-256-gcm", key, iv),
        body = Buffer.concat([
          c.update(JSON.stringify(value), "utf8"),
          c.final(),
        ]);
      return Buffer.concat([iv, c.getAuthTag(), body]).toString("base64");
    },
    decrypt(value) {
      const b = Buffer.from(value, "base64"),
        c = crypto.createDecipheriv("aes-256-gcm", key, b.subarray(0, 12));
      c.setAuthTag(b.subarray(12, 28));
      return JSON.parse(
        Buffer.concat([c.update(b.subarray(28)), c.final()]).toString(),
      );
    },
  };
}
module.exports = {
  openDatabase,
  id,
  now,
  hash,
  passwordHash,
  passwordValid,
  vault,
};
