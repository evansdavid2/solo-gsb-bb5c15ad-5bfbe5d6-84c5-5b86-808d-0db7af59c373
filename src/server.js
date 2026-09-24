'use strict';

const path = require('path');
const express = require('express');
const db = require('./db');
const { loadState, replay } = require('./engine');

const app = express();
app.use(express.json());
app.use(express.static(path.join(__dirname, '..', 'public')));

const PORT = parseInt(process.env.PORT || '3000', 10);

// ---------- 小工具 ----------

function badRequest(message, errors) {
  const err = new Error(message);
  err.status = 400;
  err.errors = errors;
  return err;
}

function apiState() {
  return replay(loadState());
}

function getLocation(id) {
  return db.prepare(`SELECT id, name, kind FROM locations WHERE id = ?`).get(id);
}

function getProp(id) {
  return db.prepare(`SELECT id FROM props WHERE id = ?`).get(id);
}

// ---------- 区位 ----------

app.get('/api/locations', (req, res) => {
  res.json(
    db
      .prepare(
        `SELECT id, name, kind FROM locations
         ORDER BY CASE kind WHEN 'backstage' THEN 0 ELSE 1 END, id`
      )
      .all()
  );
});

// 只能新增“普通”区位（单件）；内置“后台”只有一个。
app.post('/api/locations', (req, res, next) => {
  try {
    const name = typeof req.body.name === 'string' ? req.body.name.trim() : '';
    if (!name) throw badRequest('区位名称不能为空');
    const info = db
      .prepare(`INSERT INTO locations (name, kind) VALUES (?, 'single')`)
      .run(name);
    res.status(201).json(getLocation(info.lastInsertRowid));
  } catch (e) {
    if (isUniqueError(e)) return next(badRequest(`区位「${req.body.name}」已存在`));
    next(e);
  }
});

app.put('/api/locations/:id', (req, res, next) => {
  try {
    const id = parseInt(req.params.id, 10);
    const name = typeof req.body.name === 'string' ? req.body.name.trim() : '';
    if (!name) throw badRequest('区位名称不能为空');
    const loc = getLocation(id);
    if (!loc) throw badRequest('区位不存在');
    db.prepare(`UPDATE locations SET name = ? WHERE id = ?`).run(name, id);
    res.json(getLocation(id));
  } catch (e) {
    if (isUniqueError(e)) return next(badRequest(`区位「${req.body.name}」已存在`));
    next(e);
  }
});

app.delete('/api/locations/:id', (req, res, next) => {
  try {
    const id = parseInt(req.params.id, 10);
    const loc = getLocation(id);
    if (!loc) throw badRequest('区位不存在');
    if (loc.kind === 'backstage') throw badRequest('内置区位「后台」不可删除');

    const propCount = db
      .prepare(`SELECT COUNT(*) AS n FROM props WHERE initial_location_id = ?`)
      .get(id).n;
    if (propCount > 0) throw badRequest(`仍有 ${propCount} 件道具的初始区位在此，无法删除`);

    const moveCount = db
      .prepare(
        `SELECT COUNT(*) AS n FROM moves WHERE from_location_id = ? OR to_location_id = ?`
      )
      .get(id, id).n;
    if (moveCount > 0) throw badRequest(`已有 ${moveCount} 条转移引用该区位，无法删除`);

    db.prepare(`DELETE FROM locations WHERE id = ?`).run(id);
    res.status(204).end();
  } catch (e) {
    next(e);
  }
});

// ---------- 道具 ----------

app.get('/api/props', (req, res) => {
  res.json(db.prepare(`SELECT id, name, initial_location_id AS initialLocationId FROM props ORDER BY id`).all());
});

function validatePropBody(body) {
  const name = typeof body.name === 'string' ? body.name.trim() : '';
  const initialLocationId = parseInt(body.initialLocationId, 10);
  if (!name) throw badRequest('道具名称不能为空');
  if (!Number.isInteger(initialLocationId)) throw badRequest('请选择初始区位');
  const loc = getLocation(initialLocationId);
  if (!loc) throw badRequest('初始区位不存在');

  // 初始区位若为单件区位，初始状态下只能放这一件道具（后台不限）。
  if (loc.kind !== 'backstage') {
    const n = db
      .prepare(`SELECT COUNT(*) AS n FROM props WHERE initial_location_id = ?`)
      .get(initialLocationId).n;
    if (n > 0) throw badRequest(`单件区位「${loc.name}」在初始状态下已放置道具，无法再放入「${name}」`);
  }
  return { name, initialLocationId };
}

app.post('/api/props', (req, res, next) => {
  try {
    const { name, initialLocationId } = validatePropBody(req.body);
    const info = db
      .prepare(`INSERT INTO props (name, initial_location_id) VALUES (?, ?)`)
      .run(name, initialLocationId);
    res.status(201).json(db.prepare(`SELECT id, name, initial_location_id AS initialLocationId FROM props WHERE id = ?`).get(info.lastInsertRowid));
  } catch (e) {
    if (isUniqueError(e)) return next(badRequest(`道具「${req.body.name}」已存在`));
    next(e);
  }
});

