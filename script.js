// ═══════════════════════════════════════════════════════════
//  Constants & Global State
// ═══════════════════════════════════════════════════════════
const EPSILON = 'ε';
const SPEEDS  = [1400, 800, 400, 150]; // Slower → Faster

let pdaMode      = 'dpda';
let acceptMode   = 'final';   // 'final' | 'empty'
let transitions  = [];
let startState   = 'q0';
let acceptStates = new Set();
let allStates    = [];        // explicitly declared states
let pdaBuilt     = false;

let simRunning   = false;
let simDone      = false;
let simTimer     = null;
let simStepCount = 0;

// DPDA history
let dpdaHistory  = [];
let prevStack    = [];   // track previous stack to detect push/pop

// NPDA configs: {id, state, pos, stack[], hist[], dead}
let npdaConfigs  = [];
let npdaInited   = false;
let npdaIdCtr    = 0;

// ═══════════════════════════════════════════════════════════
//  Utilities
// ═══════════════════════════════════════════════════════════
const norm     = s => (s === 'eps' || s === 'epsilon') ? EPSILON : s;
const getSpeed = () => SPEEDS[parseInt(document.getElementById('speed-slider').value) - 1] ?? 400;

function clearLog() { document.getElementById('log-area').innerHTML = ''; }

function log(msg, cls = '') {
  const area = document.getElementById('log-area');
  const d = document.createElement('div');
  d.className = 'log-entry' + (cls ? ' ' + cls : '');
  d.textContent = msg;
  area.appendChild(d);
  area.scrollTop = area.scrollHeight;
}

function setStatus(cls, label) {
  const p = document.getElementById('status-pill');
  p.className = 'status-pill ' + cls;
  p.textContent = label;
}

// ═══════════════════════════════════════════════════════════
//  Mode Toggles
// ═══════════════════════════════════════════════════════════
function setMode(m) {
  pdaMode = m;
  document.getElementById('btn-dpda').classList.toggle('active', m === 'dpda');
  document.getElementById('btn-npda').classList.toggle('active', m === 'npda');
  document.getElementById('npda-paths').style.display     = m === 'npda' ? 'block' : 'none';
  document.getElementById('stack-single').style.display   = m === 'dpda' ? 'flex'  : 'none';
  document.getElementById('stack-branches').style.display = m === 'npda' ? 'block' : 'none';
  if (pdaBuilt) { validatePDA(); resetSim(); }
}

function setAcceptMode(m) {
  acceptMode = m;
  document.getElementById('acc-final').classList.toggle('active', m === 'final');
  document.getElementById('acc-empty').classList.toggle('active', m === 'empty');
  const hint = document.getElementById('acc-hint');
  if (m === 'final') {
    hint.innerHTML = 'Accepts when input is fully consumed <em>and</em> the machine is in an accept state.';
  } else {
    hint.innerHTML = 'Accepts when input is fully consumed <em>and</em> the stack is completely empty. Accept states are ignored.';
  }
  const ta = document.getElementById('transitions-input');
  if (ta.value.trim()) {
    ta.value = adaptTransitionsToAcceptMode(ta.value, m);
  }
  if (pdaBuilt) { renderGraph(startState, new Set()); resetSim(); }
}

// ═══════════════════════════════════════════════════════════
//  Parse
// ═══════════════════════════════════════════════════════════
function parseTransitions(text) {
  const errEl = document.getElementById('trans-error');
  errEl.textContent = '';
  const lines = text.trim().split('\n')
    .filter(l => l.trim() && !l.trim().startsWith('//') && !l.trim().startsWith('#'));
  const result = [];
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].trim();
    const m = line.match(/^(\S+)\s*,\s*(\S+)\s*,\s*(\S+)\s*(?:→|->)\s*(\S+)\s*,\s*(\S+)$/);
    if (!m) { errEl.textContent = `Parse error line ${i + 1}: "${line}"`; return null; }
    result.push({ from: m[1], symbol: norm(m[2]), stackTop: norm(m[3]), to: m[4], push: norm(m[5]) });
  }
  return result;
}

