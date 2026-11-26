// ============================================================
//  게임 규칙 (판정 로직)
//  DB를 직접 건드리지 않고 "무엇을 바꿀지(updates)"와
//  "로그에 남길 글(logs)"만 돌려줍니다. 저장은 app.js 가 합니다.
//  모든 판정은 서버에서만 일어나므로 브라우저에서 조작할 수 없습니다.
// ============================================================
const C = require('../data/content');
const { getData } = require('./data');

const STAT_KEYS = C.STATS.map(s => s.key);
const EFFECT_KEYS = [...STAT_KEYS, ...C.MAGIC_STATS.map(s => s.key), ...C.SPECIAL_STATS.map(s => s.key)]; // CSV 보상으로 바꿀 수 있는 능력치 (마나 포함)
const statName = key => ([...C.STATS, ...C.MAGIC_STATS, ...C.SPECIAL_STATS].find(s => s.key === key) || { name: key }).name;

const csv = str => (str ? String(str).split(',').filter(Boolean) : []);
const toCsv = arr => arr.join(',');
const clamp = (n, lo, hi) => Math.max(lo, Math.min(hi, n));
const pick = (arr, rng) => arr[Math.floor(rng() * arr.length)];

// ---------- HP ----------
// 최대 HP = 30 + 힘 × 2 + 이벤트로 얻은 추가 최대 HP(hp_bonus)
const maxHp = c => Math.round(C.COMBAT.hpBase + (c.str || 0) * C.COMBAT.hpPerStr + (c.hp_bonus || 0) + equipEffect(c, 'maxHp'));   // 갑옷 최대 HP
const curHp = c => (c.hp === null || c.hp === undefined ? maxHp(c) : Math.min(c.hp, maxHp(c)));
// 마법사: 마나를 각성한 마법사는 지능으로 싸움 (공격 전조가 마법진, 반격에 마나만큼 고정 추가 피해)
const isMage = c => c.job === '마법사' && (c.mana || 0) > 0;
// 사냥꾼: 무기가 톱칼이면 민첩으로 싸우고 출혈을 쌓음 (석궁이 있으면 Just Guard 때 출혈 +1)
const isHunter = c => !isMage(c) && equipmentOf(c)[0].id === 'saw_blade';
const attackPower = c => (isMage(c)
  ? C.COMBAT.magic.atkBase + (c.intel || 0) * C.COMBAT.magic.atkPerInt
  : isHunter(c) ? C.COMBAT.hunt.atkBase + (c.agi || 0) * C.COMBAT.hunt.atkPerAgi
  : C.COMBAT.atkBase + (c.str || 0) * C.COMBAT.atkPerStr)
  + equipEffect(c, 'atk')                                            // 장비 공격력 (일리치의 검 +3 등)
  + weaponLevel(c) * C.SMITHY.upgrade.atk                            // 대장간 강화 (+3 / 단계)
  + (c.str || 0) * equipEffect(c, 'atkPerStr')                       // 어느 노인의 반지: 힘 × 0.5
  + Math.floor((c.str || 0) / 10) * equipEffect(c, 'atkPer10Str')    // 보조 철검: 힘 10당 +2
  + maxHp(c) * equipEffect(c, 'atkFromHp');                          // 라운드 쉴드: 최대 HP 의 5%
const weaponLevel = c => Math.max(0, Math.min(C.SMITHY.upgrade.max, Number(parseEquip(c.equipment).wlv) || 0));
function bleedOf(c) {
  if (!isHunter(c)) return null;
  const H = C.COMBAT.hunt, cross = equipEffect(c, 'crossbow') > 0, poison = equipEffect(c, 'poison');
  // 강화된 석궁: 중첩당 피해 +0.5 · 독 석궁: 출혈 대신 독, 최대 12중첩
  return { per: H.perStack + equipEffect(c, 'bleedPer'), max: poison || H.maxStacks, poison: !!poison,
    add: { ...H.stack, perfect: H.stack.perfect + (cross ? H.crossbow : 0) }, crossbow: cross };
}
const flatDamage = c => (isMage(c) && !equipEffect(c, 'noManaFlat') ? (c.mana || 0) * C.COMBAT.magic.manaFlat : 0);   // 어느 노인의 반지면 마나 고정 피해 없음
// Guard 한 번의 반격 피해 (공격 횟수 계산용) · 사냥꾼은 출혈을 평균 절반쯤 쌓였다고 보고 더함
const hitPower = c => attackPower(c) + flatDamage(c) + (isHunter(c) ? C.COMBAT.hunt.perStack * C.COMBAT.hunt.maxStacks / 2 : 0);
const signed = n => `${n > 0 ? '+' : ''}${n}`;

function describeEffects(effects) {
  return Object.entries(effects || {}).filter(([, v]) => v).map(([k, v]) => `${statName(k)} ${signed(v)}`).join(', ');
}

function applyEffects(c, effects, updates) {
  for (const [key, val] of Object.entries(effects || {})) {
    if (!EFFECT_KEYS.includes(key) || !val) continue;
    const current = updates[key] !== undefined ? updates[key] : c[key];
    updates[key] = clamp(current + val, 0, 999);
  }
}

function timeLabel(c) {
  return c.phase === 'adult' ? `${c.year_no}년차 ${C.SEASONS[c.season]}` : `${c.age}세`;
}

function getJob(c) { return C.JOBS.find(j => j.name === c.job) || null; }
function rankName(c) {
  const job = getJob(c);
  if (!job) return '';
  return job.ranks[c.rank_level] || job.ranks[job.ranks.length - 1];
}

function findEvent(id) { return getData().events.get(id) || null; }
// 비주얼노벨: 장면 글에 {비주얼노벨:이름} 이 있으면 data/vn/이름.txt 대본 (lib/vn.js)
const VN = require('./vn');
// 대본 속 {이름}·{세실나이} 등도 캐릭터에 맞게 바꿈 (c 를 넘기면)
const vnFor = (ev, c) => {
  const id = ev && VN.idOf(ev.text); const v = id ? VN.load(id) : null;
  if (!v || !c) return v;
  return { ...v, ops: v.ops.map(o => (o.op === 'say' ? { ...o, text: fill(o.text, c), who: o.who && fill(o.who, c) } : o.op === 'choice' ? { ...o, options: o.options.map(x => ({ ...x, text: fill(x.text, c) })) } : o)) };
};
function eventsOf(type) { return [...getData().events.values()].filter(e => e.type === type && e.choices.length); }

// 이벤트의 직업 조건 (비어 있으면 모든 직업)
const inJob = (e, c) => !e.job || e.job === c.job;

// ---------- 메인 스토리 ----------
// 현재 직업·등급의 장 목록 (순서대로)
function storyChapters(job, rank) {
  return eventsOf('메인스토리').filter(e => e.kind === 'rank' && (!e.job || e.job === job) && e.minRank === rank).sort((a, b) => a.order - b.order);
}
function storyInfo(c) {
  if (c.phase !== 'adult' || !c.job) return null;
  const done = csv(c.story_done);
  const chapters = storyChapters(c.job, c.rank_level).map(e => ({ id: e.id, title: e.title, order: e.order, done: done.includes(e.id) }));
  const nextCh = chapters.find(ch => !ch.done) || null;
  let next = null;
  const gate = storyReqView(c, c.rank_level);
  if (nextCh) {
    const reqs = reqView(c, findEvent(nextCh.id).reqs || {});
    next = { ...nextCh, reqs, gate, ready: reqs.every(r => r.ok) && (!gate || gate.ok) };
  }
  return {
    chapters, next, gate,
    doneCount: chapters.filter(ch => ch.done).length,
    allDone: chapters.length ? !next : C.STORY.openIfEmpty,
    empty: !chapters.length,
    rank: rankName(c),
  };
}
// 협동 의뢰: 현재 등급의 메인 스토리를 전부 끝내면 열림
// 귀환 뒤 다시 시작할 장면 표시 (story_done 안에 'resume:장면ID')
const RESUME_PREFIX = 'resume:';
// 지금 진행 중인 메인 스토리 장 = 이 등급에서 마지막으로 시작한 장
function currentChapter(c) {
  const done = csv(c.story_done);
  const list = storyChapters(c.job, c.rank_level).filter(e => done.includes(e.id));
  return list.length ? list[list.length - 1].id : null;
}
// 등급별 메인 스토리 개방 조건 (STORY.storyReq) — 힘/민첩/지능 중 하나 N 이상 + 나이 M세 이하
function storyReqView(c, rank) {
  const R = (C.STORY.storyReq || {})[rank];
  if (!R) return null;
  const stats = (R.anyOf || []).map(k => ({ key: k, name: statName(k), have: c[k] || 0 }));
  const best = stats.reduce((a, b) => (b.have > a.have ? b : a), stats[0] || { have: 0 });
  const statOk = !stats.length || best.have >= R.min, ageOk = !R.maxAge || (c.age || 0) <= R.maxAge;
  return {
    name: R.name, ok: statOk && ageOk, statOk, ageOk, best,
    text: `${stats.map(x => x.name).join(' / ')} 중 하나 ${R.min} 이상${R.maxAge ? ` · 나이 ${R.maxAge}세 이하` : ''}`,
    now: `지금 ${stats.map(x => `${x.name} ${x.have}`).join(' · ')}${R.maxAge ? ` · ${c.age}세` : ''}`,
  };
}
// 필요 능력치 표시용
function reqView(c, reqs) {
  return Object.entries(reqs).map(([key, need]) => ({ key, name: statName(key), need, have: c[key], ok: c[key] >= need }));
}

// 왕도 첫 이야기(1차 메인 스토리)를 끝내야 협동·1인 격파·단련·상점이 열림 (사용자 지정 · STORY.unlockAfter 장면을 끝까지 보면)
const adultOpen = c => c.phase === 'adult' && (!C.STORY.unlockAfter || csv(c.story_done).includes(C.STORY.unlockAfter));
// 협동 의뢰는 성인이 되어 왕도 첫 이야기를 마치면 언제든 (능력치를 올리는 수단)
const coopUnlocked = c => adultOpen(c);
// 이야기 속 장면을 끝까지 보면 story_done 에 남겨 기능을 여는 표시들
function unlockMarkers() {
  const out = [];
  const add = (id, text) => { if (!id) return; const m = out.find(x => x.id === id); if (m) m.text = [m.text, text].filter(Boolean).join(' '); else out.push({ id, text }); };
  add(C.STORY.unlockAfter, '왕도에서의 생활이 시작됐다. 협동 의뢰 · 1인 격파 · 상점이 열렸어요.');
  add(C.SMITHY && C.SMITHY.unlockAfter, '대장간이 열렸어요. (위쪽 메뉴 · 의뢰게시판 옆)');
  (C.STORY.rankGates || []).forEach(id => add(id, '이번 등급의 이야기를 마쳤다. 승급 시험에 도전할 수 있어요.'));
  return out;
}
// 대장간: 왕도 1차 이야기에서 세실의 안내를 받으면 열림
const smithyOpen = c => adultOpen(c) && !!C.SMITHY && csv(c.story_done).includes(C.SMITHY.unlockAfter);

