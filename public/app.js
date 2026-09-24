'use strict';

let state = null;
let editingCueNo = null; // 非 null 表示提示表单处于“修改”模式

const $ = (sel) => document.querySelector(sel);

// ---------- 通用 ----------

function esc(s) {
  return String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  })[c]);
}

function showBanner(kind, message, details) {
  const el = $('#banner');
  let html = esc(message);
  if (Array.isArray(details) && details.length) {
    html += '\n' + details.map((d) => '• ' + esc(d)).join('\n');
  }
  el.textContent = html;
  el.className = 'banner ' + kind;
  clearTimeout(showBanner._t);
  if (kind === 'ok') {
    showBanner._t = setTimeout(() => el.classList.add('hidden'), 4000);
  }
}

async function api(method, url, body) {
  const res = await fetch(url, {
    method,
    headers: body !== undefined ? { 'Content-Type': 'application/json' } : undefined,
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  if (res.status === 204) return null;
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    const err = new Error(data.error || `请求失败（${res.status}）`);
    err.details = data.details;
    throw err;
  }
  return data;
}

async function refresh() {
  state = await api('GET', '/api/state');
  render();
}

// ---------- 渲染 ----------

function render() {
  renderLocations();
  renderProps();
  renderBoard();
  renderReplay();
}

function renderLocations() {
  const ul = $('#location-list');
  ul.innerHTML = state.locations
    .map((l) => {
      const initial = state.props.filter((p) => p.initialLocationId === l.id).length;
      return `
      <li>
        <span>${esc(l.name)}
          <span class="meta">（${l.isBackstage ? '不限数量' : '单件'}${initial ? `，初始 ${initial} 件` : ''}）</span>
        </span>
        <span class="actions">
          <button class="small" data-act="rename-loc" data-id="${l.id}">改名</button>
          ${l.isBackstage ? '' : `<button class="small danger" data-act="del-loc" data-id="${l.id}">删除</button>`}
        </span>
      </li>`;
    })
    .join('');

  $('#prop-form').querySelector('select').innerHTML = state.locations
    .map((l) => `<option value="${l.id}">${esc(l.name)}${l.isBackstage ? '（不限数量）' : '（单件）'}</option>`)
    .join('');
}

function renderProps() {
  const locName = new Map(state.locations.map((l) => [l.id, l.name]));
  $('#prop-list').innerHTML = state.props.length
    ? state.props
        .map(
          (p) => `
      <li>
        <span>${esc(p.name)} <span class="meta">初始：${esc(locName.get(p.initialLocationId) || '?')}</span></span>
        <span class="actions">
          <button class="small" data-act="edit-prop" data-id="${p.id}">改</button>
          <button class="small danger" data-act="del-prop" data-id="${p.id}">删</button>
        </span>
      </li>`
        )
        .join('')
    : '<li class="meta">还没有道具，请先在下方添加。</li>';
}

function renderBoard() {
  $('#final-board').innerHTML = state.finalBoard
    .map(
      (z) => `
    <div class="zone">
      <div class="zone-name">${esc(z.locationName)}
        <span class="cap">（${z.isBackstage ? '不限数量' : '单件'}）</span>
      </div>
      <div>${
        z.props.length
          ? z.props.map((p) => `<span class="chip">${esc(p.name)}</span>`).join('')
          : '<span class="chip empty">—</span>'
      }</div>
    </div>`
    )
    .join('');
}

function renderReplay() {
  const box = $('#replay-list');
  if (!state.replay.length) {
    box.innerHTML = '<div class="empty-tip">暂无提示。录入一组转移后，这里会显示每组校验结果。</div>';
    return;
  }
  box.innerHTML = state.replay
    .map((r) => {
      const moves = r.moves
        .map(
          (m) => `
        <div class="move-line">${esc(m.propName)}
          <span class="meta">${esc(m.fromName)}</span>
          <span class="arrow">→</span>
          <strong>${esc(m.toName)}</strong>
        </div>`
        )
        .join('');
      const errors = r.ok
        ? ''
        : `<ul class="error-lines">${r.errors.map((e) => `<li>${esc(e)}</li>`).join('')}</ul>`;
      return `
      <div class="cue-block">
        <div class="cue-head">
          <span class="cue-no">#${r.cueNo}</span>
          <span class="cue-note">${esc(r.note || '')}</span>
          <span class="badge ${r.applied ? 'applied' : 'failed'}">${r.applied ? '整组生效' : '冲突 · 整组未生效'}</span>
          <button class="small" data-act="edit-cue" data-no="${r.cueNo}">修改</button>
          <button class="small danger" data-act="del-cue" data-no="${r.cueNo}">删除</button>
        </div>
        <div class="cue-detail">${moves}${errors}</div>
      </div>`;
    })
    .join('');
}

// ---------- 提示表单：成组转移 ----------

function locOptions(selectedId) {
  return state.locations
    .map((l) => `<option value="${l.id}"${l.id === selectedId ? ' selected' : ''}>${esc(l.name)}</option>`)
    .join('');
}

function propOptions(selectedId) {
  if (!state.props.length) return '<option value="">请先在左侧添加道具…</option>';
  return state.props
    .map((p) => `<option value="${p.id}"${p.id === selectedId ? ' selected' : ''}>${esc(p.name)}</option>`)
    .join('');
}

function propFinalLocationId(propId) {
  for (const z of state.finalBoard) {
    if (z.props.some((p) => p.id === propId)) return z.locationId;
  }
  return null;
}

function locNameById(id) {
  const l = state.locations.find((x) => x.id === id);
  return l ? l.name : '';
}

function addMoveRow(move) {
  const tr = document.createElement('tr');
  tr.className = 'move-row';
  const propId = move ? move.propId : state.props[0] && state.props[0].id;
  const fromId = move ? move.fromLocationId : propFinalLocationId(propId);
  const toId = move ? move.toLocationId : '';
  tr.innerHTML = `
    <td>
      <select class="m-prop">${propOptions(propId)}</select>
      <div class="current-from">${fromId ? `当前位于：${esc(locNameById(fromId))}` : ''}</div>
    </td>
    <td><select class="m-from">${locOptions(fromId)}</select></td>
    <td class="arrow">→</td>
    <td><select class="m-to"><option value="">选择目标…</option>${locOptions(toId)}</select></td>
    <td class="remove-cell"><button type="button" class="small danger" data-act="remove-move">✕</button></td>`;
  $('#moves-body').appendChild(tr);
}

function readMoves() {
  return [...document.querySelectorAll('.move-row')].map((tr) => ({
    propId: parseInt(tr.querySelector('.m-prop').value, 10),
    fromLocationId: parseInt(tr.querySelector('.m-from').value, 10),
    toLocationId: parseInt(tr.querySelector('.m-to').value, 10),
  }));
}

function resetCueForm() {
  editingCueNo = null;
  $('#cue-form').reset();
  $('#moves-body').innerHTML = '';
  addMoveRow();
  addMoveRow();
  $('#cue-form-title').textContent = '录入提示';
  $('#cue-submit-btn').textContent = '提交本组';
  $('#cue-cancel-btn').classList.add('hidden');
}

function startEditCue(cueNo) {
  const cue = state.cues.find((c) => c.cueNo === cueNo);
  if (!cue) return;
  editingCueNo = cueNo;
  $('#cue-form').querySelector('[name="cueNo"]').value = cue.cueNo;
  $('#cue-form').querySelector('[name="note"]').value = cue.note || '';
  $('#moves-body').innerHTML = '';
  cue.moves.forEach((m) => addMoveRow(m));
  if (!cue.moves.length) addMoveRow();
  $('#cue-form-title').textContent = `修改提示 #${cueNo}`;
  $('#cue-submit-btn').textContent = '保存修改';
  $('#cue-cancel-btn').classList.remove('hidden');
  window.scrollTo({ top: 0, behavior: 'smooth' });
}

// ---------- 事件绑定 ----------

$('#add-move-btn').addEventListener('click', () => addMoveRow());

$('#moves-body').addEventListener('click', (e) => {
  if (e.target.dataset.act === 'remove-move') {
    e.target.closest('tr').remove();
  }
});

// 选择道具后，用“最终区位”辅助填写来源并给出当前位置提示
$('#moves-body').addEventListener('change', (e) => {
  if (!e.target.classList.contains('m-prop')) return;
  const tr = e.target.closest('tr');
  const propId = parseInt(e.target.value, 10);
  const cur = propFinalLocationId(propId);
  tr.querySelector('.current-from').textContent = cur ? `当前位于：${locNameById(cur)}` : '';
  if (cur != null) tr.querySelector('.m-from').value = String(cur);
});

$('#cue-cancel-btn').addEventListener('click', resetCueForm);

$('#cue-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  const form = e.currentTarget;
  const cueNo = parseInt(form.querySelector('[name="cueNo"]').value, 10);
  const note = form.querySelector('[name="note"]').value.trim();
  const moves = readMoves();

  if (!moves.length) return showBanner('err', '至少需要一条转移');
  if (moves.some((m) => !m.propId)) return showBanner('err', '请先添加道具并为每条转移选择道具');
  if (moves.some((m) => !m.toLocationId)) return showBanner('err', '每条转移都必须选择目标区位');
  const dupes = moves.map((m) => m.propId).filter((id, i, arr) => arr.indexOf(id) !== i);
  if (dupes.length) return showBanner('err', '同一组中每件道具最多转移一次');

  try {
    const payload = { cueNo, note, moves };
    let data;
    if (editingCueNo == null) {
      data = await api('POST', '/api/cues', payload);
      showBanner('ok', `提示 #${cueNo} 整组校验通过并已提交`);
    } else {
      data = await api('PUT', `/api/cues/${editingCueNo}`, payload);
      showBanner('ok', `提示 #${cueNo} 已修改，并已按提示号重放全部提示`);
    }
    state = data.state;
    resetCueForm();
    render();
  } catch (err) {
    showBanner('err', err.message, err.details);
  }
});

