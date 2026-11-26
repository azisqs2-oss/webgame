// ============================================================
//  CSV 데이터 읽기 (data/choices.csv, story.csv, npcs.csv, items.csv)
//  - 엑셀에서 저장해도 되고 VS Code 에서 고쳐도 됩니다.
//  - 파일이 바뀌면 다음 요청 때 자동으로 다시 읽습니다. (서버 재시작 불필요)
//  - 엑셀의 "CSV UTF-8" 저장, 일반 "CSV" 저장(한글 CP949) 둘 다 읽습니다.
// ============================================================
const fs = require('fs');
const path = require('path');
const C = require('../data/content');

const CHOICES_FILE = path.join(__dirname, '..', 'data', 'choices.csv');
const STORY_FILE = path.join(__dirname, '..', 'data', 'story.csv');
const NPCS_FILE = path.join(__dirname, '..', 'data', 'npcs.csv');
const ITEMS_FILE = path.join(__dirname, '..', 'data', 'items.csv');

const TYPES = ['성장', '소소', '계절', '특별의뢰', '연결', '행운'];  // 행운 = 계절이 바뀔 때 행운% 확률로 끼어드는 사건 (C.SEASON_EVENTS)  // 소소 = 성장기에 자주 뜨는 가벼운 사건  // 연결 = 다른 장면의 '다음 이벤트'로만 이어지는 장면

// ---------- CSV 파싱 ----------
function decode(buf) {
  if (buf[0] === 0xef && buf[1] === 0xbb && buf[2] === 0xbf) buf = buf.subarray(3);
  try {
    return new TextDecoder('utf-8', { fatal: true }).decode(buf);
  } catch {
    return new TextDecoder('euc-kr').decode(buf); // 엑셀 기본 CSV(CP949)
  }
}

function parseCSV(text) {
  const rows = [];
  let row = [], field = '', inQuotes = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (inQuotes) {
      if (ch === '"') {
        if (text[i + 1] === '"') { field += '"'; i++; } else inQuotes = false;
      } else field += ch;
    } else if (ch === '"') inQuotes = true;
    else if (ch === ',') { row.push(field); field = ''; }
    else if (ch === '\n' || ch === '\r') {
      if (ch === '\r' && text[i + 1] === '\n') i++;
      row.push(field); rows.push(row); row = []; field = '';
    } else field += ch;
  }
  if (field !== '' || row.length) { row.push(field); rows.push(row); }
  return rows;
}

// 헤더 이름으로 접근하는 객체 배열로 (# 으로 시작하는 줄과 빈 줄은 무시)
function readTable(file) {
  const rows = parseCSV(decode(fs.readFileSync(file)));
  const header = (rows.shift() || []).map(h => h.trim());
  return rows
    .map((r, i) => ({ line: i + 2, cells: r }))
    .filter(({ cells }) => cells.some(v => v.trim() !== '') && !String(cells[0]).trim().startsWith('#'))
    .map(({ line, cells }) => {
      const obj = { _line: line };
      header.forEach((h, i) => { obj[h] = (cells[i] || '').trim(); });
      return obj;
    });
}

const num = v => {
  if (v === undefined || v === '') return 0;
  const n = Number(String(v).replace('%', '').replace('+', ''));
  return Number.isFinite(n) ? n : NaN;
};

// 능력치 열 이름(힘, 지능 ...)을 key(str, intel ...)로
function readStats(row, warn, where) {
  const effects = {};
  for (const s of [...C.STATS, ...C.MAGIC_STATS]) {
    const n = num(row[s.name]);
    if (Number.isNaN(n)) warn(`${where}: '${s.name}' 칸이 숫자가 아니에요 (${row[s.name]})`);
    else if (n) effects[s.key] = n;
  }
  return effects;
}