// ---------- 칭호 ----------
// 칭호를 얻으면 records 에 추가하고, content.js TITLES 의 효과를 한 번 적용
function grantTitle(c, title, updates, extras) {
  const records = csv(updates.records !== undefined ? updates.records : c.records);
  if (records.includes(title)) return false;
  updates.records = toCsv([...records, title]);
  const t = C.TITLES[title];
  const eff = t && t.effects ? describeEffects(t.effects) : '';
  if (t && t.effects) applyEffects(c, t.effects, updates);
  extras.push(`칭호 「${title}」 획득${eff ? ` (${eff})` : ''}`);
  return true;
}

// ---------- 판정 ----------
function successChance(c, choice) {
  if (!choice.stat) return null; // 판정 없음 = 항상 성공
  return clamp(50 + (c[choice.stat] - choice.difficulty) * C.CHECK.perPoint, C.CHECK.min, C.CHECK.max);
}
function deathChance(c, choice) {
  if (!choice.deathRate) return 0;
  return choice.deathRate + (c.phase === 'adult' && c.fatigue >= C.FATIGUE.dangerLine ? C.FATIGUE.dangerExtraDeath : 0);
}

// 문장 속 {이름} 을 캐릭터 이름으로 바꿈
// 문장 속 {이름} → 캐릭터 이름, {형}·{오빠} → 성별에 맞는 호칭 (content.js GENDER_WORDS)
function fill(text, c) {
  return String(text || '')
    .replace(/\{이름\}|\[캐릭터 이름\]|\[모험가 이름\]/g, c.name || '')
    .replace(/\{(세실|앨리스)나이\}/g, String(Math.max(1, (c.age || C.ADULT_AGE) - C.ALICE_AGE_GAP)))   // 세실(예전 이름 앨리스) 나이 = 주인공 나이 − 4 (사용자 지정)
    .replace(/\{([^{}]+)\}/g, (all, w) => {
      const g = C.GENDER_WORDS[w];
      return g ? (g[c.gender] || g.기본) : all;
    });
}

// 골드를 내는 선택지인데 돈이 모자라면 고를 수 없음
// 지능 보너스: 얻는 골드 (지능 5당 +3% · C.GOLD_BONUS)
const goldRate = c => { const B = C.GOLD_BONUS; return B ? Math.floor((c[B.stat] || 0) / B.per) * B.pct : 0; };
const boostGold = (c, g) => (g > 0 ? Math.round(g * (1 + goldRate(c))) : g);
const cost = ch => (ch.gold < 0 ? -ch.gold : 0);
const affordable = (c, ch) => cost(ch) <= (c.gold || 0);

// 선택 조건 (예: 일리치 호감도 45 이상) — 못 맞추면 { label } 을 돌려줌
function lockOf(c, ch) {
  if (!ch.require) return null;
  if (ch.require.title) return csv(c.records).includes(ch.require.title) ? null : { label: `칭호 「${ch.require.title}」` };
  const aff = (c.npcAff || {})[ch.require.npc] || 0;
  if (aff >= ch.require.min) return null;
  const n = getData().npcs.get(ch.require.npc);
  return { label: `${n ? n.name : ch.require.npc} 호감도 ${ch.require.min} 이상` };
}

// 화면에 보여 줄 선택지 정보
function choiceViews(c, event) {
  return event.choices.map((ch, i) => ({
    index: i, text: fill(ch.text, c),
    statLabel: ch.stat ? statName(ch.stat) : null,
    chance: successChance(c, ch),
    death: deathChance(c, ch),
    failGain: ch.stat ? C.CHECK.failGain : 0,
    cost: cost(ch),
    affordable: affordable(c, ch),
    lock: lockOf(c, ch),
  }));
}

// ---------- 캐릭터 생성 ----------
function buildNewCharacter(input, rng = Math.random) {
  const errors = [];
  const name = String(input.name || '').trim();
  if (name.length < 2 || name.length > 12) errors.push('이름은 2~12자로 정해 주세요.');

  const gender = ['남성', '여성'].includes(input.gender) ? input.gender : pick(['남성', '여성'], rng);
  const race = C.RACES[0]; // 모두 인간
  // 태어난 마을이 시작 직업을 정함
  const village = C.VILLAGES.find(v => v.name === input.village) || pick(C.VILLAGES, rng);

  let tagNames = [...new Set([].concat(input.tags || []).filter(t => C.TAGS.some(x => x.name === t)))];
  if (tagNames.length > 2) errors.push('성격 태그는 2개까지 고를 수 있어요.');
  while (tagNames.length < 2) {
    const t = pick(C.TAGS, rng).name;
    if (!tagNames.includes(t)) tagNames.push(t);
  }
  const tags = tagNames.map(n => C.TAGS.find(t => t.name === n));
  const intro = String(input.intro || '').trim().slice(0, 200);

  const stats = {};
  for (const key of STAT_KEYS) stats[key] = 5 + Math.floor(rng() * 3);
  for (const src of [race.bonus, village.bonus, ...tags.map(t => t.bonus)]) {
    for (const [k, v] of Object.entries(src || {})) stats[k] += v;
  }

  return {
    errors,
    fields: {
      name, gender, race: race.name, origin: village.name, tags: toCsv(tagNames), intro,
      job: village.job, rank_level: 0,
      phase: 'growth', age: C.START_AGE, ...stats, seen_events: '', records: '', purchases: '', story_done: '',
      gold: C.CHILD_GOLD, routine: null,
      luck: 0, // 칭호 전용 특별 능력치. 모두 0에서 시작
    },
    firstLog: {
      label: `${C.START_AGE}세`, kind: 'system',
      text: `${village.name}에서 자라는 아이, ${name}. ${tagNames.join('·')} 성격으로 자라고 있다.`,
    },
  };
}

// ---------- 성장기: 다음 해 ----------
function growthNextYear(c, rng = Math.random) {
  if (c.phase !== 'growth') return { error: '성장기가 아닙니다.' };
  if (c.pending_event) return { error: '먼저 지금 일어난 일에 답해 주세요.' };

  const age = c.age + 1;
  const updates = { age, hp: null }; // 해가 바뀌면 HP 가득
  const logs = [];
  const label = `${age}세`;

  if (age >= C.ADULT_AGE) {
    updates.phase = 'bonus';
    updates.bonus_points = C.BONUS_POINTS;
    logs.push({ label, kind: 'system', text: '어른이 되었다. 이제 마을을 떠나 왕도로 갈 때다.' });
    return { updates, logs };
  }

  // 일상 (예: 장작 패기) — 매년 먼저 흘러감
  if (c.routine && C.ROUTINES[c.routine]) {
    const r = C.ROUTINES[c.routine];
    applyEffects(c, r.effects, updates);
    const eff = describeEffects(r.effects);
    logs.push({ label, kind: 'daily', text: `${fill(r.text, c)}${eff ? ` (${eff})` : ''}` });
  }

  const seen = csv(c.seen_events);
  // 큰 사건: 1순위 이 나이에 시작하는 마을 메인 스토리(반드시), 2순위 나이 범위가 끝나는 성장 이벤트, 3순위 확률
  // 이 나이의 마을 스토리 장면들 (순서대로, 여러 개면 소소한 사건 사이사이에 배치)
  const stories = eventsOf('메인스토리').filter(e => e.kind === 'age' && e.storyAge === age && inJob(e, c) && !seen.includes(e.id))
    .sort((a, b) => a.order - b.order);
  const story = stories.length ? stories[stories.length - 1] : null;
  const candidates = eventsOf('성장').filter(e => age >= e.minAge && age <= e.maxAge && inJob(e, c) && !seen.includes(e.id));
  const forced = candidates.find(e => e.maxAge === age);
  const big = story || forced || (candidates.length && rng() < C.GROWTH_EVENT_CHANCE ? pick(candidates, rng) : null);
  const bigs = story ? stories : (big ? [big] : []);

  // 소소한 사건으로 그 해를 채움 (안 본 것 우선, 같은 해 중복 없음)
  const range = story ? C.EVENTS_PER_YEAR.storyYear : C.EVENTS_PER_YEAR.normal;
  const target = range.min + Math.floor(rng() * (range.max - range.min + 1));
  const pool = eventsOf('소소').filter(e => age >= e.minAge && age <= e.maxAge && inJob(e, c));
  const fresh = shuffle(pool.filter(e => !seen.includes(e.id)), rng);
  const old = shuffle(pool.filter(e => seen.includes(e.id)), rng);
  const small = [...fresh, ...old].slice(0, Math.max(bigs.length > 1 ? 1 : 0, target - bigs.length));

  // 소소한 사건들 → 마지막에 큰 사건 (그 해의 하이라이트)
  // 스토리 장면이 여럿이면 소소한 사건을 그 사이에 고르게 끼움 (마지막 장면은 항상 맨 끝)
  const queue = [];
  const gaps = bigs.length || 1;
  const per = Math.floor(small.length / gaps), extra = small.length % gaps;
  let si = 0;
  for (let g = 0; g < gaps; g++) {
    const n = per + (g < extra ? 1 : 0);
    queue.push(...small.slice(si, si + n)); si += n;
    if (bigs[g]) queue.push(bigs[g]);
  }
  if (queue.length) {
    const first = queue.shift();
    updates.pending_event = first.id;
    updates.event_queue = queue.map(e => e.id).join(',') || null;
    updates.seen_events = toCsv([...new Set([...seen, first.id, ...queue.map(e => e.id)])]);
    logs.push({ label, kind: 'event', text: fill(first.text, c) });
  } else if (!logs.length) {
    let text = pick(C.DAILY_LINES, rng);
    if (rng() < 0.3) {
      const key = pick(STAT_KEYS, rng);
      applyEffects(c, { [key]: 1 }, updates);
      text += ` (${statName(key)} +1)`;
    }
    logs.push({ label, kind: 'daily', text });
  }
  return { updates, logs };
}

function shuffle(arr, rng) {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(rng() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; }
  return a;
}