// ═══════════════════════════════════════════════════════════
//  Non-determinism Check
// ═══════════════════════════════════════════════════════════
function detectNonDeterminism(trans) {
  const conflicts = [];
  const seen = new Map();
  trans.forEach((t) => {
    const key = `${t.from}|${t.symbol}|${t.stackTop}`;
    if (!seen.has(key)) seen.set(key, 0);
    seen.set(key, seen.get(key) + 1);
  });
  seen.forEach((count, key) => {
    if (count > 1) {
      const [st, sym, top] = key.split('|');
      conflicts.push(`δ(${st}, ${sym}, ${top}) has ${count} rules → ambiguous`);
    }
  });
  // ε-conflict
  trans.forEach(t1 => {
    if (t1.symbol === EPSILON) return;
    trans.forEach(t2 => {
      if (t2.symbol !== EPSILON) return;
      if (t2.from === t1.from && t2.stackTop === t1.stackTop) {
        const desc = `δ(${t1.from}, ${t1.symbol}, ${t1.stackTop}) conflicts with ε-move`;
        if (!conflicts.includes(desc)) conflicts.push(desc);
      }
    });
  });
  return conflicts;
}

// ═══════════════════════════════════════════════════════════
//  Build PDA
// ═══════════════════════════════════════════════════════════
function buildPDA() {
  const parsed = parseTransitions(document.getElementById('transitions-input').value);
  if (!parsed) return;

  transitions  = parsed;
  startState   = document.getElementById('start-state').value.trim();
  acceptStates = new Set(
    document.getElementById('accept-states').value.split(',').map(s => s.trim()).filter(Boolean)
  );

  // All states: union of explicitly declared + inferred from transitions
  const explicitRaw = document.getElementById('all-states').value;
  const explicit = explicitRaw.split(',').map(s => s.trim()).filter(Boolean);
  const inferred = new Set([startState]);
  acceptStates.forEach(s => inferred.add(s));
  transitions.forEach(t => { inferred.add(t.from); inferred.add(t.to); });
  // Merge, preserving explicit order first
  const merged = [...new Set([...explicit, ...inferred])];
  allStates = merged;

  pdaBuilt   = true;
  npdaInited = false;
  prevStack  = ['Z'];

  clearLog();
  log(`PDA built — ${transitions.length} transition(s), ${allStates.length} state(s), accept-by: ${acceptMode}`, 'info');
  validatePDA();
  renderGraph(startState, new Set());
  resetSim();

  document.getElementById('btn-play').disabled  = false;
  document.getElementById('btn-step').disabled  = false;
  document.getElementById('btn-reset').disabled = false;
}

function validatePDA() {
  const el = document.getElementById('nd-warning');
  if (!el) return;
  if (pdaMode === 'npda') { el.textContent = ''; el.style.display = 'none'; return; }
  const cs = detectNonDeterminism(transitions);
  if (cs.length) {
    el.style.display = 'block';
    el.innerHTML = `⚠ Non-determinism detected — switch to NPDA mode:<br>` +
      cs.slice(0, 4).map(c => `&nbsp;&nbsp;• ${c}`).join('<br>') +
      (cs.length > 4 ? `<br>&nbsp;&nbsp;… and ${cs.length - 4} more` : '');
  } else {
    el.textContent = ''; el.style.display = 'none';
  }
}

// ═══════════════════════════════════════════════════════════
//  Acceptance Check
// ═══════════════════════════════════════════════════════════
function isAccepted(state, pos, stack, inputLen) {
  if (pos < inputLen) return false;
  if (acceptMode === 'final') return acceptStates.has(state);
  if (acceptMode === 'empty') return stack.length === 0;
  return false;
}