$('#location-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  const input = e.currentTarget.querySelector('input');
  try {
    await api('POST', '/api/locations', { name: input.value.trim() });
    input.value = '';
    await refresh();
  } catch (err) {
    showBanner('err', err.message, err.details);
  }
});

$('#prop-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  const name = e.currentTarget.querySelector('[name="name"]').value.trim();
  const initialLocationId = parseInt(e.currentTarget.querySelector('[name="initialLocationId"]').value, 10);
  try {
    await api('POST', '/api/props', { name, initialLocationId });
    e.currentTarget.reset();
    await refresh();
    resetCueForm();
  } catch (err) {
    showBanner('err', err.message, err.details);
  }
});

// 区位 / 道具 / 提示的按钮统一委托
document.addEventListener('click', async (e) => {
  const act = e.target.dataset.act;
  if (!act) return;

  try {
    if (act === 'del-loc') {
      const id = e.target.dataset.id;
      if (!confirm('确定删除该区位？')) return;
      await api('DELETE', `/api/locations/${id}`);
      await refresh();
    } else if (act === 'rename-loc') {
      const id = e.target.dataset.id;
      const loc = state.locations.find((l) => String(l.id) === String(id));
      const name = prompt('新的区位名称：', loc.name);
      if (name == null) return;
      await api('PUT', `/api/locations/${id}`, { name: name.trim() });
      await refresh();
    } else if (act === 'del-prop') {
      const id = e.target.dataset.id;
      if (!confirm('确定删除该道具？')) return;
      await api('DELETE', `/api/props/${id}`);
      await refresh();
      resetCueForm();
    } else if (act === 'edit-prop') {
      const id = parseInt(e.target.dataset.id, 10);
      const prop = state.props.find((p) => p.id === id);
      const name = prompt('道具新名称：', prop.name);
      if (name == null) return;
      const locList = state.locations
        .map((l) => `${l.id}. ${l.name}${l.isBackstage ? '（不限数量）' : '（单件）'}`)
        .join('\n');
      const locInput = prompt(`设置初始区位，输入区位编号：\n${locList}`, prop.initialLocationId);
      if (locInput == null) return;
      await api('PUT', `/api/props/${id}`, {
        name: name.trim(),
        initialLocationId: parseInt(locInput, 10),
      });
      await refresh();
      resetCueForm();
    } else if (act === 'edit-cue') {
      startEditCue(parseInt(e.target.dataset.no, 10));
    } else if (act === 'del-cue') {
      const no = e.target.dataset.no;
      if (!confirm(`确定删除提示 #${no}？删除后将重放全部提示。`)) return;
      const data = await api('DELETE', `/api/cues/${no}`);
      state = data.state;
      if (editingCueNo === parseInt(no, 10)) resetCueForm();
      render();
      showBanner('ok', `提示 #${no} 已删除，并已按提示号重放全部提示`);
    }
  } catch (err) {
    showBanner('err', err.message, err.details);
  }
});

// ---------- 启动 ----------

(async function init() {
  try {
    await refresh();
    addMoveRow();
    addMoveRow();
  } catch (err) {
    document.body.insertAdjacentHTML(
      'afterbegin',
      `<div class="banner err">${esc(err.message)}</div>`
    );
  }
})();