// ---------- 선택지 고르기 (모든 이벤트 공통) ----------
// c.npcAff = { NPC ID: 호감도 } 는 app.js 가 DB에서 읽어 넣어 줌 (호감도 분기용)
function resolveChoice(c, index, rng = Math.random, fromCombat = false) {
  if (!c.pending_event) return { error: '선택할 이벤트가 없습니다.' };
  if (specialCombat(c) || isTrainPending(c)) return { error: '전투 중이에요.' };
  const event = findEvent(c.pending_event);
  if (!event) return { updates: { pending_event: null }, logs: [] }; // CSV에서 지워진 이벤트
  if (event.combat && !fromCombat) return { error: '전투로 결정되는 장면이에요.' };
  const choice = event.choices[Number(index)];
  if (!choice) return { error: '잘못된 선택입니다.' };
  if (!affordable(c, choice)) return { error: `골드가 부족해요. (${cost(choice)} 필요)` };
  const lock = lockOf(c, choice);
  if (lock) return { error: `아직 고를 수 없는 선택지예요. (${lock.label})` };

  const updates = { pending_event: null };
  const logs = [];
  const label = timeLabel(c);
  const chance = successChance(c, choice);
  const ok = chance === null || rng() * 100 < chance;
  const extras = [];
  const storyMode = event.type === '메인스토리' || event.type === '연결';
  // NPC 기록: 이벤트 NPC(또는 선택지의 호감도 NPC)를 만난 것으로 저장, 호감도 변화는 성공 시
  const target = choice.affNpc || event.npc;
  const npc = target ? [{ id: target, delta: 0 }] : [];

  // 골드를 내는 선택지는 결과와 상관없이 지불
  if (choice.gold < 0) { updates.gold = Math.max(0, c.gold + choice.gold); extras.push(`골드 ${signed(choice.gold)}`); }

  if (ok) {
    applyEffects(c, choice.effects, updates);
    const eff = describeEffects(choice.effects);
    if (eff) extras.push(eff);
    if (choice.gold > 0) { const g = boostGold(c, choice.gold); updates.gold = c.gold + g; extras.push(`골드 ${signed(g)}`); }
    if (choice.fatigue && c.phase === 'adult') {
      updates.fatigue = clamp(c.fatigue + choice.fatigue, 0, C.FATIGUE.max);
      extras.push(choice.fatigue <= -999 ? '피로도 모두 회복' : `피로도 ${signed(choice.fatigue)}`);
    }
    if (choice.record) grantTitle(c, choice.record, updates, extras);
    if (choice.mainStat && getJob(c)) {               // 주 능력치 보상 (직업의 주 능력치: 전사 힘 · 마법사 지능 · 사냥꾼 민첩성)
      const key = getJob(c).mainStat;
      applyEffects(c, { [key]: choice.mainStat }, updates);
      extras.push(`${statName(key)} ${signed(choice.mainStat)}`);
    }
    if (choice.maxHp) {
      updates.hp_bonus = (c.hp_bonus || 0) + choice.maxHp;
      extras.push(`최대 HP ${signed(choice.maxHp)}`);
    }
    if (choice.hp) {
      updates.hp = clamp(curHp(c) + choice.hp, 1, maxHp({ ...c, ...updates }));
      extras.push(choice.hp >= 999 ? 'HP 모두 회복' : `HP ${signed(choice.hp)}`);
    }
    if (choice.affinity && target) {
      npc[0].delta = choice.affinity;
      const n = getData().npcs.get(target);
      extras.push(`${n ? n.name : target} 호감도 ${signed(choice.affinity)}`);
    }
    if (choice.jobChange && choice.jobChange !== c.job) {
      const to = C.JOBS.find(j => j.name === choice.jobChange);
      if (to) {
        updates.job = to.name;
        updates.rank_level = C.JOB_CHANGE_KEEP_RANK ? Math.min(c.rank_level, to.ranks.length - 1) : 0;
        extras.push(`전직: ${c.job} → ${to.name}`);
      }
    }
  } else {
    // 실패 시 사망 판정
    const death = deathChance(c, choice);
    if (death && rng() * 100 < death) {
      logs.push({ label, kind: 'event', text: `${fill(choice.text, c)} — ${fill(choice.fail, c)} 그리고 다시는 돌아오지 못했다.` });
      return tryRevive(c, { updates: {}, logs, dead: true, npc });
    }
    // 실패해도 판정 능력치는 조금 오름
    if (choice.stat && C.CHECK.failGain) {
      applyEffects(c, { [choice.stat]: C.CHECK.failGain }, updates);
      extras.push(`${statName(choice.stat)} +${C.CHECK.failGain}`);
    }
    if (choice.failGold) { updates.gold = Math.max(0, (updates.gold ?? c.gold) + choice.failGold); extras.push(`골드 ${signed(choice.failGold)}`); }
    if (choice.failFatigue && c.phase === 'adult') {
      updates.fatigue = clamp(c.fatigue + choice.failFatigue, 0, C.FATIGUE.max);
      extras.push(`피로도 ${signed(choice.failFatigue)}`);
    }
  }

  // 장비 장착 (성공 시)
  if (ok && choice.equip && C.EQUIPMENT[choice.equip]) {
    const item = C.EQUIPMENT[choice.equip];
    const eq = parseEquip(updates.equipment !== undefined ? updates.equipment : c.equipment);
    eq[item.slot] = choice.equip;
    if (item.effects && item.effects.revive) eq.revive = String(item.effects.revive);   // 귀환 횟수 (장신구 효과)
    updates.equipment = Object.entries(eq).map(([k, v]) => `${k}:${v}`).join(',');
    extras.push(`${item.name} 장착`);
  }

  // 성장기 일상 바꾸기
  if (choice.routine) {
    updates.routine = choice.routine === '없음' ? null : choice.routine;
    if (updates.routine) extras.push(`이제 매년 「${updates.routine}」`);
  }

  const verdict = chance === null ? '' : (ok ? '[성공] ' : '[실패] ');
  const result = fill(ok ? choice.success : choice.fail, c);
  const extraText = extras.length ? `(${extras.join(', ')})` : '';
  if (storyMode) {
    // 스토리: 고른 말과 결과 문장을 따로 보여 줌
    logs.push({ label, kind: 'choice', text: `${verdict}${fill(choice.text, c)}` });
    if (result || extraText) logs.push({ label, kind: 'event', text: [result, extraText].filter(Boolean).join('\n') });
  } else {
    logs.push({ label, kind: 'event', text: `${verdict}${fill(choice.text, c)} — ${result}${extraText ? ` ${extraText}` : ''}` });
  }


  // 왕도 1차 이야기의 표시 장면 → 기능 개방 (STORY.unlockAfter · SMITHY.unlockAfter · STORY.rankGates)
  if (ok) {
    for (const m of unlockMarkers()) {
      if (m.id !== event.id) continue;
      const done = csv(updates.story_done !== undefined ? updates.story_done : c.story_done);
      if (done.includes(event.id)) continue;
      updates.story_done = toCsv([...done, event.id]);
      if (m.text) logs.push({ label, kind: 'system', text: m.text });
    }
  }

  // 성인 메인 스토리 장: 성공해야 그 장이 완료됨. 현재 등급의 장을 다 끝내면 협동 의뢰 개방
  if (event.type === '메인스토리' && event.kind === 'rank') {
    if (ok) {
      const before = storyInfo(c);
      const done = csv(updates.story_done !== undefined ? updates.story_done : c.story_done);
      if (!done.includes(event.id)) updates.story_done = toCsv([...done, event.id]);
      logs.push({ label, kind: 'system', text: `메인 스토리 「${event.title}」 완료.` });
      const after = storyInfo({ ...c, ...updates });
      const gateOk = !C.STORY.rankGates || csv((updates.story_done !== undefined ? updates.story_done : c.story_done)).includes(C.STORY.rankGates[c.rank_level]);
      if (before && !before.allDone && after && after.allDone && gateOk) {
        logs.push({ label, kind: 'system', text: `${after.rank} 등급의 이야기를 모두 마쳤다. 이제 승급 시험에 도전할 수 있다.` });
      }
    } else {
      logs.push({ label, kind: 'system', text: `메인 스토리 「${event.title}」를 마치지 못했다. 다시 도전할 수 있다.` });
    }
  }

  // 다음 장면: 호감도 분기 → 조건 충족 시 장면, 아니면 '다음 이벤트'
  let nextId = choice.next;
  if (choice.branch) {
    const b = choice.branch;
    if (b.title) {
      // 칭호 분기: 그 칭호가 있으면 조건 충족 장면
      if (csv(updates.records !== undefined ? updates.records : c.records).includes(b.title)) nextId = b.cases[0].to;
    } else {
      const aff = ((c.npcAff || {})[b.npc] || 0) + (npc[0] && npc[0].id === b.npc ? npc[0].delta : 0);
      const hit = b.cases.find(k => aff >= k.min); // 높은 숫자부터
      if (hit) nextId = hit.to;
    }
  }
  const nextEv = nextId ? findEvent(nextId) : null;
  if (nextEv) {
    updates.pending_event = nextEv.id;
    logs.push({ label, kind: 'event', text: fill(nextEv.text, c) });
    return { updates, logs, npc, seen: [event.id] };
  }

  // 그 해에 남은 사건이 있으면 이어서
  const queue = csv(c.event_queue);
  if (queue.length) {
    const ev = findEvent(queue[0]);
    updates.event_queue = queue.slice(1).join(',') || null;
    if (ev) {
      updates.pending_event = ev.id;
      logs.push({ label, kind: 'event', text: fill(ev.text, c) });
      return { updates, logs, npc, seen: [event.id] };
    }
  }

  // 이어지는 장면이 없으면 끝: 성인이 의뢰·스토리를 마쳤다면 한 계절이 지남
  const passes = event.type === '연결' || (event.type === '메인스토리' && C.STORY.passSeason);
  if (c.phase === 'adult' && passes) passSeason({ ...c, ...updates }, updates, logs, rng);
  return { updates, logs, npc, seen: [event.id] };
}

// ---------- 보너스 포인트 분배 ----------
function applyBonus(c, alloc, rng = Math.random) {
  if (c.phase !== 'bonus') return { error: '지금은 보너스를 분배할 때가 아닙니다.' };
  const updates = { bonus_points: 0, phase: 'job' };
  let total = 0;
  const effects = {};
  for (const key of STAT_KEYS) {
    const n = Number.parseInt(alloc[key], 10) || 0;
    if (n < 0) return { error: '음수는 넣을 수 없어요.' };
    total += n;
    if (n) effects[key] = n;
  }
  if (total !== c.bonus_points) return { error: `포인트를 정확히 ${c.bonus_points}점 나눠 주세요. (지금 ${total}점)` };
  applyEffects(c, effects, updates);
  const logs = [{ label: timeLabel(c), kind: 'system', text: `스스로를 다듬었다. (${describeEffects(effects)})` }];
  // 마을에서 직업이 정해진 캐릭터는 바로 성인 생활 시작 (예전 캐릭터만 직업 선택 단계로)
  if (c.job) startAdult({ ...c, ...updates }, c.job, updates, logs, rng);
  return { updates, logs };
}

function recommendJobs(c) {
  return [...C.JOBS].sort((a, b) => c[b.mainStat] - c[a.mainStat]).map(j => j.name);
}

// ---------- 직업 선택 → 성인 시작 ----------
// 성인 생활 시작 (직업 등록, 1년차 봄, 첫 계절 이벤트)
function startAdult(c, jobName, updates, logs, rng) {
  const job = C.JOBS.find(j => j.name === jobName);
  Object.assign(updates, { job: job.name, rank_level: c.rank_level || 0, phase: 'adult', year_no: 1, season: 0, fatigue: 0, gold: (c.gold || 0) + C.START_GOLD, routine: null });
  const label = `1년차 ${C.SEASONS[0]}`;
  logs.push({ label, kind: 'system', text: C.CAPITAL.arriveText.replace('{마을}', c.origin || '고향') });
  logs.push({ label, kind: 'system', text: `${job.name}(${job.ranks[updates.rank_level]})로 등록했다. 의뢰게시판에 이름이 올랐다. (골드 +${C.START_GOLD})` });
  queueSeasonEvents(c, updates, logs, rng);
}