app.put('/api/props/:id', (req, res, next) => {
  const id = parseInt(req.params.id, 10);
  try {
    if (!getProp(id)) throw badRequest('道具不存在');
    const name = typeof req.body.name === 'string' ? req.body.name.trim() : '';
    const initialLocationId = parseInt(req.body.initialLocationId, 10);
    if (!name) throw badRequest('道具名称不能为空');
    if (!Number.isInteger(initialLocationId)) throw badRequest('请选择初始区位');
    const loc = getLocation(initialLocationId);
    if (!loc) throw badRequest('初始区位不存在');

    if (loc.kind !== 'backstage') {
      const n = db
        .prepare(
          `SELECT COUNT(*) AS n FROM props WHERE initial_location_id = ? AND id <> ?`
        )
        .get(initialLocationId, id).n;
      if (n > 0) throw badRequest(`单件区位「${loc.name}」在初始状态下已放置其他道具`);
    }

    db.prepare(`UPDATE props SET name = ?, initial_location_id = ? WHERE id = ?`).run(
      name,
      initialLocationId,
      id
    );
    res.json(db.prepare(`SELECT id, name, initial_location_id AS initialLocationId FROM props WHERE id = ?`).get(id));
  } catch (e) {
    if (isUniqueError(e)) return next(badRequest(`道具「${req.body.name}」已存在`));
    next(e);
  }
});

app.delete('/api/props/:id', (req, res, next) => {
  try {
    const id = parseInt(req.params.id, 10);
    if (!getProp(id)) throw badRequest('道具不存在');
    const moveCount = db.prepare(`SELECT COUNT(*) AS n FROM moves WHERE prop_id = ?`).get(id).n;
    if (moveCount > 0) throw badRequest(`该道具已出现在 ${moveCount} 条转移中，请先修改相关提示`);
    db.prepare(`DELETE FROM props WHERE id = ?`).run(id);
    res.status(204).end();
  } catch (e) {
    next(e);
  }
});

// ---------- 提示（成组转移） ----------

/**
 * 校验并规范化一个提示的请求体。
 * moves: [{ propId, fromLocationId, toLocationId }]
 */
function parseCueBody(body) {
  const cueNo = parseInt(body.cueNo, 10);
  if (!Number.isInteger(cueNo) || cueNo <= 0) throw badRequest('提示号必须为正整数');
  const note = typeof body.note === 'string' ? body.note.trim() : '';

  if (!Array.isArray(body.moves)) throw badRequest('moves 必须为数组');
  const moves = body.moves.map((m, i) => {
    const propId = parseInt(m && m.propId, 10);
    const fromLocationId = parseInt(m && m.fromLocationId, 10);
    const toLocationId = parseInt(m && m.toLocationId, 10);
    if (!Number.isInteger(propId)) throw badRequest(`第 ${i + 1} 条转移缺少道具`);
    if (!Number.isInteger(fromLocationId)) throw badRequest(`第 ${i + 1} 条转移缺少来源区位`);
    if (!Number.isInteger(toLocationId)) throw badRequest(`第 ${i + 1} 条转移缺少目标区位`);
    if (!getProp(propId)) throw badRequest(`第 ${i + 1} 条转移引用的道具不存在`);
    if (!getLocation(fromLocationId)) throw badRequest(`第 ${i + 1} 条转移的来源区位不存在`);
    if (!getLocation(toLocationId)) throw badRequest(`第 ${i + 1} 条转移的目标区位不存在`);
    return { propId, fromLocationId, toLocationId };
  });

  const seen = new Set();
  for (const m of moves) {
    if (seen.has(m.propId)) {
      const prop = db.prepare(`SELECT name FROM props WHERE id = ?`).get(m.propId);
      throw badRequest(`道具「${prop ? prop.name : m.propId}」在本组中出现多次，每组每件道具最多转移一次`);
    }
    seen.add(m.propId);
  }

  return { cueNo, note, moves };
}

function insertCue(cueNo, note, moves) {
  const tx = db.transaction(() => {
    db.prepare(`INSERT INTO cues (cue_no, note) VALUES (?, ?)`).run(cueNo, note);
    const stmt = db.prepare(
      `INSERT INTO moves (cue_id, prop_id, from_location_id, to_location_id)
       VALUES (?, ?, ?, ?)`
    );
    for (const m of moves) {
      stmt.run(cueNo, m.propId, m.fromLocationId, m.toLocationId);
    }
  });
  tx();
}

