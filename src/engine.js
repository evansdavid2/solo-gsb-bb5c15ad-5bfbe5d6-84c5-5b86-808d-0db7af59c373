'use strict';

const db = require('./db');

/**
 * 读取全部基础数据与提示。返回的提示按提示号升序，
 * 每组转移按录入顺序排列；区位中内置“后台”排在最前。
 */
function loadState() {
  const locations = db
    .prepare(
      `SELECT id, name, kind FROM locations
       ORDER BY CASE kind WHEN 'backstage' THEN 0 ELSE 1 END, id`
    )
    .all()
    .map((l) => ({ id: l.id, name: l.name, isBackstage: l.kind === 'backstage' }));

  const props = db
    .prepare(
      `SELECT p.id, p.name, p.initial_location_id AS initialLocationId
       FROM props p ORDER BY p.id`
    )
    .all()
    .map((p) => ({
      id: p.id,
      name: p.name,
      initialLocationId: p.initialLocationId,
    }));

  const cueRows = db.prepare(`SELECT cue_no AS cueNo, note FROM cues ORDER BY cue_no`).all();
  const moveStmt = db.prepare(
    `SELECT id, prop_id AS propId, from_location_id AS fromLocationId,
            to_location_id AS toLocationId
     FROM moves WHERE cue_id = ? ORDER BY id`
  );

  const cues = cueRows.map((c) => ({
    cueNo: c.cueNo,
    note: c.note || '',
    moves: moveStmt.all(c.cueNo),
  }));

  return { locations, props, cues };
}

/**
 * 按提示号升序重放全部提示。
 *
 * 规则：
 *  - “后台”可容纳任意数量道具，其他区位各容纳一件；
 *  - 每组中每件道具最多出现一次；
 *  - 每条转移要求该道具变动前确实位于来源区位；
 *  - 同组完成后，任一件数限制区位上不得出现多件道具（允许互换）；
 *  - 任一校验不过，整组不生效（状态保持为该组之前），后续提示继续重放。
 */
function replay(state = loadState()) {
  const locById = new Map(state.locations.map((l) => [l.id, l]));
  const propById = new Map(state.props.map((p) => [p.id, p]));

  const current = new Map(state.props.map((p) => [p.id, p.initialLocationId]));

  const initialBoard = buildBoard(state.locations, state.props, (propId) => current.get(propId));

  const results = [];

  for (const cue of state.cues) {
    const errors = [];
    const seenProps = new Set();
    const validMoves = [];

    // 第一遍：结构与来源校验（全部针对变动前状态）。
    for (const move of cue.moves) {
      const prop = propById.get(move.propId);
      const from = locById.get(move.fromLocationId);
      const to = locById.get(move.toLocationId);
      const label = prop ? prop.name : `道具#${move.propId}`;

      if (!prop) {
        errors.push(`「${label}」不存在`);
        continue;
      }
      if (!from) {
        errors.push(`「${label}」的来源区位不存在`);
        continue;
      }
      if (!to) {
        errors.push(`「${label}」的目标区位不存在`);
        continue;
      }
      if (seenProps.has(move.propId)) {
        errors.push(`「${label}」在本组中转移了多次，每组每件道具最多转移一次`);
        continue;
      }
      seenProps.add(move.propId);

      if (current.get(move.propId) !== move.fromLocationId) {
        const actual = locById.get(current.get(move.propId));
        errors.push(
          `「${label}」来源不符：变动前位于「${actual ? actual.name : '未知'}」，要求来源为「${from.name}」`
        );
        continue;
      }

      validMoves.push(move);
    }

    // 第二遍：把本组通过来源校验的转移暂定提交，按区位计数；
    // 件数限制区位上最终不得出现多件道具（因此 A↔B 互换天然合法）。
    if (errors.length === 0) {
      const tentative = new Map(current);
      for (const move of validMoves) {
        tentative.set(move.propId, move.toLocationId);
      }
      for (const loc of state.locations) {
        if (loc.isBackstage) continue;
        const occupants = [...tentative.entries()]
          .filter(([, locId]) => locId === loc.id)
          .map(([propId]) => nameOf(propById, propId));
        if (occupants.length > 1) {
          errors.push(
            `本组完成后单件区位「${loc.name}」被多件道具同时占用：${occupants.join('、')}`
          );
        }
      }
    }

    if (errors.length > 0) {
      results.push({
        cueNo: cue.cueNo,
        note: cue.note,
        ok: false,
        applied: false,
        errors,
        moves: describeMoves(cue.moves, locById, propById),
      });
      continue; // 整组不生效，状态保持变动前
    }

    for (const move of validMoves) {
      current.set(move.propId, move.toLocationId);
    }

    results.push({
      cueNo: cue.cueNo,
      note: cue.note,
      ok: true,
      applied: true,
      errors: [],
      moves: describeMoves(cue.moves, locById, propById),
    });
  }

  const finalBoard = buildBoard(state.locations, state.props, (propId) => current.get(propId));

  return {
    locations: state.locations,
    props: state.props,
    cues: state.cues,
    replay: results,
    initialBoard,
    finalBoard,
  };
}

function nameOf(propById, propId) {
  const p = propById.get(propId);
  return p ? p.name : `道具#${propId}`;
}

function describeMoves(moves, locById, propById) {
  return moves.map((m) => ({
    propId: m.propId,
    propName: nameOf(propById, m.propId),
    fromLocationId: m.fromLocationId,
    fromName: locById.get(m.fromLocationId) ? locById.get(m.fromLocationId).name : '未知',
    toLocationId: m.toLocationId,
    toName: locById.get(m.toLocationId) ? locById.get(m.toLocationId).name : '未知',
  }));
}

function buildBoard(locations, props, locOf) {
  const byLocation = new Map(locations.map((l) => [l.id, []]));
  for (const prop of props) {
    const locId = locOf(prop.id);
    if (byLocation.has(locId)) byLocation.get(locId).push(prop);
  }
  return locations.map((l) => ({
    locationId: l.id,
    locationName: l.name,
    isBackstage: l.isBackstage,
    props: byLocation.get(l.id) || [],
  }));
}

module.exports = { loadState, replay };