// 예전 버전에서 만든(마을 직업이 없는) 캐릭터만 쓰는 직업 선택
function chooseJob(c, jobName, rng = Math.random) {
  if (c.phase !== 'job') return { error: '지금은 직업을 고를 때가 아닙니다.' };
  if (!C.JOBS.find(j => j.name === jobName)) return { error: '없는 직업입니다.' };
  const updates = {};
  const logs = [];
  startAdult({ ...c, rank_level: 0 }, jobName, updates, logs, rng);
  return { updates, logs };
}

// ---------- 계절 ----------
const inSeason = (e, c) => e.season === -1 || e.season === c.season;
// 최소나이·최대나이는 모든 이벤트에 적용 (예: 17세 봄에만 나오는 의뢰)
const inAge = (e, c) => c.age >= e.minAge && c.age <= e.maxAge;

function pickSeasonEvent(c, rng) {
  const list = eventsOf('계절').filter(e => inSeason(e, c) && inAge(e, c) && inJob(e, c) && c.rank_level >= e.minRank);
  return list.length ? pick(list, rng) : null;
}
// 계절이 바뀔 때 일어나는 사건들: 계절 사건 C.SEASON_EVENTS.count 개(겹치지 않게) + 행운% 확률로 '행운' 사건 하나 (맨 앞)
function seasonEvents(c, rng) {
  const pool = eventsOf('계절').filter(e => inSeason(e, c) && inAge(e, c) && inJob(e, c) && c.rank_level >= e.minRank);
  const out = [];
  while (pool.length && out.length < (C.SEASON_EVENTS.count || 1)) out.push(pool.splice(Math.floor(rng() * pool.length), 1)[0]);
  const lucky = eventsOf('행운').filter(e => inAge(e, c) && inJob(e, c) && c.rank_level >= e.minRank);
  if (lucky.length && rng() * 100 < (c.luck || 0) * (C.SEASON_EVENTS.luckPct || 1)) out.unshift(pick(lucky, rng));
  return out;
}
// 첫 사건은 바로 띄우고 나머지는 event_queue 로 (하나 끝날 때마다 다음 것이 이어서 나옴)
function queueSeasonEvents(c, updates, logs, rng) {
  const next = { ...c, ...updates };
  const list = seasonEvents(next, rng);
  if (!list.length) return false;
  updates.pending_event = list[0].id;
  updates.event_queue = list.slice(1).map(e => e.id).join(',') || null;
  logs.push({ label: timeLabel(next), kind: 'event', text: fill(list[0].text, c) });
  return true;
}

function passSeason(c, updates, logs, rng) {
  let season = c.season + 1, year = c.year_no, age = c.age;
  if (season >= C.SEASONS.length) { season = 0; year += 1; age += 1; }
  Object.assign(updates, { season, year_no: year, age });
  // 계절이 지나면 최대 HP의 seasonHeal(60%) 만큼 회복 (가득 차면 null = 가득)
  const before = { ...c, ...updates };
  const mx = maxHp(before), healed = Math.min(mx, curHp(before) + Math.round(mx * (C.COMBAT.seasonHeal ?? 1)));
  updates.hp = healed >= mx ? null : healed;
  const next = { ...c, ...updates };
  if (!queueSeasonEvents(c, updates, logs, rng)) logs.push({ label: timeLabel(next), kind: 'daily', text: `${C.SEASONS[season]}이 왔다.` });
}

function rest(c, rng = Math.random) {
  if (c.phase !== 'adult') return { error: '아직 성인이 아닙니다.' };
  if (c.pending_event) return { error: '먼저 지금 일어난 일에 답해 주세요.' };
  const updates = { fatigue: clamp(c.fatigue + C.REST.fatigue, 0, C.FATIGUE.max) };
  const logs = [{ label: timeLabel(c), kind: 'daily', text: `한 계절을 푹 쉬었다. (피로도 ${C.REST.fatigue})` }];
  passSeason(c, updates, logs, rng);
  return { updates, logs };
}

// 메인 스토리 다음 장 시작
function startStory(c) {
  if (c.phase !== 'adult') return { error: '아직 성인이 아닙니다.' };
  if (c.pending_event) return { error: '먼저 지금 일어난 일에 답해 주세요.' };
  const info = storyInfo(c);
  if (!info || !info.next) return { error: '진행할 메인 스토리가 없어요.' };
  if (info.next.gate && !info.next.gate.ok) return { error: `조건을 채워야 이야기를 이어갈 수 있어요. (${info.next.gate.text} · 협동 의뢰로 올릴 수 있어요)` };
  if (!info.next.ready) {
    const short = info.next.reqs.filter(r => !r.ok).map(r => `${r.name} ${r.need}`).join(', ');
    return { error: `능력치가 부족해 이야기를 이어갈 수 없어요. (${short} 필요 · 협동 의뢰로 올릴 수 있어요)` };
  }
  if (!C.STORY.ignoreFatigue && c.fatigue >= C.FATIGUE.questLimit) return { error: `피로도가 ${C.FATIGUE.questLimit} 이상이라 진행할 수 없어요. 먼저 쉬세요.` };
  const head = findEvent(info.next.id);
  const done = csv(c.story_done);
  const resume = done.find(id => id.startsWith(RESUME_PREFIX));
  const resumeEv = resume && findEvent(resume.slice(RESUME_PREFIX.length));
  if (resumeEv) {   // 귀환했던 전투부터 다시 (장 첫 장면은 이미 본 것으로)
    return {
      updates: { pending_event: resumeEv.id, story_done: toCsv([...done.filter(id => id !== resume), head.id]) },
      logs: [
        { label: timeLabel(c), kind: 'system', text: `메인 스토리 「${head.title}」 · 다시 도전` },
        { label: timeLabel(c), kind: 'event', text: fill(resumeEv.text, c) },
      ],
    };
  }
  const ev = head;
  const n = ev.npc ? getData().npcs.get(ev.npc) : null;
  return {
    updates: { pending_event: ev.id },
    logs: [
      { label: timeLabel(c), kind: 'system', text: `메인 스토리 「${ev.title}」${n ? ` · ${n.name}` : ''}` },
      { label: timeLabel(c), kind: 'event', text: fill(ev.text, c) },
    ],
  };
}

// ---------- 계정 영구 보너스 ----------
// 이번 변화로 새로 달성한 보너스 id 목록 (이미 가진 것도 포함될 수 있음 → 저장할 때 중복 무시)
// seen = 이번에 끝까지 본 장면 ID 목록 (resolveChoice 가 돌려줌)
// combat = 이번 전투 성적 { enemy, perfect } (resolveCombat 가 돌려줌)
function reachedAccountBonuses(c, updates, seen = [], combat = null) {
  const age = updates && updates.age !== undefined ? updates.age : c.age;
  return C.ACCOUNT_BONUSES.filter(b => {
    if (b.condition.reachAge) return age >= b.condition.reachAge;
    if (b.condition.reachStat) {
      return Object.entries(b.condition.reachStat).every(([k, need]) => ((updates && updates[k] !== undefined) ? updates[k] : c[k]) >= need);
    }
    if (b.condition.seeEvent) return [].concat(b.condition.seeEvent).some(id => seen.includes(id));
    if (b.condition.combatPerfect) { const k = b.condition.combatPerfect; return !!combat && combat.enemy === k.enemy && combat.perfect >= k.count; }
    if (b.condition.combatNoHit) return !!combat && combat.enemy === b.condition.combatNoHit && combat.noHit;
    if (b.condition.noHitChain) { const k = b.condition.noHitChain; return !!combat && combat.chain === k.chain && combat.noHitCount >= k.count; }
    if (b.condition.combatWin) {
      if (!combat || combat.enemy !== b.condition.combatWin || !combat.win) return false;
      const recs = csv(updates && updates.records !== undefined ? updates.records : c.records);
      return !b.condition.hasTitle || recs.includes(b.condition.hasTitle);
    }
    return false;
  }).map(b => b.id);
}
function accountBonus(id) { return C.ACCOUNT_BONUSES.find(b => b.id === id) || null; }

// 새 캐릭터에 계정 보너스 적용
function applyAccountBonuses(fields, unlockedIds) {
  const notes = [];
  const records = csv(fields.records);
  for (const id of unlockedIds) {
    const b = accountBonus(id);
    if (!b) continue;
    const g = b.grant || {};
    const parts = [];
    if (g.title && !records.includes(g.title)) {
      records.push(g.title); parts.push(`칭호 「${g.title}」`);
      const t = C.TITLES[g.title];
      for (const [k, v] of Object.entries((t && t.effects) || {})) { fields[k] = (fields[k] || 0) + v; parts.push(`${statName(k)} ${signed(v)}`); }
    }
    for (const s of [...C.STATS, ...C.SPECIAL_STATS, ...C.MAGIC_STATS]) {
      if (g[s.key]) { fields[s.key] = (fields[s.key] || 0) + g[s.key]; parts.push(`${s.name} ${signed(g[s.key])}`); }
    }
    if (parts.length) notes.push(`${b.name}: ${parts.join(', ')}`);
  }
  fields.records = toCsv(records);
  return notes;
}

// ---------- 승급 시험 (전투) ----------
// 그 등급의 메인 스토리를 다 끝내면 도전. 도전하면 pending_event 가 'promo:등급' 이 되고 전투 화면이 뜸.
const PROMO_PREFIX = 'promo:';
const isPromoPending = c => String(c.pending_event || '').startsWith(PROMO_PREFIX);

// 화면에 보여 줄 승급 정보. 최고 등급이면 { maxed }
function promotionInfo(c) {
  const job = getJob(c);
  if (!job || !job.promotions) return null;
  const promo = job.promotions[c.rank_level];
  if (!promo) return { maxed: true, rank: rankName(c) };
  const enemy = C.COMBAT.enemies[promo.enemy];
  const story = storyInfo(c);
  // 이 등급의 승급을 여는 메인 스토리 (STORY.rankGates) · 없으면 아직 다음 이야기가 없어서 대기
  const gate = (C.STORY.rankGates || [])[c.rank_level];
  const waiting = C.STORY.rankGates ? !gate : false;
  const storyDone = !!(story && story.allDone) && !waiting && (!gate || csv(c.story_done).includes(gate));
  const tired = c.fatigue >= C.FATIGUE.questLimit;
  return {
    maxed: false, waiting, from: rankName(c), to: job.ranks[c.rank_level + 1], text: promo.text,
    enemy: enemy ? enemy.name : promo.enemy, storyDone, tired, canTry: storyDone && !tired && !!enemy,
    // 시험 방식 안내용: 적 없이 버티기(마탑) / 마나로 피해 감소
    survive: !!(enemy && enemy.art === 'none'), manaShield: !!(enemy && enemy.manaShield),
  };
}