// ---------- 이벤트 파일 (choices.csv, story.csv 공통) ----------
// story.csv 는 구분이 항상 '메인스토리'입니다.
//   나이 칸이 있으면  → 성장기 그 나이에 반드시 시작하는 마을 스토리 장면
//   등급 칸이 있으면  → 성인 이후 그 등급의 메인 스토리 장 (순서대로)
//   둘 다 없으면      → 연결 장면 (다른 장면의 '다음 이벤트'로만 이어짐)
function loadEventFile(file, label, isStory, events, warnings) {
  if (!fs.existsSync(file)) return;
  const rows = readTable(file);
  const EVENT_COLS = isStory
    ? ['직업', '나이', '등급', '순서', '제목', 'NPC', '이벤트 문장', '전투']
    : ['구분', '계절', '최소나이', '최대나이', '최소등급', '직업', '제목', 'NPC', '이벤트 문장', '전투'];
  let prev = null;

  for (const row of rows) {
    const id = row['ID'];
    const where = `${label} ${row._line}번째 줄`;
    const warn = msg => warnings.push(msg);
    if (!id) { warn(`${where}: ID가 비어 있어 건너뜀`); continue; }

    // 같은 ID의 두 번째 줄부터는 이벤트 칸을 비워도 위 줄 값을 이어받음
    if (prev && prev.ID === id) for (const col of EVENT_COLS) if (!row[col]) row[col] = prev[col];
    const continuing = prev && prev.ID === id;
    prev = row;

    let ev = events.get(id);
    if (ev && !continuing && ev.file !== label) { warn(`${where}: ID '${id}'가 ${ev.file}에도 있어요. ID는 겹치면 안 돼요`); continue; }
    if (!ev) {
      const type = isStory ? '메인스토리' : row['구분'];
      const storyAge = isStory && row['나이'] ? num(row['나이']) : null;
      const kind = !isStory ? (type === '연결' ? 'linked' : 'normal') : (storyAge !== null ? 'age' : (row['등급'] ? 'rank' : 'linked'));
      if (!isStory && !TYPES.includes(type)) { warn(`${where}: 구분은 ${TYPES.join('/')} 중 하나여야 해요 (${type})`); continue; }

      // 직업 조건 (비우면 모든 직업)
      const job = row['직업'] || '';
      if (job && !C.JOBS.some(j => j.name === job)) warn(`${where}: 직업 '${job}'는 content.js 의 JOBS 에 없어요`);
      // 성장기 마을 스토리는 직업이 꼭 필요 · 성인 장(등급)·연결 장면은 비우면 모든 직업 공통 (왕도 첫 이야기)
      if (isStory && !job && kind === 'age') { warn(`${where}: 성장기 메인 스토리는 직업 칸이 필요해요`); continue; }

      // 등급: 숫자(0부터) 또는 그 직업의 등급 이름
      let rank = 0;
      const rankCell = isStory ? row['등급'] : row['최소등급'];
      if (rankCell) {
        const jobDef = C.JOBS.find(j => j.name === job);
        const byName = jobDef ? jobDef.ranks.indexOf(rankCell) : -1;
        rank = byName >= 0 ? byName : num(rankCell);
        if (Number.isNaN(rank)) { warn(`${where}: 등급 '${rankCell}'를 알 수 없어요 → 0으로 처리`); rank = 0; }
      }

      const seasonName = isStory ? '공통' : (row['계절'] || '공통');
      const season = seasonName === '공통' ? -1 : C.SEASONS.indexOf(seasonName);
      if (seasonName !== '공통' && season < 0) warn(`${where}: 계절은 ${C.SEASONS.join('/')}/공통 중 하나여야 해요 (${seasonName})`);

      const npc = row['NPC'] || '';
      const combat = row['전투'] || '';
      // 필요 능력치 (메인 스토리 장): "힘 15, 민첩성 10" → 모두 넘어야 그 장을 시작할 수 있음
      const reqs = {};
      if (isStory && row['필요 능력치']) {
        for (const part of row['필요 능력치'].split(',')) {
          const pm = /^\s*(\S+)\s+(\d+)\s*$/.exec(part);
          const st = pm && C.STATS.find(x => x.name === pm[1]);
          if (st) reqs[st.key] = Number(pm[2]);
          else if (part.trim()) warn(`${where}: 필요 능력치 '${part.trim()}'를 읽을 수 없어요 (예: 힘 15, 민첩성 10)`);
        }
      }
      if (combat && !C.COMBAT.enemies[combat]) warn(`${where}: 전투 '${combat}'는 content.js COMBAT.enemies 에 없어요`);
      ev = {
        id, type, kind, file: label, job, npc, storyAge, combat, reqs,
        season: season < 0 ? -1 : season, seasonName,
        minAge: isStory ? 0 : (num(row['최소나이']) || 0),
        maxAge: isStory ? 999 : (num(row['최대나이']) || 999),
        minRank: rank,
        order: isStory ? (num(row['순서']) || 0) : 0,
        title: row['제목'] || id,
        text: row['이벤트 문장'],
        choices: [],
      };
      if (!ev.text) warn(`${where}: 이벤트 문장이 비어 있어요`);
      events.set(id, ev);
    }

    if (!row['선택지']) { warn(`${where}: 선택지 칸이 비어 있어 건너뜀`); continue; }

    let stat = null;
    if (row['판정 능력치']) {
      const s = C.STATS.find(x => x.name === row['판정 능력치']);
      if (!s) warn(`${where}: 판정 능력치 '${row['판정 능력치']}'는 없는 능력치예요 → 판정 없이 처리`);
      else stat = s.key;
    }

    // 다음 장면과 호감도 분기
    //   한 갈래:   분기 조건 "일리치 80" + 조건 충족 시 "장면ID"  → 80 이상이면 그 장면
    //   여러 갈래: 분기 조건 "일리치 81=장면A, 61=장면B, 41=장면C" → 높은 숫자부터 확인
    //   어느 조건에도 안 맞으면 '다음 이벤트'로
    let branch = null;
    const titleCond = /^\s*칭호\s+(.+?)\s*$/.exec(row['분기 조건'] || '');
    if (titleCond) {
      // 칭호 분기: "칭호 체스 마스터" + 조건 충족 시 칸 → 그 칭호가 있으면 그 장면
      if (!row['조건 충족 시']) warn(`${where}: 칭호 분기에 '조건 충족 시' 장면이 없어요`);
      else branch = { title: titleCond[1], cases: [{ to: row['조건 충족 시'] }] };
    } else if (row['분기 조건']) {
      const m = /^\s*(\S+)\s+(.+?)\s*$/.exec(row['분기 조건']);
      const cases = [];
      if (m) {
        for (const part of m[2].split(',')) {
          const pm = /^\s*(-?\d+)\s*(?:=\s*(\S+))?\s*$/.exec(part);
          if (!pm) { cases.length = 0; break; }
          const to = pm[2] || row['조건 충족 시'];
          if (!to) { warn(`${where}: 분기 '${part.trim()}'에 이어질 장면이 없어요 ('숫자=장면ID' 또는 '조건 충족 시' 칸)`); continue; }
          cases.push({ min: Number(pm[1]), to });
        }
      }
      if (!m || !cases.length) warn(`${where}: 분기 조건 형식이 이상해요 (예: 일리치 80 / 일리치 81=장면A, 61=장면B)`);
      else branch = { npc: m[1], cases: cases.sort((a, b) => b.min - a.min) };
    }
    // 선택 조건: "일리치 45" → 일리치 호감도 45 이상일 때만 고를 수 있음
    let require = null;
    const titleReq = /^\s*칭호\s+(.+?)\s*$/.exec(row['선택 조건'] || '');
    if (titleReq) require = { title: titleReq[1] };   // "칭호 체스 마스터" → 그 칭호가 있어야 고를 수 있음
    else if (row['선택 조건']) {
      const rm = /^\s*(\S+)\s+(-?\d+)\s*$/.exec(row['선택 조건']);
      if (rm) require = { npc: rm[1], min: Number(rm[2]) };
      else warn(`${where}: 선택 조건 형식이 이상해요 (예: 일리치 45)`);
    }
    const jobChange = row['전직'] || '';
    if (jobChange && !C.JOBS.some(j => j.name === jobChange)) warn(`${where}: 전직 '${jobChange}'는 content.js 의 JOBS 에 없어요`);

    const choice = {
      text: row['선택지'],
      stat,
      difficulty: num(row['난이도']) || 0,
      success: row['성공 결과'] || '',
      fail: row['실패 결과'] || '',
      effects: readStats(row, warn, where),
      gold: num(row['골드']) || 0,
      fatigue: num(row['피로도']) || 0,
      record: row['칭호'] || row['기록'] || '', // 예전 파일의 '기록' 열도 읽음
      affinity: num(row['호감도']) || 0,         // 이벤트의 NPC 호감도 변화 (성공 시)
      jobChange,                                 // 성공 시 이 직업으로 전직
      next: row['다음 이벤트'] || '',            // 고른 뒤 바로 이어질 장면 ID
      branch,                                    // 호감도 분기
      require,                                   // 선택 조건 (NPC 호감도 몇 이상)
      routine: row['일상'] || '',                // 성장기 일상 바꾸기 (content.js ROUTINES, '없음'이면 끔)
      equip: row['장비'] || '',                  // 성공 시 장착할 장비 ID (content.js EQUIPMENT)
      affNpc: row['호감도 NPC'] || '',           // 호감도를 바꿀 NPC (비우면 이벤트의 NPC)
      hp: num(row['체력']) || 0,                 // 성공 시 HP 변화 (그 자리 회복·피해)
      maxHp: num(row['최대 체력']) || 0,
      mainStat: num(row['주 능력치']) || 0,      // 성공 시 직업의 주 능력치 +N (전사 힘 · 마법사 지능 · 사냥꾼 민첩성)         // 성공 시 최대 HP 영구 증가 (characters.hp_bonus)
      failGold: num(row['실패 골드']) || 0,
      failFatigue: num(row['실패 피로도']) || 0,
      deathRate: num(row['실패 사망률']) || 0,
    };
    if (stat === 'cha' && choice.effects.cha) warn(`${where}: 사교성 판정의 성공 보상으로 사교성을 주지 않기로 했어요 → 다른 능력치로 바꿔 주세요`);
    if (choice.equip && !C.EQUIPMENT[choice.equip]) warn(`${where}: 장비 '${choice.equip}'는 content.js 의 EQUIPMENT 에 없어요`);
    if (stat && !choice.difficulty) warn(`${where}: 판정이 있는데 난이도가 비어 있어요`);
    if (stat && !choice.fail) warn(`${where}: 판정이 있는데 실패 결과가 비어 있어요`);
    events.get(id).choices.push(choice);
  }
}