// ═══════════════════════════════════════════════════════════
//  Graph Rendering
// ═══════════════════════════════════════════════════════════
function renderGraph(primaryState = null, activeEdgeKeys = new Set()) {
  const svg    = document.getElementById('pda-svg');
  const W = 520, H = 240, R = 26;
  const cx = W / 2, cy = H / 2;

  // Use allStates if available, else infer
  const states = allStates.length ? allStates : getInferredStates();

  // Active states (for NPDA multi-highlight)
  const activeStates = new Set();
  if (primaryState) activeStates.add(primaryState);
  if (pdaMode === 'npda') {
    npdaConfigs.filter(c => !c.dead).forEach(c => activeStates.add(c.state));
  }

  // Layout: circular
  const pos = {};
  if (states.length === 1) {
    pos[states[0]] = { x: cx, y: cy };
  } else {
    states.forEach((s, i) => {
      const a = (2 * Math.PI * i / states.length) - Math.PI / 2;
      const r = Math.min(W, H) / 2 - R - 26;
      pos[s] = { x: cx + r * Math.cos(a), y: cy + r * Math.sin(a) };
    });
  }

  let html = `<defs>
    <marker id="arr" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse">
      <path d="M1 1L9 5L1 9" fill="none" stroke="rgba(155,160,190,0.6)" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/>
    </marker>
    <marker id="arr-on" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse">
      <path d="M1 1L9 5L1 9" fill="none" stroke="#5b8dee" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/>
    </marker>
  </defs>`;

  // Group edges by from→to
  const edgeMap = {};
  transitions.forEach((t) => {
    const key = `${t.from}|${t.to}`;
    if (!edgeMap[key]) edgeMap[key] = [];
    edgeMap[key].push(t);
  });

  Object.entries(edgeMap).forEach(([key, list]) => {
    const [from, to] = key.split('|');
    const p1 = pos[from], p2 = pos[to];
    if (!p1 || !p2) return;

    const edgeActive = list.some(t =>
      activeEdgeKeys.has(`${t.from}|${t.symbol}|${t.stackTop}|${t.to}|${t.push}`)
    );
    const color  = edgeActive ? '#5b8dee' : 'rgba(150,155,185,0.45)';
    const marker = edgeActive ? 'url(#arr-on)' : 'url(#arr)';
    const sw     = edgeActive ? 2.0 : 0.9;
    const label  = list.map(t => `${t.symbol},${t.stackTop}/${t.push}`).join(' | ');

    if (from === to) {
      html += `<path d="M${p1.x-R*0.55},${p1.y-R*0.72} Q${p1.x},${p1.y-R*3.1} ${p1.x+R*0.55},${p1.y-R*0.72}"
        fill="none" stroke="${color}" stroke-width="${sw}" marker-end="${marker}"/>`;
      html += `<text x="${p1.x}" y="${p1.y-R*3.2}" text-anchor="middle" font-size="10"
        fill="${color}" font-family="'JetBrains Mono','Courier New',monospace" dominant-baseline="central">${label}</text>`;
    } else {
      const dx = p2.x-p1.x, dy = p2.y-p1.y;
      const d  = Math.sqrt(dx*dx+dy*dy)||1;
      const nx = dx/d, ny = dy/d;
      const sx = p1.x+nx*R, sy = p1.y+ny*R;
      const ex = p2.x-nx*R, ey = p2.y-ny*R;
      const pxv = -ny*20, pyv = nx*20;
      const mx = (sx+ex)/2+pxv, my = (sy+ey)/2+pyv;
      html += `<path d="M${sx},${sy} Q${mx},${my} ${ex},${ey}"
        fill="none" stroke="${color}" stroke-width="${sw}" marker-end="${marker}"/>`;
      html += `<text x="${(sx+ex)/2+pxv*0.6}" y="${(sy+ey)/2+pyv*0.6}" text-anchor="middle" font-size="10"
        fill="${color}" font-family="'JetBrains Mono','Courier New',monospace" dominant-baseline="central">${label}</text>`;
    }
  });

  // Entry arrow
  const sp = pos[startState];
  if (sp) {
    html += `<line x1="${sp.x-R-28}" y1="${sp.y}" x2="${sp.x-R-2}" y2="${sp.y}"
      stroke="rgba(150,155,185,0.5)" stroke-width="0.9" marker-end="url(#arr)"/>`;
  }

  // State nodes
  states.forEach(s => {
    const p = pos[s];
    if (!p) return;
    const active  = activeStates.has(s);
    // In "final" mode: double circle for accept states
    // In "empty" mode: no accept states shown (all look the same)
    const isAccept = acceptMode === 'final' && acceptStates.has(s);
    const fill   = active ? 'rgba(91,141,238,0.18)' : 'var(--bg3,#1e2333)';
    const stroke = active ? '#5b8dee' : 'rgba(150,155,185,0.35)';
    const sw     = active ? 2.0 : 1;
    const tc     = active ? '#5b8dee' : 'var(--text,#e2e4ec)';

    if (isAccept) {
      html += `<circle cx="${p.x}" cy="${p.y}" r="${R+6}" fill="none" stroke="${stroke}" stroke-width="${sw*0.55}" opacity="0.6"/>`;
    }
    html += `<circle cx="${p.x}" cy="${p.y}" r="${R}" fill="${fill}" stroke="${stroke}" stroke-width="${sw}"/>`;
    html += `<text x="${p.x}" y="${p.y}" text-anchor="middle" font-size="12"
      font-family="'JetBrains Mono','Courier New',monospace"
      fill="${tc}" dominant-baseline="central" font-weight="${active?'700':'400'}">${s}</text>`;
  });

  svg.innerHTML = html;
}