function tryPromotion(c) {
  if (c.phase !== 'adult') return { error: '아직 성인이 아닙니다.' };
  if (c.pending_event) return { error: '먼저 지금 일어난 일에 답해 주세요.' };
  const info = promotionInfo(c);
  if (!info || info.maxed) return { error: '이미 최고 등급이에요.' };
  if (info.waiting) return { error: '다음 메인 스토리가 열리면 승급 시험을 볼 수 있어요.' };
  if (!info.storyDone) return { error: '이 등급의 메인 스토리를 모두 마쳐야 승급 시험을 볼 수 있어요.' };
  if (info.tired) return { error: `피로도가 ${C.FATIGUE.questLimit} 이상이라 시험을 볼 수 없어요. 먼저 쉬세요.` };
  if (!info.canTry) return { error: 'content.js 에 시험 전투 상대가 없어요.' };
  return {
    updates: { pending_event: PROMO_PREFIX + c.rank_level },
    logs: [{ label: timeLabel(c), kind: 'system', text: `${info.to} 승급 시험에 나섰다. ${info.text}` }],
  };
}

// 지금 치르는 승급 시험의 적 ID
function promoEnemyId(c) {
  if (!isPromoPending(c)) return null;
  const job = getJob(c);
  const promo = job && job.promotions && job.promotions[Number(c.pending_event.slice(PROMO_PREFIX.length))];
  return promo ? promo.enemy : null;
}

function resolvePromotionCombat(c, plan, offsets, rng = Math.random) {
  const enemyId = promoEnemyId(c);
  if (!enemyId || !plan || plan.enemyId !== enemyId) return { error: '시험 정보가 맞지 않아요. 새로고침해 주세요.' };
  const sim = simulateCombat(plan, Array.isArray(offsets) ? offsets.slice(0, plan.attacks.length) : []);
  const e = C.COMBAT.enemies[enemyId];
  const job = getJob(c);
  const label = timeLabel(c);
  const to = job.ranks[c.rank_level + 1];
  const updates = { pending_event: null, fatigue: clamp(c.fatigue + C.PROMOTION.fatigue, 0, C.FATIGUE.max) };
  const logs = [];
  if (!sim.win && e.lethal !== false) {
    return tryRevive(c, { updates: {}, logs: [{ label, kind: 'event', text: `[실패] 승급 시험 — ${e.name}에게 쓰러져 끝내 돌아오지 못했다. (${combatSummary(sim)})` }], dead: true });
  }
  if (sim.win) {
    updates.rank_level = c.rank_level + 1;
    const how = e.clearLog || `${josa(e.name, '을', '를')} 쓰러뜨렸다`;
    logs.push({ label, kind: 'event', text: `[성공] 승급 시험 — ${how}. 이제 ${job.name}(${to})이다. (${combatSummary(sim)} · 피로도 +${C.PROMOTION.fatigue})` });
  } else {
    const how = e.failLog || `${josa(e.name, '을', '를')} 쓰러뜨리지 못했다`;
    logs.push({ label, kind: 'event', text: `[실패] 승급 시험 — ${how}. 다시 도전할 수 있다. (${combatSummary(sim)} · 피로도 +${C.PROMOTION.fatigue})` });
  }
  passSeason({ ...c, ...updates }, updates, logs, rng); // 계절이 지나며 HP 회복
  return { updates, logs };
}

// 조사: 받침 있으면 a(이·을·은), 없으면 b(가·를·는)
function josa(word, a, b) {
  const w = String(word || ''); const code = w.charCodeAt(w.length - 1) - 0xac00;
  return w + (code >= 0 && code < 11172 && code % 28 ? a : b);
}

// ---------- 1인 격파 (혼자 하는 토벌 전투) ----------
// 도전하면 pending_event 가 'hunt:ID' 가 되고 전투 화면이 뜸. 이기면 보상, 져도 안 죽음. 계절은 지나지 않음.
const HUNT_PREFIX = 'hunt:';
const isHuntPending = c => String(c.pending_event || '').startsWith(HUNT_PREFIX);
const soloHunt = id => C.SOLO.hunts.find(h => h.id === id) || null;

// 등급별 보상 (goldMult = 골드 배수, 능력치는 그대로)
const withGold = (r, q) => (q && q.goldMult ? { ...r, gold: Math.round((r.gold || 0) * q.goldMult) } : r);
// 목록에 보여 줄 골드 = 등급 배수 + 지능 보너스까지 (실제로 받는 값)
const withGoldFor = (c, r, q) => { const w = withGold(r, q); return { ...w, gold: boostGold(c, w.gold || 0) }; };
// 등급이 안 되는 의뢰는 잠금 표시 없이 아예 안 보임 (사용자 지정 2026-11-22: 보스가 늘어나면 잠긴 게 줄줄이 보이는 게 별로) · maxRank 를 넘으면 목록에서 빠짐
const huntShown = (c, h) => c.rank_level >= (h.minRank || 0) && (h.maxRank === undefined || c.rank_level <= h.maxRank);
function soloHunts(c) {
  return C.SOLO.hunts.filter(h => huntShown(c, h)).map(h => {
    const e = C.COMBAT.enemies[h.enemy] || {};
    return { ...h, enemyName: e.name || h.enemy, hp: e.hp, locked: c.rank_level < h.minRank, reward: withGoldFor(c, C.SOLO.reward, h) };
  });
}

function startHunt(c, id) {
  if (c.phase !== 'adult') return { error: '아직 성인이 아닙니다.' };
  if (!adultOpen(c)) return { error: '아직 왕도에 막 도착했어요. 먼저 메인 스토리를 진행하세요.' };
  if (c.pending_event) return { error: '먼저 지금 일어난 일에 답해 주세요.' };
  const h = soloHunt(id);
  if (!h || !C.COMBAT.enemies[h.enemy]) return { error: '없는 토벌이에요.' };
  if (c.rank_level < h.minRank) return { error: '아직 등급이 부족합니다.' };
  if (!huntShown(c, h)) return { error: '이제 이 토벌은 받을 수 없어요.' };
  if (c.fatigue >= C.FATIGUE.questLimit) return { error: `피로도가 ${C.FATIGUE.questLimit} 이상이라 도전할 수 없어요. 먼저 쉬세요.` };
  return {
    updates: { pending_event: HUNT_PREFIX + h.id },
    logs: [{ label: timeLabel(c), kind: 'system', text: `「${h.title}」에 나섰다. ${h.text}` }],
  };
}

function resolveHuntCombat(c, plan, offsets) {
  const h = soloHunt(String(c.pending_event).slice(HUNT_PREFIX.length));
  if (!h || !plan || plan.enemyId !== h.enemy) return { error: '전투 정보가 맞지 않아요. 새로고침해 주세요.' };
  const sim = simulateCombat(plan, Array.isArray(offsets) ? offsets.slice(0, plan.attacks.length) : []);
  const e = C.COMBAT.enemies[h.enemy];
  const label = timeLabel(c);
  const updates = { pending_event: null, fatigue: clamp(c.fatigue + C.SOLO.fatigue, 0, C.FATIGUE.max) };
  if (sim.win) {
    const r = rewardFor(c, withGold(C.SOLO.reward, h));
    applyEffects(c, r.effects, updates);
    updates.gold = c.gold + r.gold;
    updates.solo_count = (c.solo_count || 0) + 1;
    updates.hp = Math.max(1, sim.php);
    return { updates, logs: [{ label, kind: 'event', text: `[성공] ${h.title} — ${josa(e.name, '을', '를')} 홀로 쓰러뜨렸다. (${combatSummary(sim)} · ${r.text} · 피로도 +${C.SOLO.fatigue})` }] };
  }
  updates.hp = Math.max(1, e.loseHp || 1);
  return { updates, logs: [{ label, kind: 'event', text: `[실패] ${h.title} — ${josa(e.name, '을', '를')} 쓰러뜨리지 못하고 물러났다. (${combatSummary(sim)} · 피로도 +${C.SOLO.fatigue})` }] };
}

// ---------- 단련 (몬스터 없이 중앙을 꾹 누르기) ----------
const TRAIN_PREFIX = 'train:';
const isTrainPending = c => String(c.pending_event || '').startsWith(TRAIN_PREFIX);
const trainingOf = id => C.TRAINING.find(t => t.id === id) || null;
const trainingVisible = (c, t) => (!t.job || t.job === c.job) && (!t.needMana || (c.mana || 0) > 0);

function trainings(c) {
  return C.TRAINING.filter(t => trainingVisible(c, t)).map(t => ({ ...t, effectText: describeEffects(t.effects) }));
}
function pendingTraining(c) { return isTrainPending(c) ? trainingOf(String(c.pending_event).slice(TRAIN_PREFIX.length)) : null; }

function startTraining(c, id) {
  if (c.phase !== 'adult') return { error: '아직 성인이 아닙니다.' };
  if (!adultOpen(c)) return { error: '아직 왕도에 막 도착했어요. 먼저 메인 스토리를 진행하세요.' };
  if (c.pending_event) return { error: '먼저 지금 일어난 일에 답해 주세요.' };
  const t = trainingOf(id);
  if (!t || !trainingVisible(c, t)) return { error: '할 수 없는 단련이에요.' };
  if (c.fatigue >= C.FATIGUE.questLimit) return { error: `피로도가 ${C.FATIGUE.questLimit} 이상이라 단련할 수 없어요. 먼저 쉬세요.` };
  return { updates: { pending_event: TRAIN_PREFIX + t.id }, logs: [{ label: timeLabel(c), kind: 'system', text: `「${t.title}」 ${t.text}` }] };
}

// heldMs: 화면에서 누르고 있던 시간 (app.js 가 실제 경과 시간으로 한 번 더 확인)
function resolveTraining(c, heldMs) {
  const t = pendingTraining(c);
  if (!t) return { error: '진행 중인 단련이 없어요.' };
  if (!(Number(heldMs) >= t.holdMs)) return { error: '끝까지 모으지 못했어요. 다시 해 주세요.' };
  const updates = { pending_event: null, fatigue: clamp(c.fatigue + t.fatigue, 0, C.FATIGUE.max) };
  applyEffects(c, t.effects, updates);
  return { updates, logs: [{ label: timeLabel(c), kind: 'event', text: `[성공] ${t.title} — 흩어지려는 마나를 끝까지 붙잡았다. (${describeEffects(t.effects)} · 피로도 +${t.fatigue})` }] };
}

// 승급 시험·1인 격파처럼 CSV 이벤트가 아닌 전투가 진행 중이면 { enemyId, title }
function specialCombat(c) {
  if (isPromoPending(c)) return { enemyId: promoEnemyId(c), title: '승급 시험' };
  if (isHuntPending(c)) {
    const h = soloHunt(String(c.pending_event).slice(HUNT_PREFIX.length));
    if (!h || !C.COMBAT.enemies[h.enemy]) return { enemyId: null, title: '' };
    // 공격 횟수를 적에 정해 뒀으면 그대로, 아니면 적 체력 ÷ 공격력 × 여유
    const { hp, attacks } = C.COMBAT.enemies[h.enemy];
    if (attacks) return { enemyId: h.enemy, title: h.title };
    return { enemyId: h.enemy, title: h.title, opts: { attacks: Math.max(10, Math.ceil(hp / hitPower(c) * C.SOLO.attackSlack)) } };
  }
  return null;
}
function resolveSpecialCombat(c, plan, offsets) {
  if (isPromoPending(c)) return resolvePromotionCombat(c, plan, offsets);
  if (isHuntPending(c)) return resolveHuntCombat(c, plan, offsets);
  return { error: '진행 중인 전투가 없어요.' };
}