function loadEvents() {
  const warnings = [];
  const events = new Map();
  loadEventFile(CHOICES_FILE, 'choices.csv', false, events, warnings);
  loadEventFile(STORY_FILE, 'story.csv', true, events, warnings);
  for (const ev of events.values()) {
    if (!ev.choices.length) warnings.push(`이벤트 ${ev.id}: 선택지가 하나도 없어서 쓰이지 않아요`);
    if (ev.combat && ev.choices.length < 2) warnings.push(`이벤트 ${ev.id}: 전투 장면은 선택지가 2줄 필요해요 (1번 승리, 2번 패배)`);
  }
  return { events, warnings };
}

// ---------- NPC 파일 ----------
function loadNpcs() {
  const warnings = [];
  const npcs = new Map();
  if (!fs.existsSync(NPCS_FILE)) return { npcs, warnings };
  for (const row of readTable(NPCS_FILE)) {
    const where = `npcs.csv ${row._line}번째 줄`;
    if (!row['ID'] || !row['이름']) { warnings.push(`${where}: ID나 이름이 비어 있어 건너뜀`); continue; }
    npcs.set(row['ID'], {
      id: row['ID'], name: row['이름'], village: row['마을'] || '', job: row['직업'] || '',
      role: row['역할'] || '', desc: row['소개'] || '',
      noAffinity: (row['호감도'] || '').trim() === '없음',     // '없음' = 호감도 숫자를 안 보여 줌
    });
  }
  return { npcs, warnings };
}

