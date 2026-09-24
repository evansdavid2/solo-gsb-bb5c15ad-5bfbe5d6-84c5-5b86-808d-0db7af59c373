'use strict';

const path = require('path');
const fs = require('fs');
const Database = require('better-sqlite3');

const DEFAULT_DB_PATH = path.join(__dirname, '..', 'data', 'stage.db');
const dbPath = process.env.DB_PATH || DEFAULT_DB_PATH;

fs.mkdirSync(path.dirname(dbPath), { recursive: true });

const db = new Database(dbPath);
db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');

db.exec(`
CREATE TABLE IF NOT EXISTS locations (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  name       TEXT NOT NULL UNIQUE,
  kind       TEXT NOT NULL CHECK (kind IN ('backstage', 'single'))
);

CREATE TABLE IF NOT EXISTS props (
  id                 INTEGER PRIMARY KEY AUTOINCREMENT,
  name               TEXT NOT NULL UNIQUE,
  initial_location_id INTEGER NOT NULL REFERENCES locations(id)
);

CREATE TABLE IF NOT EXISTS cues (
  cue_no   INTEGER PRIMARY KEY,
  note     TEXT NOT NULL DEFAULT ''
);

CREATE TABLE IF NOT EXISTS moves (
  id               INTEGER PRIMARY KEY AUTOINCREMENT,
  cue_id           INTEGER NOT NULL REFERENCES cues(cue_no) ON DELETE CASCADE,
  prop_id          INTEGER NOT NULL REFERENCES props(id),
  from_location_id INTEGER NOT NULL REFERENCES locations(id),
  to_location_id   INTEGER NOT NULL REFERENCES locations(id),
  UNIQUE (cue_id, prop_id)
);

CREATE INDEX IF NOT EXISTS idx_moves_cue ON moves(cue_id);
`);

// “后台”是内置区位：可容纳任意数量道具；其余区位各容纳一件。
db.prepare(
  `INSERT OR IGNORE INTO locations (id, name, kind) VALUES (1, '后台', 'backstage')`
).run();

module.exports = db;