const combatSummary = sim => { const k = sim.counts; return `Just Guard ${k.perfect} · Guard ${k.great} · Miss ${k.good} · 피격 ${k.miss}${sim.bleedTotal ? ` · 출혈 피해 ${sim.bleedTotal}` : ''}`; };

// ---------- 협동 의뢰 (규칙만. 방·인원 관리는 lib/coop.js) ----------
const coopQuest = id => C.COOP.quests.find(q => q.id === id) || null;
// 자기 몫 = 전체 체력 ÷ 도전 인원 (올림)
const coopShare = (quest, n) => Math.ceil(quest.totalHp / Math.max(1, n));

function coopQuests(c) {
  return C.COOP.quests.filter(q => huntShown(c, q)).map(q => ({ ...q, locked: c.rank_level < q.minRank, enemyName: (C.COMBAT.enemies[q.enemy] || {}).name || q.enemy, reward: withGoldFor(c, C.COOP.reward, q) }));
}

// 자기 몫 전투 계획: 적 체력 = 몫, 공격 횟수 = 몫 ÷ 공격력 × 여유
function coopPlan(c, quest, share, seed) {
  const atk = hitPower(c);
  const attacks = Math.max(10, Math.ceil(share / atk * C.COOP.attackSlack));
  return combatPlan(c, quest.enemy, seed, { hp: share, attacks });
}

// 보상: 주 능력치 +main, 나머지 +others, 골드
function coopReward(c, spectator, quest) { return rewardFor(c, withGold(spectator ? C.COOP.spectatorReward : C.COOP.reward, quest)); }
function rewardFor(c, r) {
  const job = getJob(c);
  const effects = {};
  for (const key of STAT_KEYS) {
    const n = job && key === job.mainStat ? r.main : r.others;
    if (n) effects[key] = n;
  }
  const gold = boostGold(c, r.gold || 0);
  return { effects, gold, text: [describeEffects(effects), gold ? `골드 +${gold}` : ''].filter(Boolean).join(', ') };
}

// ---------- 상점 ----------
// purchases 저장 형식: "1-0|meal:2,potion:1" (이번 계절 키 | 아이템별 구매 수)
function seasonKey(c) { return `${c.year_no}-${c.season}`; }
function purchasesThisSeason(c) {
  const [key, list] = String(c.purchases || '').split('|');
  if (key !== seasonKey(c)) return {};
  return Object.fromEntries(csv(list).map(p => { const [id, n] = p.split(':'); return [id, Number(n) || 0]; }));
}

function shopItems(c) {
  const bought = purchasesThisSeason(c);
  return getData().items.map(it => ({
    ...it,
    effectText: [describeEffects(it.effects), it.healPct ? `HP ${it.healPct}% 회복` : '', it.fatigue ? `피로도 ${signed(it.fatigue)}` : ''].filter(Boolean).join(', '),
    left: it.limit ? Math.max(0, it.limit - (bought[it.id] || 0)) : null,
    locked: c.rank_level < it.minRank,
  }));
}

function buyItem(c, id) {
  if (c.phase !== 'adult') return { error: '아직 성인이 아닙니다.' };
  if (!adultOpen(c)) return { error: '아직 왕도에 막 도착했어요. 먼저 메인 스토리를 진행하세요.' };
  if (c.pending_event) return { error: '먼저 지금 일어난 일에 답해 주세요.' };
  const item = shopItems(c).find(it => it.id === id);
  if (!item) return { error: '없는 물건이에요.' };
  if (item.locked) return { error: '아직 등급이 부족해 살 수 없어요.' };
  if (item.left === 0) return { error: '이번 계절에는 더 살 수 없어요.' };
  if (c.gold < item.price) return { error: `골드가 부족해요. (${item.price} 필요)` };
  if (item.healPct && !item.fatigue && !Object.keys(item.effects || {}).length && curHp(c) >= maxHp(c)) return { error: '이미 HP가 가득해요.' };

  const updates = { gold: c.gold - item.price };
  applyEffects(c, item.effects, updates);
  let healText = '';
  if (item.healPct) {                                // 체력 회복 (최대 HP의 %)
    const cc = { ...c, ...updates }, mx = maxHp(cc), before = curHp(cc);
    const after = Math.min(mx, before + Math.round(mx * item.healPct / 100));
    updates.hp = after >= mx ? null : after;
    healText = `HP +${after - before}`;
  }
  if (item.fatigue) updates.fatigue = clamp(c.fatigue + item.fatigue, 0, C.FATIGUE.max);

  const bought = purchasesThisSeason(c);
  bought[id] = (bought[id] || 0) + 1;
  updates.purchases = `${seasonKey(c)}|${Object.entries(bought).map(([k, n]) => `${k}:${n}`).join(',')}`;

  return { updates, logs: [{ label: timeLabel(c), kind: 'daily', text: `${item.name}을(를) 샀다. (골드 -${item.price}${item.effectText ? `, ${item.effectText}` : ''}${healText ? ` → ${healText}` : ''})` }] };
}

// ---------- 전투 (패링) ----------
// 공격 패턴은 서버가 시드로 만들어 화면에 보내고, 화면은 공격마다 "얼마나 어긋나게 눌렀는지(ms)"만 돌려줌.
// 판정 등급·데미지·승패는 서버가 다시 계산함.
function seededRng(seed) {
  let s = seed % 2147483647; if (s <= 0) s += 2147483646;
  return () => { s = (s * 16807) % 2147483647; return (s - 1) / 2147483646; };
}

// 전투 화면 크기와 공격이 생길 수 있는 범위 (화면 좌표)
const ARENA = { w: 720, h: 420, xMin: 80, xMax: 640, yMin: 110, yMax: 345, minDist: 170 };

// src: 이벤트(전투 칸) 또는 적 ID. opts.hp / opts.attacks 로 체력·공격 횟수를 바꿀 수 있음 (협동 의뢰)
// 공격 횟수 제한 없는 적인지 (죽거나 죽이거나)
const isEndless = e => !!C.COMBAT.endless && e.endless !== false && !e.immune && !e.rescue && !e.hideHp && e.art !== 'none';

function combatPlan(c, src, seed, opts = {}) {
  const enemyId = typeof src === 'string' ? src : src.combat;
  const base = C.COMBAT.enemies[enemyId];
  if (!base) return null;
  const e = { ...base, ...(opts.hp ? { hp: opts.hp } : {}), ...(opts.attacks ? { attacks: opts.attacks } : {}) };
  const r = seededRng(seed);
  const attacks = [];
  // 죽거나 죽이거나: 쓰러뜨릴 수 있는 적은 공격 횟수를 사실상 무제한으로
  const endless = isEndless(e);
  const count = endless ? Math.max(e.attacks || 0, C.COMBAT.endlessAttacks || 600) : e.attacks;
  let t = 1500; // 시작 후 첫 공격까지 여유
  if (e.mageWaves) {
    // 흑마법사: 느린 공격 2~3번 → 가운데 원 위에 1·2·4·8개 차례로 → 반복 (C.COMBAT.mageWaves)
    const M = C.COMBAT.mageWaves;
    t = Math.max(t, M.slowAp + 300);
    while (attacks.length < count) {
      const slowN = M.slow[0] + Math.floor(r() * (M.slow[1] - M.slow[0] + 1));
      for (let k = 0; k < slowN && attacks.length < count; k++) {
        let x = 0, y = 0;
        for (let tries = 0; tries < 30; tries++) {
          x = Math.round(ARENA.xMin + r() * (ARENA.xMax - ARENA.xMin));
          y = Math.round(ARENA.yMin + r() * (ARENA.yMax - ARENA.yMin));
          if (attacks.slice(-2).every(a => Math.hypot(a.x - x, a.y - y) >= ARENA.minDist)) break;
        }
        attacks.push({ x, y, hit: t, ap: M.slowAp });     // ap = 이 공격만 고리가 줄어드는 시간 (느린 공격)
        t += k < slowN - 1 ? M.slowGap[0] + Math.floor(r() * (M.slowGap[1] - M.slowGap[0])) : M.toWaves;
      }
      const start = r() * Math.PI * 2;                     // 원을 그리기 시작하는 방향은 매번 다르게
      M.waves.forEach((n, wi) => {
        for (let k = 0; k < n && attacks.length < count; k++) {
          const ang = start + (k / n) * Math.PI * 2;       // 시계 방향으로 차례차례
          attacks.push({ x: Math.round(M.cx + Math.cos(ang) * M.r), y: Math.round(M.cy + Math.sin(ang) * M.r), hit: t });
          if (k < n - 1) t += M.inGap;
        }
        t += wi < M.waves.length - 1 ? M.waveGap : M.toSlow;
      });
    }
    attacks.length = Math.min(attacks.length, count);
  }
  // 공격 사이 간격: 패턴이 있으면 단계별(예: 평범한 공격 5번 → 20연타), 없으면 gapMin~gapMax
  const phases = e.pattern && e.pattern.length ? e.pattern : [{ count: Infinity, gapMin: e.gapMin, gapMax: e.gapMax }];
  let ph = 0, inPhase = 0;
  for (let i = e.mageWaves ? count : 0; i < count; i++) {
    // 화면 아무 곳 — 직전 두 공격과는 일정 거리 이상 떨어지게
    // (단계에 sameSpot 이 있으면 그 개수만큼 같은 자리에 연달아 공격)
    let x = 0, y = 0;
    const cur = phases[ph];
    const stay = cur.sameSpot && inPhase % cur.sameSpot !== 0 && attacks.length;
    if (stay) ({ x, y } = attacks[attacks.length - 1]);
    else for (let tries = 0; tries < 30; tries++) {
      x = Math.round(ARENA.xMin + r() * (ARENA.xMax - ARENA.xMin));
      y = Math.round(ARENA.yMin + r() * (ARENA.yMax - ARENA.yMin));
      if (attacks.slice(-2).every(a => Math.hypot(a.x - x, a.y - y) >= ARENA.minDist)) break;
    }
    attacks.push({ x, y, hit: t });                // hit = 고리가 맞닿는 순간(ms)
    let p = phases[ph];
    if (++inPhase >= p.count) { ph = (ph + 1) % phases.length; inPhase = 0; p = phases[ph]; t += p.pause || 0; }
    t += p.gapMin + Math.floor(r() * (p.gapMax - p.gapMin));
  }
  return {
    seed, enemyId,
    enemy: {
      name: e.name, hp: e.hp, damage: hitDamageFor(c, e), approach: e.approach, image: e.image || null, spriteH: e.spriteH || null, art: e.art || 'wolf',
      guardDamage: guardDamageFor(c, e), rescue: !!e.rescue, rescueName: e.rescueName || '', hideHp: !!e.hideHp,
      endless, counterFixed: e.counterFixed || 0, bleedImmune: !!e.bleedImmune, manaShield: !!e.manaShield, rescueAt: e.rescueAt || 0, finale: e.finale || 0, regenFull: !!e.regenFull, rescueTitle: e.rescueTitle || '', rescueStyle: e.rescueStyle || '', immune: !!e.immune, winText: e.winText || '', mustKill: !!e.mustKill, bg: e.bg || C.COMBAT.background || null,
    },
    player: { hp: curHp(c), maxHp: maxHp(c), atk: attackPower(c), flat: flatDamage(c), style: isMage(c) ? 'magic' : isHunter(c) ? 'hunt' : '', bleed: bleedOf(c), missShield: equipEffect(c, 'missShield') },   // 늑대가죽 로브: 놓친 공격 1회 무시
    windows: C.COMBAT.windows, mult: { ...C.COMBAT.mult, perfect: C.COMBAT.mult.perfect * (1 + equipEffect(c, 'jgBonus')) },   // 마석 파편: Just Guard +10%
    attacks,
  };
}