// ---------- 아이템 파일 ----------
function loadItems() {
  const warnings = [];
  const items = [];
  for (const row of readTable(ITEMS_FILE)) {
    const where = `items.csv ${row._line}번째 줄`;
    if (!row['ID'] || !row['이름']) { warnings.push(`${where}: ID나 이름이 비어 있어 건너뜀`); continue; }
    const price = num(row['가격']);
    if (Number.isNaN(price) || price < 0) { warnings.push(`${where}: 가격이 이상해요 (${row['가격']})`); continue; }
    items.push({
      id: row['ID'], name: row['이름'], desc: row['설명'] || '',
      price,
      effects: readStats(row, m => warnings.push(m), where),
      fatigue: num(row['피로도']) || 0,
      limit: num(row['계절당 구매 한도']) || 0,
      minRank: num(row['최소등급']) || 0,
      healPct: num(row['체력 회복']) || 0,          // 최대 HP의 몇 % 회복 (비우면 0)
    });
  }
  return { items, warnings };
}

// ---------- 바뀐 경우에만 다시 읽기 ----------
let cache = { key: null, data: null };
function mtimes() {
  return [CHOICES_FILE, STORY_FILE, NPCS_FILE, ITEMS_FILE].map(f => { try { return fs.statSync(f).mtimeMs; } catch { return 0; } }).join('|');
}