function getInferredStates() {
  const s = new Set([startState]);
  acceptStates.forEach(a => s.add(a));
  transitions.forEach(t => { s.add(t.from); s.add(t.to); });
  return [...s];
}

// ═══════════════════════════════════════════════════════════
//  Input Tape
// ═══════════════════════════════════════════════════════════
function initTape() {
  const str  = document.getElementById('input-string').value;
  const tape = document.getElementById('input-tape');
  tape.innerHTML = '';
  if (!str.length) {
    const c = document.createElement('div');
    c.className = 'tape-cell'; c.style.opacity = '.3'; c.textContent = 'ε';
    tape.appendChild(c); return;
  }
  for (let i = 0; i < str.length; i++) {
    const c = document.createElement('div');
    c.className = 'tape-cell'; c.id = `tape-${i}`; c.textContent = str[i];
    tape.appendChild(c);
  }
}

function updateTape(pos, finalState = '') {
  const str = document.getElementById('input-string').value;
  for (let i = 0; i < str.length; i++) {
    const c = document.getElementById(`tape-${i}`);
    if (!c) continue;
    if      (finalState === 'accepted') c.className = 'tape-cell accepted';
    else if (finalState === 'rejected') c.className = 'tape-cell rejected';
    else if (i < pos)                   c.className = 'tape-cell consumed';
    else if (i === pos)                 c.className = 'tape-cell current';
    else                                c.className = 'tape-cell';
  }
}

// ═══════════════════════════════════════════════════════════
//  Stack Rendering with Push/Pop Animations
// ═══════════════════════════════════════════════════════════

// Compare old stack vs new stack to detect push / pop events.
// Returns: { type: 'push'|'pop'|'replace'|'same', sym: string }
function diffStack(oldStack, newStack) {
  if (newStack.length > oldStack.length) {
    return { type: 'push', sym: newStack[newStack.length - 1] };
  } else if (newStack.length < oldStack.length) {
    return { type: 'pop', sym: oldStack[oldStack.length - 1] };
  }
  return { type: 'same' };
}

// Render the DPDA stack with animated push/pop.
// `opHint` is optional: { type: 'push'|'pop'|'same', sym: string }
function renderStack(stack, opHint = null) {
  const el = document.getElementById('stack-display');

  // Determine operation if not provided
  if (!opHint) {
    opHint = diffStack(prevStack, stack);
  }

  // If pop: animate outgoing top cell first, then re-render
  if (opHint.type === 'pop') {
    const topEl = el.querySelector('.stack-cell.top');
    if (topEl) {
      topEl.classList.remove('top');
      topEl.classList.add('anim-pop');
      // Show floating pop arrow
      showStackArrow('pop', opHint.sym);
      setTimeout(() => { doRenderStack(stack, null); }, 300);
      prevStack = [...stack];
      return;
    }
  }

  doRenderStack(stack, opHint.type === 'push' ? opHint.sym : null);
  if (opHint.type === 'push') showStackArrow('push', opHint.sym);
  prevStack = [...stack];
}