function replaceCue(cueNo, note, moves) {
  const tx = db.transaction(() => {
    db.prepare(`DELETE FROM moves WHERE cue_id = ?`).run(cueNo);
    db.prepare(`UPDATE cues SET note = ? WHERE cue_no = ?`).run(note, cueNo);
    const stmt = db.prepare(
      `INSERT INTO moves (cue_id, prop_id, from_location_id, to_location_id)
       VALUES (?, ?, ?, ?)`
    );
    for (const m of moves) {
      stmt.run(cueNo, m.propId, m.fromLocationId, m.toLocationId);
    }
  });
  tx();
}

app.get('/api/state', (req, res) => {
  res.json(apiState());
});

app.post('/api/cues', (req, res, next) => {
  try {
    const { cueNo, note, moves } = parseCueBody(req.body);
    if (db.prepare(`SELECT 1 FROM cues WHERE cue_no = ?`).get(cueNo)) {
      throw badRequest(`提示号 ${cueNo} 已存在`);
    }

    // 先在“不含本提示”的库状态上预重放，确认本组此刻整组通过，才允许落库。
    insertCue(cueNo, note, moves);
    const state = apiState();
    const result = state.replay.find((r) => r.cueNo === cueNo);
    if (!result.ok) {
      db.prepare(`DELETE FROM cues WHERE cue_no = ?`).run(cueNo);
      throw badRequest(`提示 ${cueNo} 整组校验未通过，未提交`, result.errors);
    }
    res.status(201).json({ state, result });
  } catch (e) {
    next(e);
  }
});

app.put('/api/cues/:cueNo', (req, res, next) => {
  try {
    const cueNo = parseInt(req.params.cueNo, 10);
    if (!db.prepare(`SELECT 1 FROM cues WHERE cue_no = ?`).get(cueNo)) {
      throw badRequest(`提示 ${cueNo} 不存在`);
    }
    // 请求体可带新的提示号（允许改号）；缺省时沿用 URL 中的定位号。
    const parsed = parseCueBody({ cueNo, ...(req.body || {}) });

    // 修改可能改的是提示号本身。
    const targetNo = parsed.cueNo;
    if (
      targetNo !== cueNo &&
      db.prepare(`SELECT 1 FROM cues WHERE cue_no = ?`).get(targetNo)
    ) {
      throw badRequest(`提示号 ${targetNo} 已存在`);
    }

    const backup = dumpCue(cueNo);
    const tx = db.transaction(() => {
      if (targetNo === cueNo) {
        replaceCue(cueNo, parsed.note, parsed.moves);
      } else {
        db.prepare(`DELETE FROM moves WHERE cue_id = ?`).run(cueNo);
        db.prepare(`DELETE FROM cues WHERE cue_no = ?`).run(cueNo);
        insertCue(targetNo, parsed.note, parsed.moves);
      }
    });
    tx();

    const state = apiState();
    const result = state.replay.find((r) => r.cueNo === targetNo);
    if (!result.ok) {
      // 回滚为修改前内容，整组不生效。
      restoreCue(cueNo, backup);
      throw badRequest(`提示 ${targetNo} 整组校验未通过，修改未生效`, result.errors);
    }
    res.json({ state, result });
  } catch (e) {
    next(e);
  }
});

app.delete('/api/cues/:cueNo', (req, res) => {
  const cueNo = parseInt(req.params.cueNo, 10);
  db.prepare(`DELETE FROM cues WHERE cue_no = ?`).run(cueNo);
  res.json({ state: apiState() });
});

function dumpCue(cueNo) {
  const cue = db.prepare(`SELECT cue_no AS cueNo, note FROM cues WHERE cue_no = ?`).get(cueNo);
  if (!cue) return null;
  cue.moves = db
    .prepare(
      `SELECT prop_id AS propId, from_location_id AS fromLocationId,
              to_location_id AS toLocationId
       FROM moves WHERE cue_id = ? ORDER BY id`
    )
    .all(cueNo);
  return cue;
}

function restoreCue(cueNo, backup) {
  const tx = db.transaction(() => {
    db.prepare(`DELETE FROM moves WHERE cue_id = ?`).run(cueNo);
    db.prepare(`DELETE FROM cues WHERE cue_no = ?`).run(cueNo);
    if (backup) insertCue(backup.cueNo, backup.note, backup.moves);
  });
  tx();
}

function isUniqueError(e) {
  return e && /UNIQUE constraint failed/i.test(e.message || '');
}

// JSON 解析错误
app.use((err, req, res, next) => {
  if (err.type === 'entity.parse.failed') {
    return res.status(400).json({ error: '请求体不是合法的 JSON' });
  }
  if (err.status) {
    return res.status(err.status).json({ error: err.message, details: err.errors });
  }
  console.error(err);
  res.status(500).json({ error: '服务器内部错误' });
});

app.listen(PORT, () => {
  console.log(`舞台换景排练台已启动： http://localhost:${PORT}`);
});