function getData() {
  const key = mtimes();
  if (cache.key === key && cache.data) return cache.data;
  let data;
  try {
    const ev = loadEvents();
    const np = loadNpcs();
    const it = loadItems();
    for (const e of ev.events.values()) {
      if (e.npc && !np.npcs.has(e.npc)) ev.warnings.push(`이벤트 ${e.id}: NPC '${e.npc}'가 npcs.csv 에 없어요`);
      e.choices.forEach((ch, i) => {
        if (ch.next && !ev.events.has(ch.next)) ev.warnings.push(`이벤트 ${e.id} 선택지 ${i + 1}: 다음 이벤트 '${ch.next}'가 없어요`);
        if (ch.routine && ch.routine !== '없음' && !C.ROUTINES[ch.routine]) ev.warnings.push(`이벤트 ${e.id} 선택지 ${i + 1}: 일상 '${ch.routine}'가 content.js ROUTINES 에 없어요`);
        if (ch.affNpc) {
          const byName = [...np.npcs.values()].find(n => n.name === ch.affNpc);
          if (byName) ch.affNpc = byName.id;
          else if (!np.npcs.has(ch.affNpc)) ev.warnings.push(`이벤트 ${e.id} 선택지 ${i + 1}: 호감도 NPC '${ch.affNpc}'가 npcs.csv 에 없어요`);
        }
        if (ch.affinity && !ch.affNpc && !e.npc) ev.warnings.push(`이벤트 ${e.id} 선택지 ${i + 1}: 호감도가 있는데 대상 NPC가 없어요 (NPC 또는 호감도 NPC 칸)`);
        if (ch.require && ch.require.npc) {
          const byName = [...np.npcs.values()].find(n => n.name === ch.require.npc);
          if (byName) ch.require.npc = byName.id;
          else if (!np.npcs.has(ch.require.npc)) ev.warnings.push(`이벤트 ${e.id} 선택지 ${i + 1}: 선택 조건의 NPC '${ch.require.npc}'가 npcs.csv 에 없어요`);
        }
        if (ch.branch) {
          for (const k of ch.branch.cases) if (!ev.events.has(k.to)) ev.warnings.push(`이벤트 ${e.id} 선택지 ${i + 1}: 분기 장면 '${k.to}'가 없어요`);
          // NPC 이름으로 적어도 ID로 바꿔 둠 (칭호 분기는 NPC 없음)
          if (ch.branch.title) return;
          const byName = [...np.npcs.values()].find(n => n.name === ch.branch.npc);
          if (byName) ch.branch.npc = byName.id;
          else if (!np.npcs.has(ch.branch.npc)) ev.warnings.push(`이벤트 ${e.id} 선택지 ${i + 1}: 분기 조건의 NPC '${ch.branch.npc}'가 npcs.csv 에 없어요`);
        }
      });
    }
    data = { events: ev.events, npcs: np.npcs, items: it.items, warnings: [...ev.warnings, ...np.warnings, ...it.warnings], loadedAt: new Date() };
  } catch (err) {
    // 읽기 실패 시 직전 데이터를 계속 사용
    console.error('[데이터] CSV를 읽지 못했어요:', err.message);
    if (cache.data) return cache.data;
    throw err;
  }
  if (cache.key !== null) console.log(`[데이터] CSV 변경 감지 → 다시 읽음 (경고 ${data.warnings.length}개)`);
  data.warnings.forEach(w => console.warn('[데이터 경고]', w));
  cache = { key, data };
  return data;
}

module.exports = { getData, parseCSV, decode };