function doRenderStack(stack, newTopSym = null) {
  const el = document.getElementById('stack-display');
  el.innerHTML = '';

  if (!stack.length) {
    if (acceptMode === 'empty') {
      const e = document.createElement('div');
      e.className = 'stack-empty-accept';
      e.textContent = '∅ empty — accept!';
      el.appendChild(e);
    } else {
      const e = document.createElement('div');
      e.style.cssText = 'font-size:13px;color:var(--text-muted);margin-top:10px;font-family:var(--mono)';
      e.textContent = '(empty)';
      el.appendChild(e);
    }
    return;
  }

  stack.forEach((sym, i) => {
    const c = document.createElement('div');
    const isTop = i === stack.length - 1;
    const isBot = i === 0;
    c.className = 'stack-cell'
      + (isTop ? ' top'    : '')
      + (isBot ? ' bottom' : '');
    // Animate the new top symbol on push
    if (isTop && sym === newTopSym) c.classList.add('anim-push');
    c.textContent = sym;
    el.appendChild(c);
  });
}

function showStackArrow(type, sym) {
  const el = document.getElementById('stack-display');
  const arrow = document.createElement('div');
  arrow.className = type === 'push' ? 'stack-push-arrow' : 'stack-pop-arrow';
  arrow.textContent = type === 'push' ? `↓ push ${sym}` : `↑ pop ${sym}`;
  el.appendChild(arrow);
  setTimeout(() => { if (arrow.parentNode) arrow.parentNode.removeChild(arrow); }, 650);
}

// ═══════════════════════════════════════════════════════════
//  NPDA Branch Panel
// ═══════════════════════════════════════════════════════════
function renderBranches() {
  const el = document.getElementById('branch-list');
  el.innerHTML = '';
  if (!npdaConfigs.length) {
    const e = document.createElement('div');
    e.style.cssText = 'font-size:13px;color:var(--text-muted);font-family:var(--mono)';
    e.textContent = 'No active branches.';
    el.appendChild(e); return;
  }
  const sorted = [...npdaConfigs].sort((a, b) => (a.dead ? 1 : 0) - (b.dead ? 1 : 0));
  sorted.forEach(cfg => {
    const card = document.createElement('div');
    card.className = 'branch-card' + (cfg.dead ? ' dead-branch' : '');

    const header = document.createElement('div');
    header.className = 'branch-card-header';

    const idEl  = document.createElement('span'); idEl.className  = 'branch-id';    idEl.textContent  = `#${cfg.id}`;
    const stEl  = document.createElement('span'); stEl.className  = 'branch-state'; stEl.textContent  = cfg.state;
    const posEl = document.createElement('span'); posEl.className = 'branch-pos';   posEl.textContent = `pos:${cfg.pos}` + (cfg.dead ? ' ✗' : '');
    header.append(idEl, stEl, posEl);

    const stackRow  = document.createElement('div'); stackRow.className = 'branch-stack-row';
    const lbl = document.createElement('span'); lbl.className = 'branch-stack-label'; lbl.textContent = 'stack:';
    stackRow.appendChild(lbl);

    if (!cfg.stack.length) {
      const e = document.createElement('span');
      e.className = 'branch-stack-sym';
      e.textContent = acceptMode === 'empty' ? '∅ accept' : '∅';
      stackRow.appendChild(e);
    } else {
      cfg.stack.forEach((sym, i) => {
        const s = document.createElement('span');
        s.className = 'branch-stack-sym' + (i === cfg.stack.length - 1 ? ' top-sym' : '');
        s.textContent = sym; stackRow.appendChild(s);
      });
    }

    card.append(header, stackRow);
    el.appendChild(card);
  });
}