// 막아도 받는 피해: 적에 따로 적힌 값이 있으면 그것, 없으면 기본 규칙 (Miss 50% · Guard 25% · 민첩 5당 −1)
// manaShield 가 있는 적(마탑의 시험)은 민첩 대신 마나로 줄임: 피격·Miss·Guard 모두 (마나 × manaShield) 만큼 감소
const manaCut = (c, e) => (e.manaShield ? Math.floor((c.mana || 0) * e.manaShield) : 0);
// 못 막았을 때(피격) 피해 · 세실의 브로치(missCut): 완전히 놓친 공격 피해 30% 감소 (사용자 지정 '빗나감' = 아예 놓친 것)
const hitDamageFor = (c, e) => { const d = Math.max(0, e.damage - manaCut(c, e)); const keep = (1 - equipEffect(c, 'missCut')) * (1 - equipEffect(c, 'dmgCut')); return keep < 1 ? Math.round(d * keep) : d; };   // 브로치 −30% · 라운드 쉴드 −20%
function guardDamageFor(c, e) {
  const R = C.COMBAT.guardRule;
  const cut = e.manaShield ? manaCut(c, e) : Math.floor((c.agi || 0) / R.agiPer);
  const auto = ratio => Math.max(0, Math.round(e.damage * ratio) - cut);
  const g = e.guardDamage || {};
  const cutAll = v => { const k = equipEffect(c, 'dmgCut'); return k ? Math.round(v * (1 - k)) : v; };   // 라운드 쉴드: 받는 피해 −20%
  return {
    perfect: g.perfect !== undefined ? g.perfect : 0,
    great: cutAll(g.great !== undefined ? g.great : auto(R.great)),
    good: cutAll(g.good !== undefined ? g.good : auto(R.good)),
  };
}

function gradeOf(offset) {
  if (offset === null || offset === undefined || !Number.isFinite(Number(offset))) return 'miss';
  const d = Math.abs(Number(offset)); const w = C.COMBAT.windows;
  return d <= w.perfect ? 'perfect' : d <= w.great ? 'great' : d <= w.good ? 'good' : 'miss';
}

// 판정 목록으로 전투를 처음부터 다시 계산 (화면의 combat.js 와 같은 규칙)
function simulateCombat(plan, offsets) {
  let php = plan.player.hp, ehp = plan.enemy.hp;
  const counts = { perfect: 0, great: 0, good: 0, miss: 0 };
  let used = 0, rescued = false, stacks = 0, bleedTotal = 0, regen = 0, shieldLeft = plan.player.missShield || 0;
  const B = plan.player.bleed;
  for (let i = 0; i < plan.attacks.length; i++) {
    if (php <= 0 || ehp <= 0 || rescued) break;
    // finale: HP가 이 값 아래일 때(또는 마지막 공격) 오는 공격은 막을 수 없음 → 난입
    const fin = plan.enemy.finale || 0;
    if (fin && (php < fin || i === plan.attacks.length - 1)) { counts.miss++; used++; rescued = true; php = Math.max(1, php); break; }
    const g = gradeOf(offsets[i]);
    counts[g]++; used++;
    // 출혈: 적이 공격할 때마다 쌓인 중첩만큼 피해
    if (B && stacks > 0 && !plan.enemy.immune) { const b = Math.round(stacks * B.per); ehp -= b; bleedTotal += b; }
    let dmg = g === 'miss' ? plan.enemy.damage : (plan.enemy.guardDamage[g] || 0);
    if (g === 'miss' && shieldLeft > 0) { shieldLeft--; dmg = 0; }   // 늑대가죽 로브
    if (fin) dmg = Math.min(dmg, Math.max(0, php - 1));
    if (g !== 'miss' && !plan.enemy.immune) ehp -= plan.enemy.counterFixed ? plan.enemy.counterFixed : Math.round(plan.player.atk * plan.mult[g]) + (plan.player.flat || 0); // immune 이면 피해 없음 · counterFixed = 반격 피해 고정
    // 출혈이 가득(최대 중첩)인 상태에서 Just Guard → 출혈 피해가 한 번 더 (사용자 지정)
    if (B && g === 'perfect' && stacks >= B.max && !plan.enemy.immune && !plan.enemy.bleedImmune) { const b = Math.round(stacks * B.per); ehp -= b; bleedTotal += b; }
    if (B && g !== 'miss' && B.add[g]) {
      if (plan.enemy.bleedImmune) { regen++; stacks = 0; }      // 상처가 곧바로 아묾
      else stacks = Math.min(B.max, stacks + B.add[g]);
    }
    if (plan.enemy.regenFull) ehp = plan.enemy.hp;   // 맞는 즉시 재생 (산의 주인)
    // 쓰러지기 직전 난입 (rescueAt 이 있으면 HP가 그 아래로 떨어지려는 순간 · HP는 그대로)
    if (dmg > 0 && plan.enemy.rescue && php - dmg < (plan.enemy.rescueAt || 1)) { rescued = true; if (!plan.enemy.rescueAt) php = 1; break; }
    php -= dmg;
  }
  // 공격을 다 버티면 적이 물러남 (승리)
  // mustKill 이면 적 체력을 0으로 만들어야 승리
  const win = !rescued && php > 0 && (!plan.enemy.mustKill || ehp <= 0);
  return { win, rescued, php: Math.max(0, php), ehp: Math.max(0, ehp), counts, used, bleedTotal, regen };
}

function resolveCombat(c, plan, offsets, rng = Math.random) {
  if (!c.pending_event) return { error: '진행 중인 전투가 없어요.' };
  const event = findEvent(c.pending_event);
  if (!event || !event.combat || !plan || plan.enemyId !== event.combat) return { error: '전투 정보가 맞지 않아요. 새로고침해 주세요.' };
  const list = Array.isArray(offsets) ? offsets.slice(0, plan.attacks.length) : [];
  const sim = simulateCombat(plan, list);
  const e = C.COMBAT.enemies[event.combat];
  const label = timeLabel(c);
  const summary = combatSummary(sim);

  if (!sim.win && !sim.rescued && e.lethal !== false) {
    const res = tryRevive(c, { updates: {}, logs: [{ label, kind: 'event', text: `[실패] ${e.name}에게 쓰러졌다. (${summary})` }], dead: true });
    // 메인 스토리 전투에서 귀환하면: 그 장을 다시 열어 두고, 다음에 '이야기 이어가기'를 누르면 이 전투부터 다시 (사용자 지정: 져도 3번까진 스펙 올려서 다시 오라)
    if (!res.dead) {
      const head = currentChapter(c);
      if (head) {
        res.updates.story_done = toCsv([...csv(c.story_done).filter(id => id !== head && !id.startsWith(RESUME_PREFIX)), RESUME_PREFIX + event.id]);
        res.logs.push({ label, kind: 'system', text: '능력치를 더 올린 뒤에 메인 스토리를 이어가면 이 전투부터 다시 도전할 수 있어요.' });
      }
    }
    return res;
  }
  const endHp = sim.rescued ? Math.max(1, sim.php) : sim.win ? sim.php : Math.max(1, e.loseHp || 1);
  // 승리는 선택지 1번 줄, 패배·난입은 2번 줄
  const r = resolveChoice({ ...c, hp: endHp }, sim.win ? 0 : 1, rng, true);
  if (r.error) return r;
  if (r.updates.hp === undefined || r.updates.hp === null) r.updates.hp = endHp;
  r.updates.hp = Math.max(1, r.updates.hp);
  const who = e.rescueName || '누군가';
  const last = who.charCodeAt(who.length - 1) - 0xac00;
  const ga = last >= 0 && last < 11172 && last % 28 ? '이' : '가'; // 받침 있으면 '이'
  const head = sim.rescued
    ? (e.rescueLog ? `[성공] 전투 — ${e.name} · ${summary} · ${e.rescueLog}` : `[실패] 전투 — ${e.name} · ${summary} · 쓰러지기 직전 ${who}${ga} 막아섰다`)
    : `[${sim.win ? '성공' : '실패'}] 전투 — ${e.name} · ${summary} · HP ${endHp}/${plan.player.maxHp}`;
  r.logs.unshift({ label, kind: 'event', text: head });
  const noHit = sim.win && sim.used > 0 && sim.counts.perfect === sim.used;   // 노히트 클리어 = 전부 Just Guard 로 승리
  r.combat = { enemy: event.combat, perfect: sim.counts.perfect, win: sim.win, noHit };   // 계정 보너스 확인용
  // 노히트 마릿수 칭호: 이 묶음에서 이미 가진 칭호 수 = 지금까지 노히트로 잡은 마릿수 → 이번이 그 다음 마리
  const chain = e.noHitChain && C.NOHIT_CHAINS[e.noHitChain];
  if (chain && noHit) {
    const recs = csv(r.updates.records !== undefined ? r.updates.records : c.records);
    const prev = chain.filter(t => !t.account && recs.includes(t.title)).length;
    const step = chain[prev];
    r.combat.chain = e.noHitChain; r.combat.noHitCount = prev + 1;
    if (step && !step.account) {
      const extras = [];
      grantTitle({ ...c, ...r.updates }, step.title, r.updates, extras);
      if (extras.length) r.logs.splice(1, 0, { label, kind: 'system', text: extras.join(' · ') });
    }
  }
  // 전투 성적으로 얻는 칭호 (예: 막대기로 Just Guard 15번)
  if (e.titleOn && sim.counts.perfect >= e.titleOn.perfect) {
    const extras = [];
    grantTitle({ ...c, ...r.updates }, e.titleOn.title, r.updates, extras);
    if (extras.length) r.logs.splice(1, 0, { label, kind: 'system', text: extras.join(' · ') });
  }
  // 끝까지 버텨 이기면 얻는 칭호 (예: 산의 주인 「안아프게 맞기」)
  if (e.winTitle && sim.win) {
    const extras = [];
    grantTitle({ ...c, ...r.updates }, e.winTitle, r.updates, extras);
    if (extras.length) r.logs.splice(1, 0, { label, kind: 'system', text: extras.join(' · ') });
  }
  // "(승리)/(패배)" 같은 자리표시 선택지 줄은 숨김
  r.logs = r.logs.filter(l => !(l.kind === 'choice' && /^\(.*\)$/.test(l.text.replace(/^\[(성공|실패)\] /, ''))));
  return r;
}