// ═══════════════════════════════════════════════════════════
//  DPDA Step
// ═══════════════════════════════════════════════════════════
function dpdaStep() {
  const str = document.getElementById('input-string').value;

  if (!dpdaHistory.length) {
    dpdaHistory.push({ state: startState, pos: 0, stack: ['Z'] });
    prevStack = ['Z'];
    renderGraph(startState, new Set());
    renderStack(['Z']);
    updateTape(0, '');
    document.getElementById('current-state-display').textContent = startState;
    document.getElementById('step-display').textContent = '0';
    log(`Init — state=${startState}, stack=[Z], accept-by:${acceptMode}`, 'info');
    return;
  }

  const { state, pos, stack } = dpdaHistory[dpdaHistory.length - 1];

  if (isAccepted(state, pos, stack, str.length)) { finishSim('accepted', state, pos); return; }
  if (pos > str.length) { finishSim('rejected', state, pos); return; }

  const sym      = pos < str.length ? str[pos] : EPSILON;
  const stackTop = stack.length ? stack[stack.length - 1] : EPSILON;

  let trans = null;
  const try_ = (sc, tc) => {
    if (trans) return;
    for (const t of transitions)
      if (t.from === state && sc(t.symbol) && tc(t.stackTop)) { trans = t; return; }
  };
  try_(s => s === sym,     t => t === stackTop);
  try_(s => s === EPSILON, t => t === stackTop);
  try_(s => s === sym,     t => t === EPSILON);
  try_(s => s === EPSILON, t => t === EPSILON);

  if (!trans) {
    if (isAccepted(state, pos, stack, str.length)) finishSim('accepted', state, pos);
    else { log(`No transition from (${state}, ${sym}, ${stackTop})`, 'warn'); finishSim('rejected', state, pos); }
    return;
  }

  const newStack = [...stack];
  if (trans.stackTop !== EPSILON) newStack.pop();
  if (trans.push !== EPSILON) trans.push.split('').reverse().forEach(s => newStack.push(s));
  const newPos = trans.symbol !== EPSILON ? pos + 1 : pos;

  const op = diffStack(stack, newStack);
  dpdaHistory.push({ state: trans.to, pos: newPos, stack: newStack });
  simStepCount++;

  const edgeKey = new Set([`${trans.from}|${trans.symbol}|${trans.stackTop}|${trans.to}|${trans.push}`]);
  renderGraph(trans.to, edgeKey);
  renderStack(newStack, op);
  updateTape(newPos, '');
  document.getElementById('current-state-display').textContent = trans.to;
  document.getElementById('step-display').textContent = simStepCount;

  const stackStr = newStack.length ? `[${newStack.join(', ')}]` : '∅';
  log(`δ(${state}, ${trans.symbol}, ${trans.stackTop}) → (${trans.to}, ${trans.push})   stack:${stackStr}`);

  if (isAccepted(trans.to, newPos, newStack, str.length)) finishSim('accepted', trans.to, newPos);
}

// ═══════════════════════════════════════════════════════════
//  NPDA
// ═══════════════════════════════════════════════════════════
function npdaInit() {
  npdaIdCtr  = 0;
  prevStack  = ['Z'];
  npdaConfigs = [{ id: ++npdaIdCtr, state: startState, pos: 0, stack: ['Z'], hist: [startState], dead: false }];
  npdaInited  = true;
  renderGraph(startState, new Set());
  renderBranches();
  updateTape(0, '');
  document.getElementById('current-state-display').textContent = startState;
  document.getElementById('step-display').textContent = '0';
  log(`NPDA init — 1 branch, state=${startState}, accept-by:${acceptMode}`, 'info');
  updateNpdaInfo();
}