// ---------- 장비 ----------
// characters.equipment = "weapon:ilyich_sword,sub:crossbow" (바꾼 칸만 저장, 비어 있으면 직업 기본 장비)
function parseEquip(s) {
  const out = {};
  String(s || '').split(',').forEach(p => { const [k, v] = p.split(':').map(x => (x || '').trim()); if (k && v) out[k] = v; });
  return out;
}
// 장착한 장비의 효과 값 (여러 개면 더함) · 예: missCut 0.3
function equipEffect(c, key) {
  return equipmentOf(c).reduce((sum, s) => sum + ((s.item && s.item.effects && s.item.effects[key]) || 0), 0);
}
// 남은 귀환 횟수 (장신구 「세실의 브로치」 등)
function reviveLeft(c) {
  if (!equipEffect(c, 'revive')) return 0;
  const v = parseEquip(c.equipment).revive;
  return v === undefined ? equipEffect(c, 'revive') : Math.max(0, Number(v) || 0);
}
// 죽을 결과를 귀환으로 바꿈: 체력 1, 귀환 횟수 −1 (없으면 그대로 죽음)
function tryRevive(c, res) {
  const left = reviveLeft(c);
  if (!res.dead || left <= 0) return res;
  const eq = parseEquip(c.equipment);
  eq.revive = String(left - 1);
  const acc = equipmentOf(c).find(s => s.item && s.item.effects && s.item.effects.revive);
  const logs = [...(res.logs || []).map(l => ({ ...l, text: l.text.replace(/ ?그리고 다시는 돌아오지 못했다\.?| ?끝내 돌아오지 못했다\.?/, '') })),
    { label: timeLabel(c), kind: 'system', text: `${acc ? acc.item.name : '장신구'}가 희미하게 빛났다. 정신을 차려 보니 왕도의 여관 침대 위였다. (체력 1 · 남은 귀환 ${left - 1}회)` }];
  return { ...res, dead: false, logs, updates: { ...(res.updates || {}), hp: 1, pending_event: null, equipment: Object.entries(eq).map(([k, v]) => `${k}:${v}`).join(',') } };
}
function equipmentOf(c) {
  const job = C.JOBS.find(j => j.name === c.job);
  const eq = { ...((job && job.equipment) || {}), ...parseEquip(c.equipment) };
  return C.EQUIP_SLOTS.map(s => ({ ...s, id: eq[s.key] || null, item: (eq[s.key] && C.EQUIPMENT[eq[s.key]]) || null }));
}

// ---------- 장비 칸 아래 성능 한 줄 (지금 캐릭터 기준 숫자) ----------
function equipStatText(c, s) {
  if (!s.item) return '';
  const n = v => Math.round(v * 10) / 10, H = C.COMBAT.hunt, fx = s.item.effects || {}, out = [];
  if (s.key === 'weapon') {
    const lv = weaponLevel(c), parts = [fx.atk ? `무기 +${fx.atk}` : '', lv ? `강화 +${lv * C.SMITHY.upgrade.atk}` : ''].filter(Boolean);
    out.push(`공격력 ${n(attackPower(c))}${parts.length ? ` (${parts.join(' · ')})` : ''}`);
    if (flatDamage(c)) out.push(`마나 고정 피해 +${n(flatDamage(c))}`);
    if (s.id === 'saw_blade') {
      const B = bleedOf(c), w = B.poison ? '독' : '출혈';
      out.push(`막을 때마다 ${w} +${H.stack.great} (중첩당 피해 ${n(B.per)}, 최대 ${B.max}중첩) · ${w}이 가득 찬 상태에서 Just Guard 시 ${w} 피해 한 번 더`);
    }
  }
  out.push(...effectLines(c, fx));
  return out.join(' · ');
}
// 장비 효과 한 줄씩 (플레이 화면 · 대장간 공통)
function effectLines(c, fx) {
  const n = v => Math.round(v * 10) / 10, H = C.COMBAT.hunt, str = c.str || 0, out = [];
  if (fx.maxHp) out.push(`최대 HP +${fx.maxHp}`);
  if (fx.missShield) out.push(`전투마다 놓친 공격 ${fx.missShield}회 피해 무시`);
  if (fx.dmgCut) out.push(`받는 피해 −${Math.round(fx.dmgCut * 100)}%`);
  if (fx.atkFromHp) out.push(`최대 HP의 ${Math.round(fx.atkFromHp * 100)}%만큼 공격력 (지금 +${n(maxHp(c) * fx.atkFromHp)})`);
  if (fx.atkPer10Str) out.push(`힘 10당 공격력 +${fx.atkPer10Str} (지금 +${Math.floor(str / 10) * fx.atkPer10Str})`);
  if (fx.crossbow && isHunter(c)) out.push(`Just Guard 때 ${fx.poison ? '독' : '출혈'} +${H.crossbow}`);
  if (fx.bleedPer) out.push(`출혈 중첩당 피해 +${fx.bleedPer}`);
  if (fx.poison) out.push(`출혈 대신 독 (최대 ${fx.poison}중첩)`);
  if (fx.noManaFlat) out.push('마나 고정 피해 없음');
  if (fx.atkPerStr) out.push(`힘 × ${fx.atkPerStr}만큼 공격력 (지금 +${n(str * fx.atkPerStr)})`);
  if (fx.jgBonus) out.push(`Just Guard 피해 +${Math.round(fx.jgBonus * 100)}%`);
  if (fx.missCut) out.push(`놓친 공격 피해 −${Math.round(fx.missCut * 100)}%`);
  if (fx.revive) out.push('쓰러지면 귀환');
  return out;
}

// ---------- 대장간 ----------
// 무기 강화 (+1당 공격력 +3, 최대 +3) · 방어구/보조 무기 구매 (칸마다 마지막으로 산 것만 장착)
const equipString = eq => Object.entries(eq).map(([k, v]) => `${k}:${v}`).join(',');
function smithyInfo(c) {
  const U = C.SMITHY.upgrade, lv = weaponLevel(c), slots = equipmentOf(c), weapon = slots.find(s => s.key === 'weapon');
  const slotName = k => (C.EQUIP_SLOTS.find(s => s.key === k) || {}).name || k;
  const items = C.SMITHY.items.map(id => ({ id, ...C.EQUIPMENT[id] }))
    .filter(it => it.name && (!it.job || it.job === c.job))
    .map(it => ({ ...it, slotName: slotName(it.slot), equipped: (slots.find(s => s.key === it.slot) || {}).id === it.id, stat: effectLines(c, it.effects || {}).join(' · ') }));
  const groups = [...new Set(items.map(it => it.slot))].map(k => ({ key: k, name: slotName(k), current: (slots.find(s => s.key === k) || {}).item, items: items.filter(it => it.slot === k) }));
  return {
    weapon: { name: weapon && weapon.item ? weapon.item.name : '무기', level: lv, max: U.max, price: U.price, atk: U.atk, maxed: lv >= U.max, power: attackPower(c) },
    groups,
  };
}
function smithCheck(c) {
  if (!smithyOpen(c)) return '아직 대장간을 모릅니다. 메인 스토리를 진행하세요.';
  if (c.pending_event) return '먼저 지금 일어난 일에 답해 주세요.';
  if (specialCombat(c) || isTrainPending(c)) return '전투 중이에요.';
  return null;
}
function smithUpgrade(c) {
  const err = smithCheck(c); if (err) return { error: err };
  const U = C.SMITHY.upgrade, lv = weaponLevel(c);
  if (lv >= U.max) return { error: `이미 최대 강화(+${U.max})예요.` };
  if (c.gold < U.price) return { error: `골드가 부족해요. (${U.price} 필요)` };
  const eq = parseEquip(c.equipment); eq.wlv = String(lv + 1);
  const w = equipmentOf(c).find(s => s.key === 'weapon');
  return { updates: { gold: c.gold - U.price, equipment: equipString(eq) },
    logs: [{ label: timeLabel(c), kind: 'daily', text: `대장간에서 ${josa(w && w.item ? w.item.name : '무기', '을', '를')} 벼렸다. +${lv + 1}강 (골드 -${U.price}, 공격력 +${U.atk})` }] };
}
function smithBuy(c, id) {
  const err = smithCheck(c); if (err) return { error: err };
  const item = C.SMITHY.items.includes(id) && C.EQUIPMENT[id];
  if (!item) return { error: '없는 물건이에요.' };
  if (item.job && item.job !== c.job) return { error: `${item.job} 전용이에요.` };
  const eq = parseEquip(c.equipment);
  if (equipmentOf(c).some(s => s.key === item.slot && s.id === id)) return { error: '이미 장착하고 있어요.' };
  if (c.gold < item.price) return { error: `골드가 부족해요. (${item.price} 필요)` };
  eq[item.slot] = id;
  return { updates: { gold: c.gold - item.price, equipment: equipString(eq) },
    logs: [{ label: timeLabel(c), kind: 'daily', text: `대장간에서 ${josa(item.name, '을', '를')} 사서 장착했다. (골드 -${item.price})` }] };
}

// ---------- 능력치 설명 (플레이 화면 · 각 능력치가 지금 무엇을 얼마나 올려 주는지) ----------
function statEffects(c) {
  const K = C.COMBAT, n = v => Math.round(v * 10) / 10, mage = isMage(c), hunter = isHunter(c);
  const agiCut = Math.floor((c.agi || 0) / K.guardRule.agiPer);
  return {
    str: [!mage && !hunter ? `공격력 +${n((c.str || 0) * K.atkPerStr)}` : '', `최대 HP +${(c.str || 0) * K.hpPerStr}`].filter(Boolean).join(' · '),
    intel: mage ? `마법 공격력 +${n((c.intel || 0) * K.magic.atkPerInt)}` : '지능 판정에 쓰임',
    agi: [hunter ? `공격력 +${n((c.agi || 0) * K.hunt.atkPerAgi)}` : '', `막았을 때 받는 피해 −${agiCut}`].filter(Boolean).join(' · '),
    cha: '사교성 판정에 쓰임',
    mana: `마법 고정 피해 +${n((c.mana || 0) * K.magic.manaFlat)} · 마탑 시험 피해 −${n((c.mana || 0) * 0.5)}`,
  };
}

module.exports = {
  statEffects, equipStatText,
  equipmentOf, parseEquip, equipEffect, reviveLeft, tryRevive, adultOpen,
  smithyOpen, smithyInfo, smithUpgrade, smithBuy, weaponLevel, vnFor,
  C, statName, isHunter, describeEffects, fill, maxHp, curHp, attackPower, isMage, flatDamage,
  combatPlan, resolveCombat, simulateCombat, gradeOf, timeLabel, rankName, findEvent, csv, coopUnlocked, getData,
  buildNewCharacter, growthNextYear, resolveChoice, choiceViews, applyBonus,
  recommendJobs, chooseJob, rest, shopItems, buyItem,
  soloHunts, startHunt, specialCombat, resolveSpecialCombat,
  trainings, pendingTraining, startTraining, resolveTraining,
  promotionInfo, tryPromotion, storyInfo, startStory,
  isPromoPending, promoEnemyId, resolvePromotionCombat, combatSummary, josa,
  coopQuest, coopQuests, coopShare, coopPlan, coopReward,
  reachedAccountBonuses, accountBonus, applyAccountBonuses,
};