function npdaAdvance() {
  const str = document.getElementById('input-string').value;
  simStepCount++;
  document.getElementById('step-display').textContent = simStepCount;

  const live = npdaConfigs.filter(c => !c.dead);
  if (!live.length) { finishSim('rejected', '', 0); return; }

  const next = [];
  let acceptedCfg = null;

  for (const cfg of live) {
    const { state, pos, stack, hist } = cfg;
    const sym      = pos < str.length ? str[pos] : null;
    const stackTop = stack.length ? stack[stack.length - 1] : EPSILON;

    if (isAccepted(state, pos, stack, str.length)) { acceptedCfg = cfg; break; }

    // All matching transitions (true non-determinism)
    const matching = transitions.filter(t => {
      const symOk = (sym !== null && t.symbol === sym) || t.symbol === EPSILON;
      const topOk = t.stackTop === stackTop || t.stackTop === EPSILON;
      return t.from === state && symOk && topOk;
    });

    if (!matching.length) {
      next.push({ ...cfg, dead: true });
    } else {
      matching.forEach(t => {
        const ns = [...stack];
        if (t.stackTop !== EPSILON) ns.pop();
        if (t.push !== EPSILON) t.push.split('').reverse().forEach(s => ns.push(s));
        const np = t.symbol !== EPSILON ? pos + 1 : pos;
        next.push({ id: ++npdaIdCtr, state: t.to, pos: np, stack: ns, hist: [...hist, `→${t.to}`], dead: false });
      });
    }
  }

  if (acceptedCfg) {
    log(`Accepted — branch #${acceptedCfg.id}: ${acceptedCfg.hist.join(' ')}`, 'success');
    npdaConfigs = [acceptedCfg];
    renderBranches();
    updateTape(str.length, 'accepted');
    renderGraph(acceptedCfg.state, new Set());
    document.getElementById('current-state-display').textContent = acceptedCfg.state;
    setStatus('accepted', 'Accepted ✓');
    simDone = true; disableSimControls(); return;
  }

  npdaConfigs = next;
  const liveCfgs = npdaConfigs.filter(c => !c.dead);

  if (!liveCfgs.length) { renderBranches(); finishSim('rejected', '', 0); return; }

  const rep = liveCfgs[0];
  updateTape(rep.pos, '');
  renderGraph(rep.state, new Set());
  document.getElementById('current-state-display').textContent =
    [...new Set(liveCfgs.map(c => c.state))].join(', ');
  renderBranches();
  log(`Step ${simStepCount} — ${liveCfgs.length} live branch(es): [${[...new Set(liveCfgs.map(c=>c.state))].join(', ')}]`);
  updateNpdaInfo();
}

function updateNpdaInfo() {
  const el = document.getElementById('npda-paths');
  if (!el) return;
  const live = npdaConfigs.filter(c => !c.dead).length;
  el.textContent = `Live branches: ${live} / Total: ${npdaConfigs.length}`;
}

// ═══════════════════════════════════════════════════════════
//  Shared Controls
// ═══════════════════════════════════════════════════════════
function finishSim(result, state, pos) {
  simDone = true; simRunning = false;
  if (simTimer) { clearTimeout(simTimer); simTimer = null; }

  if (result === 'accepted') {
    setStatus('accepted', 'Accepted ✓');
    updateTape(pos, 'accepted');
    renderGraph(state, new Set());
    log(`✓ Accepted — state:${state || '—'}, accept-by:${acceptMode}`, 'success');
  } else {
    setStatus('rejected', 'Rejected ✗');
    updateTape(document.getElementById('input-string').value.length, 'rejected');
    log(`✗ Rejected — no valid path`, 'danger');
  }
  document.getElementById('btn-play').textContent = '▶ Play';
  disableSimControls();
}

function disableSimControls() {
  document.getElementById('btn-play').disabled = true;
  document.getElementById('btn-step').disabled = true;
}

function stepSim() {
  if (simDone || !pdaBuilt) return;
  setStatus('running', 'Running');
  if (pdaMode === 'dpda') { dpdaStep(); }
  else { if (!npdaInited) { npdaInit(); return; } npdaAdvance(); }
}

function togglePlay() {
  if (!pdaBuilt || simDone) return;
  if (!simRunning) {
    simRunning = true;
    document.getElementById('btn-play').textContent = '⏸ Pause';
    setStatus('running', 'Running');
    if (pdaMode === 'npda' && !npdaInited) npdaInit();
    if (pdaMode === 'dpda' && !dpdaHistory.length) dpdaStep();
    scheduleNext();
  } else {
    simRunning = false;
    document.getElementById('btn-play').textContent = '▶ Play';
    setStatus('paused', 'Paused');
    if (simTimer) { clearTimeout(simTimer); simTimer = null; }
  }
}

function scheduleNext() {
  if (!simRunning || simDone) return;
  simTimer = setTimeout(() => {
    if (pdaMode === 'dpda') dpdaStep(); else npdaAdvance();
    if (!simDone) scheduleNext();
    else { simRunning = false; document.getElementById('btn-play').textContent = '▶ Play'; }
  }, getSpeed());
}

function resetSim() {
  if (simTimer) { clearTimeout(simTimer); simTimer = null; }
  simRunning = false; simDone = false; simStepCount = 0;
  dpdaHistory = []; prevStack = ['Z'];
  npdaConfigs = []; npdaInited = false; npdaIdCtr = 0;

  initTape();
  doRenderStack(['Z'], null);
  prevStack = ['Z'];
  renderBranches();
  setStatus('idle', 'Idle');
  document.getElementById('current-state-display').textContent = '—';
  document.getElementById('step-display').textContent = '0';
  document.getElementById('btn-play').textContent = '▶ Play';
  document.getElementById('btn-play').disabled  = !pdaBuilt;
  document.getElementById('btn-step').disabled  = !pdaBuilt;
  document.getElementById('npda-paths').textContent = '';
  if (pdaBuilt) renderGraph(startState, new Set());
  clearLog();
  log('Ready — press Play or Step.', 'info');
}

function adaptTransitionsToAcceptMode(transText, mode) {
  return transText.replace(
    /^(\s*\S+\s*,\s*(?:ε|eps)\s*,\s*Z\s*→\s*\S+\s*,\s*)(Z)(\s*)$/gm,
    (match, prefix, push, trail) => {
      if (mode === 'empty') return prefix + 'ε' + trail;
      return prefix + 'Z' + trail;   // restore for final mode
    }
  );
}

// ═══════════════════════════════════════════════════════════
//  Examples
// ═══════════════════════════════════════════════════════════

const EXAMPLES = {
  anbn: {
    allStates:    'q0, q1, qf',
    transitions:
`q0, a, Z → q0, AZ
q0, a, A → q0, AA
q0, b, A → q1, ε
q1, b, A → q1, ε
q1, ε, Z → qf, Z`,
    startState:   'q0',
    acceptStates: 'qf',
    inputString:  'aabb',
    acceptMode:   'final',
    mode:         'dpda'
  },
  evenpal: {
    allStates:    'q0, q1, qf',
    transitions:
`q0, a, Z → q0, aZ
q0, b, Z → q0, bZ
q0, a, a → q0, aa
q0, a, b → q0, ab
q0, b, a → q0, ba
q0, b, b → q0, bb
q0, ε, Z → q1, Z
q0, ε, a → q1, a
q0, ε, b → q1, b
q1, a, a → q1, ε
q1, b, b → q1, ε
q1, ε, Z → qf, Z`,
    startState:   'q0',
    acceptStates: 'qf',
    inputString:  'abbaabba',
    acceptMode:   'final',
    mode:         'npda'
  }
};

function loadExample(key) {
  const ex = EXAMPLES[key];
  if (!ex) return;
  document.getElementById('all-states').value         = ex.allStates;
  document.getElementById('transitions-input').value  = ex.transitions;
  document.getElementById('start-state').value        = ex.startState;
  document.getElementById('accept-states').value      = ex.acceptStates;
  document.getElementById('input-string').value       = ex.inputString;
  setAcceptMode(ex.acceptMode);
  setMode(ex.mode);
  const adapted = adaptTransitionsToAcceptMode(ex.transitions, acceptMode);
  document.getElementById('transitions-input').value = adapted;
  buildPDA();
}

// ═══════════════════════════════════════════════════════════
//  Input change listener
// ═══════════════════════════════════════════════════════════
document.getElementById('input-string').addEventListener('input', () => {
  if (simRunning) return;
  dpdaHistory = []; npdaConfigs = []; npdaInited = false;
  simStepCount = 0; simDone = false; prevStack = ['Z'];
  initTape();
  if (pdaBuilt) {
    renderGraph(startState, new Set());
    doRenderStack(['Z'], null);
    renderBranches();
    setStatus('idle', 'Idle');
    document.getElementById('current-state-display').textContent = '—';
    document.getElementById('step-display').textContent = '0';
    document.getElementById('btn-play').disabled = false;
    document.getElementById('btn-step').disabled = false;
  }
});

// ═══════════════════════════════════════════════════════════
//  Boot
// ═══════════════════════════════════════════════════════════
document.getElementById('stack-single').style.display   = 'flex';
document.getElementById('stack-branches').style.display = 'none';
loadExample('anbn');
