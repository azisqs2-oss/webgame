require('dotenv').config();
const path = require('path');
const express = require('express');
const session = require('express-session');
const bcrypt = require('bcryptjs');
const db = require('./db');
const game = require('./lib/game');
const board = require('./lib/board');
const coop = require('./lib/coop');

const app = express();
const MAX_SLOTS = 3;
const PROD = process.env.NODE_ENV === 'production';

// 배포 환경에서 세션 암호 키가 없으면 켜지 않음 (기본값 'dev-secret' 은 누구나 아는 값이라 위험)
if (PROD && !process.env.SESSION_SECRET) {
  console.error('[보안] .env 에 SESSION_SECRET 이 없어요. 긴 무작위 문자열을 넣고 다시 켜 주세요.');
  process.exit(1);
}

// ---------- 보안 기본 설정 ----------
app.disable('x-powered-by');                 // "Express 로 만든 서버" 라는 정보를 숨김
app.set('trust proxy', 1);                    // nginx 뒤에 있으므로 접속자 실제 IP 를 nginx 가 알려 준 값으로 사용
app.use((req, res, next) => {
  res.set({
    'X-Content-Type-Options': 'nosniff',      // 파일 종류 위장 공격 방지
    'X-Frame-Options': 'DENY',                // 다른 사이트가 이 화면을 몰래 틀(iframe)에 넣는 것 방지
    'Referrer-Policy': 'same-origin',
  });
  next();
});

app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, 'views'));
app.use(express.static(path.join(__dirname, 'public')));
app.use(express.urlencoded({ extended: true, limit: '100kb' })); // 한글 게시글 5000자 ≈ 45kb (퍼센트 인코딩)
app.use(session({
  name: 'chronicle.sid',
  secret: process.env.SESSION_SECRET || 'dev-secret',
  resave: false,
  saveUninitialized: false,
  // httpOnly: 스크립트로 쿠키를 못 읽게 · sameSite lax: 다른 사이트에서 몰래 보낸 요청(CSRF)에는 로그인 쿠키가 안 붙음
  // secure 'auto': https 로 접속했을 때만 쿠키에 secure 표시 (nginx 가 알려 주는 X-Forwarded-Proto 기준 · localhost http 에서도 그대로 동작)
  cookie: { maxAge: 1000 * 60 * 60 * 24 * 7, httpOnly: true, sameSite: 'lax', secure: 'auto' },
}));

// ---------- 로그인·가입 시도 제한 (같은 IP 기준, 메모리에 기록) ----------
//   로그인 실패 10번 / 10분 → 10분 동안 로그인 막힘 · 가입 5번 / 1시간
const attempts = new Map();
function tooMany(kind, ip, max, windowMs) {
  const key = `${kind}:${ip}`, now = Date.now();
  const a = attempts.get(key);
  if (!a || now - a.start > windowMs) return false;
  return a.count >= max;
}
function countAttempt(kind, ip, windowMs) {
  const key = `${kind}:${ip}`, now = Date.now();
  const a = attempts.get(key);
  if (!a || now - a.start > windowMs) attempts.set(key, { start: now, count: 1 });
  else a.count += 1;
}
setInterval(() => { const now = Date.now(); for (const [k, a] of attempts) if (now - a.start > 60 * 60 * 1000) attempts.delete(k); }, 10 * 60 * 1000).unref();
const LOGIN_LIMIT = { max: 10, ms: 10 * 60 * 1000 }, SIGNUP_LIMIT = { max: 5, ms: 60 * 60 * 1000 };

// 로그인하면 세션 번호를 새로 발급 (남이 미리 심어 둔 세션을 이어받는 공격 방지)
const regenerate = req => new Promise((ok, fail) => req.session.regenerate(e => (e ? fail(e) : ok())));

// 모든 화면에서 쓸 값
app.use((req, res, next) => {
  res.locals.user = req.session.user || null;
  res.locals.devMode = !PROD; // 개발(PC)에서만 '데이터 확인' 메뉴 표시
  res.locals.isTester = !!(req.session.user && req.session.user.loginId === 'test1');   // 테스트 페이지 메뉴 (아래 TEST_LOGIN)
  res.locals.flash = req.session.flash || null;
  res.locals.smithyChar = req.session.smithyChar || null;   // 마지막으로 플레이한 캐릭터가 대장간을 알면 위쪽 메뉴에 '대장간'
  delete req.session.flash;
  next();
});

const flash = (req, msg) => { req.session.flash = msg; };

function requireLogin(req, res, next) {
  if (!req.session.user) return res.redirect('/login');
  next();
}

// 내 캐릭터인지 확인하고 불러오기
async function loadMyCharacter(req, res, next) {
  try {
    const [rows] = await db.query('SELECT * FROM characters WHERE id = ? AND user_id = ?', [req.params.id, req.session.user.id]);
    if (!rows.length) { flash(req, '캐릭터를 찾을 수 없어요.'); return res.redirect('/slots'); }
    req.character = rows[0];
    // 만난 NPC와 호감도 (호감도 분기·화면 표시용)
    const [npcs] = await db.query('SELECT npc_id, affinity FROM character_npcs WHERE character_id = ?', [rows[0].id]);
    req.character.npcAff = Object.fromEntries(npcs.map(n => [n.npc_id, n.affinity]));
    next();
  } catch (err) { next(err); }
}

// 타이핑 연출용: 캐릭터별로 마지막으로 본 로그 번호
function markSeen(req, charId, logId) {
  req.session.seenLog = { ...(req.session.seenLog || {}), [charId]: logId };
}

// 판정 결과(updates, logs)를 DB에 저장
async function saveResult(character, result) {
  if (result.dead) {
    // 사망: 게시글에 (故) 표시를 남기고 캐릭터 삭제 (로그도 함께 지워짐)
    await board.markAuthorGone(character.id, '故');
    await db.query('DELETE FROM characters WHERE id = ?', [character.id]);
    return;
  }
  if (result.updates && Object.keys(result.updates).length) {
    await db.query('UPDATE characters SET ? WHERE id = ?', [result.updates, character.id]);
  }
  // 만난 NPC와 호감도 기록
  for (const n of result.npc || []) {
    await db.query(
      'INSERT INTO character_npcs (character_id, npc_id, affinity) VALUES (?, ?, ?) ON DUPLICATE KEY UPDATE affinity = LEAST(100, GREATEST(0, affinity + VALUES(affinity)))',
      [character.id, n.id, Math.max(0, Math.min(100, n.delta))]);
  }
  // 계정 영구 보너스 해금 확인 (나이가 바뀐 경우)
  const logs = [...(result.logs || [])];
  // (나이·능력치가 바뀌었거나 장면을 끝까지 봤을 때 확인)
  if (character.user_id && (result.updates || (result.seen && result.seen.length))) {
    for (const id of game.reachedAccountBonuses(character, result.updates, result.seen || [], result.combat || null)) {
      const [r] = await db.query('INSERT IGNORE INTO account_unlocks (user_id, unlock_id, character_name) VALUES (?, ?, ?)',
        [character.user_id, id, character.name]);
      if (r.affectedRows) {
        const b = game.accountBonus(id);
        logs.push({ label: logs.length ? logs[logs.length - 1].label : game.timeLabel(character), kind: 'system',
          text: `계정 보너스 「${b.name}」 해금! 이제 이 계정에서 만드는 새 캐릭터는 이 혜택을 갖고 태어난다.` });
      }
    }
  }
  for (const log of logs) {
    await db.query('INSERT INTO logs (character_id, label, kind, text) VALUES (?, ?, ?, ?)',
      [character.id, log.label, log.kind, log.text]);
  }
}

async function accountUnlocks(userId) {
  const [rows] = await db.query('SELECT unlock_id, character_name, unlocked_at FROM account_unlocks WHERE user_id = ?', [userId]);
  return rows;
}

// ---------- 계정 ----------
app.get('/', (req, res) => res.redirect(req.session.user ? '/slots' : '/login'));

app.get('/login', (req, res) => res.render('login', { mode: 'login' }));
app.get('/signup', (req, res) => res.render('login', { mode: 'signup' }));

app.post('/signup', async (req, res, next) => {
  try {
    if (tooMany('signup', req.ip, SIGNUP_LIMIT.max, SIGNUP_LIMIT.ms)) { flash(req, '가입 시도가 너무 많아요. 잠시 뒤에 다시 해 주세요.'); return res.redirect('/signup'); }
    const loginId = String(req.body.login_id || '').trim();
    const password = String(req.body.password || '');
    if (!/^[a-zA-Z0-9_]{4,20}$/.test(loginId)) { flash(req, '아이디는 영문·숫자 4~20자로 정해 주세요.'); return res.redirect('/signup'); }
    if (password.length < 4) { flash(req, '비밀번호는 4자 이상이어야 해요.'); return res.redirect('/signup'); }
    const [exists] = await db.query('SELECT id FROM users WHERE login_id = ?', [loginId]);
    if (exists.length) { flash(req, '이미 있는 아이디예요.'); return res.redirect('/signup'); }
    const hash = await bcrypt.hash(password, 10);
    const [r] = await db.query('INSERT INTO users (login_id, password_hash) VALUES (?, ?)', [loginId, hash]);
    countAttempt('signup', req.ip, SIGNUP_LIMIT.ms);
    await regenerate(req);
    req.session.user = { id: r.insertId, loginId };
    res.redirect('/slots');
  } catch (err) { next(err); }
});

app.post('/login', async (req, res, next) => {
  try {
    if (tooMany('login', req.ip, LOGIN_LIMIT.max, LOGIN_LIMIT.ms)) { flash(req, '로그인 실패가 너무 많아요. 10분 뒤에 다시 시도해 주세요.'); return res.redirect('/login'); }
    const [rows] = await db.query('SELECT * FROM users WHERE login_id = ?', [String(req.body.login_id || '').trim()]);
    const u = rows[0];
    if (!u || !(await bcrypt.compare(String(req.body.password || ''), u.password_hash))) {
      countAttempt('login', req.ip, LOGIN_LIMIT.ms);
      flash(req, '아이디 또는 비밀번호가 맞지 않아요.');
      return res.redirect('/login');
    }
    attempts.delete(`login:${req.ip}`);
    await regenerate(req);
    req.session.user = { id: u.id, loginId: u.login_id };
    res.redirect('/slots');
  } catch (err) { next(err); }
});

app.post('/logout', (req, res) => req.session.destroy(() => res.redirect('/login')));

// ---------- 슬롯 ----------
app.get('/slots', requireLogin, async (req, res, next) => {
  try {
    const [rows] = await db.query('SELECT * FROM characters WHERE user_id = ? ORDER BY slot_no', [req.session.user.id]);
    const slots = [];
    for (let i = 1; i <= MAX_SLOTS; i++) slots.push(rows.find(c => c.slot_no === i) || null);
    const unlocks = await accountUnlocks(req.session.user.id);
    res.render('slots', { slots, game, C: game.C, unlocks });
  } catch (err) { next(err); }
});

app.get('/characters/new', requireLogin, async (req, res, next) => {
  try {
    const slot = Number(req.query.slot);
    if (!(slot >= 1 && slot <= MAX_SLOTS)) return res.redirect('/slots');
    const unlocks = (await accountUnlocks(req.session.user.id)).map(u => game.accountBonus(u.unlock_id)).filter(Boolean);
    res.render('new_character', { slot, C: game.C, unlocks });
  } catch (err) { next(err); }
});

app.post('/characters', requireLogin, async (req, res, next) => {
  try {
    const slot = Number(req.body.slot);
    if (!(slot >= 1 && slot <= MAX_SLOTS)) return res.redirect('/slots');
    const built = game.buildNewCharacter(req.body);
    if (built.errors.length) { flash(req, built.errors[0]); return res.redirect(`/characters/new?slot=${slot}`); }

    const [used] = await db.query('SELECT id FROM characters WHERE user_id = ? AND slot_no = ?', [req.session.user.id, slot]);
    if (used.length) { flash(req, '이미 사용 중인 슬롯이에요.'); return res.redirect('/slots'); }
    const [dup] = await db.query('SELECT id FROM characters WHERE name = ?', [built.fields.name]);
    if (dup.length) { flash(req, '이미 누군가 쓰고 있는 이름이에요.'); return res.redirect(`/characters/new?slot=${slot}`); }

    // 계정 영구 보너스 적용
    const unlockIds = (await accountUnlocks(req.session.user.id)).map(u => u.unlock_id);
    const notes = game.applyAccountBonuses(built.fields, unlockIds);
    const logs = [built.firstLog];
    if (notes.length) logs.push({ label: built.firstLog.label, kind: 'system', text: `계정 보너스를 받고 태어났다. (${notes.join(' / ')})` });

    const [r] = await db.query('INSERT INTO characters SET ?', [{ ...built.fields, user_id: req.session.user.id, slot_no: slot }]);
    await saveResult({ id: r.insertId }, { logs });
    markSeen(req, r.insertId, 0); // 첫 줄부터 타이핑되도록
    res.redirect(`/play/${r.insertId}`);
  } catch (err) { next(err); }
});

app.post('/characters/:id/delete', requireLogin, loadMyCharacter, async (req, res, next) => {
  try {
    if (String(req.body.confirm_name || '').trim() !== req.character.name) {
      flash(req, '이름이 일치하지 않아 삭제하지 않았어요.');
      return res.redirect('/slots');
    }
    await board.markAuthorGone(req.character.id, '떠남');
    await db.query('DELETE FROM characters WHERE id = ?', [req.character.id]);
    if (req.session.activeChar === req.character.id) delete req.session.activeChar;
    flash(req, `${req.character.name}을(를) 삭제했어요.`);
    res.redirect('/slots');
  } catch (err) { next(err); }
});

// ---------- 플레이 ----------
app.get('/play/:id', requireLogin, loadMyCharacter, async (req, res, next) => {
  try {
    const c = req.character;
    await coop.leaveOtherCharsRooms(c.user_id, c.id);   // 다른 캐릭터가 모집 중이던 협동 방은 정리
    const [logs] = await db.query(
      'SELECT * FROM (SELECT * FROM logs WHERE character_id = ? ORDER BY id DESC LIMIT 80) t ORDER BY id ASC', [c.id]);
    const event = c.pending_event ? game.findEvent(c.pending_event) : null;

    // 단련 중이면 시작 시각을 세션에 기억 (너무 빨리 끝난 결과는 받지 않음)
    const training = game.pendingTraining(c);
    if (training) {
      const key = c.pending_event;
      if (!req.session.training || req.session.training.charId !== c.id || req.session.training.key !== key) req.session.training = { charId: c.id, key, shownAt: Date.now() };
    }

    // 협동 의뢰 방 (성인만)
    const coopRoom = c.phase === 'adult' ? await coop.roomOf(c.id) : null;
    const coopOpen = c.phase === 'adult' && !coopRoom ? await coop.openRooms() : [];

    // 전투 장면이면 공격 패턴을 만들어 세션에 기억 (새로고침해도 같은 패턴)
    //   key: 스토리 전투 = 이벤트 ID, 승급 시험 = 'promo:등급', 협동 의뢰 = 'coop:방:라운드'
    let combat = null, combatAction = null;
    const useSeed = key => {
      let s = req.session.combat;
      if (!s || s.charId !== c.id || s.key !== key) s = { charId: c.id, key, seed: 1 + Math.floor(Math.random() * 2147483000) };
      s.shownAt = Date.now();
      req.session.combat = s;
      return s.seed;
    };
    if (event && event.combat) {
      combat = game.combatPlan(c, event, useSeed(event.id));
      combatAction = `/play/${c.id}/combat`;
    } else if (game.specialCombat(c)) {
      // 승급 시험 · 1인 격파
      const sp = game.specialCombat(c);
      combat = sp.enemyId ? game.combatPlan(c, sp.enemyId, useSeed(c.pending_event), sp.opts) : null;
      combatAction = `/play/${c.id}/combat`;
      if (combat) combat.title = sp.title;
    } else if (!c.pending_event && req.query.fight === 'coop' && coopRoom && coopRoom.myTurn) {
      combat = game.coopPlan(c, coopRoom.quest, coopRoom.share, useSeed(`coop:${coopRoom.id}:${coopRoom.round}`));
      combatAction = `/play/${c.id}/coop/combat`;
      combat.title = `협동 의뢰 · 내 몫 ${coopRoom.share}`;
    }

    // 지난번에 본 마지막 로그 이후의 줄만 "새 줄"로 표시 → 화면에서 타이핑 연출
    const lastId = logs.length ? logs[logs.length - 1].id : 0;
    const seen = req.session.seenLog || {};
    const seenId = seen[c.id] === undefined ? lastId : seen[c.id];
    markSeen(req, c.id, lastId);
    req.session.activeChar = c.id; // 게시판에서 쓸 캐릭터
    req.session.smithyChar = game.smithyOpen(c) ? c.id : null;
    res.locals.smithyChar = req.session.smithyChar;

    // 능력치 성장 표시: 지난번 화면 이후 오른(내린) 만큼 (+2 처럼)
    const statKeys = [...game.C.STATS, ...game.C.MAGIC_STATS].map(s => s.key);
    const snaps = req.session.statSnap || {};
    const statDelta = {};
    if (snaps[c.id]) statKeys.forEach(k => { const d = (c[k] || 0) - (snaps[c.id][k] || 0); if (d) statDelta[k] = d; });
    req.session.statSnap = { ...snaps, [c.id]: Object.fromEntries(statKeys.map(k => [k, c[k] || 0])) };

    res.render('play', {
      c, logs, seenId, game, C: game.C, statDelta,
      event,
      choices: event ? game.choiceViews(c, event) : [],
      hunts: c.phase === 'adult' ? game.soloHunts(c) : [],
      trainings: c.phase === 'adult' ? game.trainings(c) : [],
      training,
      items: c.phase === 'adult' ? game.shopItems(c) : [],
      promo: c.phase === 'adult' ? game.promotionInfo(c) : null,
      combat, combatAction, coopRoom, coopOpen,
      coopQuests: c.phase === 'adult' ? game.coopQuests(c) : [],
      story: game.storyInfo(c),
      npc: event && event.npc ? game.getData().npcs.get(event.npc) || { name: event.npc } : null,
      metNpcs: Object.entries(c.npcAff || {}).map(([id, aff]) => ({ id, aff, ...(game.getData().npcs.get(id) || { name: id }) })),
      recommended: c.phase === 'job' ? game.recommendJobs(c) : [],
    });
  } catch (err) { next(err); }
});

// 판정 → 저장 → 다시 플레이 화면으로
function playAction(handler) {
  return async (req, res, next) => {
    try {
      const result = handler(req.character, req.body);
      if (result.error) { flash(req, result.error); return res.redirect(`/play/${req.character.id}`); }
      await saveResult(req.character, result);
      if (result.dead) {
        req.session.lastDeath = { name: req.character.name, text: result.logs.map(l => l.text).join(' ') };
        return res.redirect('/dead');
      }
      res.redirect(`/play/${req.character.id}`);
    } catch (err) { next(err); }
  };
}

app.post('/play/:id/next-year', requireLogin, loadMyCharacter, playAction(c => game.growthNextYear(c)));
app.post('/play/:id/choice', requireLogin, loadMyCharacter, playAction((c, body) => game.resolveChoice(c, body.choice)));
app.post('/play/:id/bonus', requireLogin, loadMyCharacter, playAction((c, body) => game.applyBonus(c, body)));
app.post('/play/:id/job', requireLogin, loadMyCharacter, playAction((c, body) => game.chooseJob(c, body.job)));
app.post('/play/:id/train', requireLogin, loadMyCharacter, playAction((c, body) => game.startTraining(c, body.training)));
app.post('/play/:id/train/done', requireLogin, loadMyCharacter, async (req, res, next) => {
  try {
    const c = req.character;
    const t = game.pendingTraining(c);
    const s = req.session.training;
    if (!t || !s || s.charId !== c.id || s.key !== c.pending_event) { flash(req, '단련 정보가 맞지 않아요. 다시 해 주세요.'); return res.redirect(`/play/${c.id}`); }
    if (Date.now() - s.shownAt < t.holdMs * 0.9) { flash(req, '너무 빨리 끝났어요. 다시 해 주세요.'); return res.redirect(`/play/${c.id}`); }
    const result = game.resolveTraining(c, Number(req.body.held));
    if (result.error) { flash(req, result.error); return res.redirect(`/play/${c.id}`); }
    delete req.session.training;
    await saveResult(c, result);
    res.redirect(`/play/${c.id}`);
  } catch (err) { next(err); }
});
app.post('/play/:id/hunt', requireLogin, loadMyCharacter, playAction((c, body) => game.startHunt(c, body.hunt)));
// 전투 결과: 화면은 공격마다 어긋난 시간(ms)만 보내고, 등급·데미지·승패는 서버가 다시 계산
app.post('/play/:id/combat', requireLogin, loadMyCharacter, async (req, res, next) => {
  try {
    const c = req.character;
    const s = req.session.combat;
    const special = game.specialCombat(c); // 승급 시험 · 1인 격파
    const event = c.pending_event && !special ? game.findEvent(c.pending_event) : null;
    if (!s || !(event || (special && special.enemyId)) || s.charId !== c.id || s.key !== c.pending_event) { flash(req, '전투 정보가 맞지 않아요. 다시 시도해 주세요.'); return res.redirect(`/play/${c.id}`); }
    let offsets = [];
    try { offsets = JSON.parse(String(req.body.offsets || '[]')); } catch { offsets = []; }
    const plan = special ? game.combatPlan(c, special.enemyId, s.seed, special.opts) : game.combatPlan(c, event, s.seed);
    // 너무 빨리 끝난 결과는 받지 않음 (자동 입력 방지): 마지막으로 판정된 공격 시각만큼은 지나야 함
    const sim = game.simulateCombat(plan, offsets);
    const lastHit = sim.used ? plan.attacks[sim.used - 1].hit : 0;
    if (Date.now() - (s.shownAt || 0) < lastHit * 0.9) { flash(req, '전투 결과가 너무 빨리 도착했어요. 다시 싸워 주세요.'); return res.redirect(`/play/${c.id}`); }
    const result = special ? game.resolveSpecialCombat(c, plan, offsets) : game.resolveCombat(c, plan, offsets);
    if (result.error) { flash(req, result.error); return res.redirect(`/play/${c.id}`); }
    delete req.session.combat;
    await saveResult(c, result);
    if (result.dead) {
      req.session.lastDeath = { name: c.name, text: result.logs.map(l => l.text).join(' ') };
      return res.redirect('/dead');
    }
    res.redirect(`/play/${c.id}`);
  } catch (err) { next(err); }
});

// ---------- 협동 의뢰 ----------
function coopAction(handler) {
  return async (req, res, next) => {
    try {
      const r = await handler(req.character, req.body);
      if (r && r.error) flash(req, r.error);
      res.redirect(`/play/${req.character.id}`);
    } catch (err) { next(err); }
  };
}
const COOP_LOCKED = { error: '아직 왕도에 막 도착했어요. 먼저 메인 스토리를 진행하세요.' };
app.post('/play/:id/coop/create', requireLogin, loadMyCharacter, coopAction((c, body) => game.adultOpen(c) ? coop.create(c, body.quest, body.private === '1') : COOP_LOCKED));
app.post('/play/:id/coop/join', requireLogin, loadMyCharacter, coopAction((c, body) => game.adultOpen(c) ? coop.join(c, Number(body.room)) : COOP_LOCKED));
app.post('/play/:id/coop/code', requireLogin, loadMyCharacter, coopAction((c, body) => game.adultOpen(c) ? coop.joinByCode(c, body.code) : COOP_LOCKED));
app.post('/play/:id/coop/leave', requireLogin, loadMyCharacter, coopAction(c => coop.leave(c)));
app.post('/play/:id/coop/start', requireLogin, loadMyCharacter, coopAction(c => coop.start(c)));
app.post('/play/:id/coop/giveup', requireLogin, loadMyCharacter, coopAction(async c => {
  const room = await coop.roomOf(c.id);
  if (!room || !room.myTurn) return { error: '지금은 포기할 전투가 없어요.' };
  return coop.submit(c, room, null, true);
}));
// 자기 몫 전투 결과 (스토리 전투와 같은 방식: 서버가 다시 계산)
app.post('/play/:id/coop/combat', requireLogin, loadMyCharacter, async (req, res, next) => {
  try {
    const c = req.character;
    const s = req.session.combat;
    const room = await coop.roomOf(c.id);
    const key = room ? `coop:${room.id}:${room.round}` : null;
    if (!s || !room || !room.myTurn || s.charId !== c.id || s.key !== key) { flash(req, '전투 정보가 맞지 않아요. 다시 시도해 주세요.'); return res.redirect(`/play/${c.id}`); }
    let offsets = [];
    try { offsets = JSON.parse(String(req.body.offsets || '[]')); } catch { offsets = []; }
    const plan = game.coopPlan(c, room.quest, room.share, s.seed);
    const sim = game.simulateCombat(plan, offsets.slice(0, plan.attacks.length));
    const lastHit = sim.used ? plan.attacks[sim.used - 1].hit : 0;
    if (Date.now() - (s.shownAt || 0) < lastHit * 0.9) { flash(req, '전투 결과가 너무 빨리 도착했어요. 다시 싸워 주세요.'); return res.redirect(`/play/${c.id}?fight=coop`); }
    delete req.session.combat;
    const r = await coop.submit(c, room, sim);
    if (r.error) flash(req, r.error);
    res.redirect(`/play/${c.id}`);
  } catch (err) { next(err); }
});

app.post('/play/:id/story', requireLogin, loadMyCharacter, playAction(c => game.startStory(c)));
app.post('/play/:id/promote', requireLogin, loadMyCharacter, playAction(c => game.tryPromotion(c)));
app.post('/play/:id/rest',requireLogin, loadMyCharacter, playAction(c => game.rest(c)));
app.post('/play/:id/buy', requireLogin, loadMyCharacter, playAction((c, body) => game.buyItem(c, body.item)));

// ---------- 대장간 (왕도 1차 이야기에서 세실의 안내를 받으면 열림) ----------
// 대장장이 대사: 방금 산 결과가 있으면 그에 맞는 대사, 아니면 인사 (content.js SMITHY.lines · 임시 작성)
function smithyLine(kind) {
  const L = (game.C.SMITHY.lines || {})[kind] || (game.C.SMITHY.lines || {}).greet || ['…'];
  return L[Math.floor(Math.random() * L.length)];
}
app.get('/play/:id/smithy', requireLogin, loadMyCharacter, (req, res) => {
  const c = req.character;
  if (!game.smithyOpen(c)) { flash(req, '아직 대장간을 모릅니다. 메인 스토리를 진행하세요.'); return res.redirect(`/play/${c.id}`); }
  req.session.activeChar = c.id;
  req.session.smithyChar = c.id;
  res.locals.smithyChar = c.id;
  const msg = req.session.smithyMsg || null;     // 방금 강화·구매한 결과 (한 번만 보여 줌)
  delete req.session.smithyMsg;
  const locals = { title: '대장간', c, game, info: game.smithyInfo(c), msg, line: smithyLine(msg ? msg.kind : 'greet') };
  // 팝업 (상단 메뉴 '대장간' → public/modal.js 가 ?modal=1 로 불러 화면 위에 띄움)
  if (req.query.modal) return res.render('partials/smithy_panel', { ...locals, back: '' });
  res.render('smithy', locals);
});
// 강화·구매 뒤 돌아갈 곳: 팝업에서 샀으면 원래 보던 페이지 (+ ?smithy=1 → 팝업 다시 열림), 아니면 대장간 페이지
function smithBack(req) {
  const back = String(req.body.back || '');
  if (!back.startsWith('/') || back.startsWith('//') || back.includes('\\')) return `/play/${req.character.id}/smithy`;
  return back + (back.includes('?') ? '&' : '?') + 'smithy=1';
}
function smithAction(kind, handler) {
  return async (req, res, next) => {
    try {
      const c = req.character, result = handler(c, req.body);
      if (result.error) {
        const poor = /골드가 부족/.test(result.error), maxed = /최대 강화/.test(result.error);
        req.session.smithyMsg = { error: true, text: result.error, kind: poor ? 'poor' : maxed ? 'maxed' : 'greet' };
      } else {
        await saveResult(c, result);
        req.session.smithyMsg = { text: result.logs.map(l => l.text).join(' '), kind };
      }
      res.redirect(smithBack(req));
    } catch (err) { next(err); }
  };
}
app.post('/play/:id/smithy/upgrade', requireLogin, loadMyCharacter, smithAction('upgrade', c => game.smithUpgrade(c)));
app.post('/play/:id/smithy/buy', requireLogin, loadMyCharacter, smithAction('buy', (c, body) => game.smithBuy(c, body.item)));

// ---------- 게시판 ----------
// 게시판에서 쓸 "현재 캐릭터": 마지막으로 플레이한 캐릭터, 없으면 첫 슬롯
async function loadActiveCharacter(req, res, next) {
  try {
    const [mine] = await db.query('SELECT * FROM characters WHERE user_id = ? ORDER BY slot_no', [req.session.user.id]);
    req.myCharacters = mine;
    req.activeCharacter = mine.find(c => c.id === req.session.activeChar) || mine[0] || null;
    res.locals.myCharacters = mine;
    res.locals.activeCharacter = req.activeCharacter;
    next();
  } catch (err) { next(err); }
}

// 글쓴이 옆에 붙는 직업·등급 표시
function authorLabel(row) {
  if (row.author_gone) return row.author_gone === '故' ? '사망' : '떠난 캐릭터';
  if (row.author_phase === 'adult' && row.author_job) {
    return `${row.author_job} · ${game.rankName({ job: row.author_job, rank_level: row.author_rank })}`;
  }
  return '성장기';
}
function fmtTime(d) {
  const t = new Date(d), now = new Date();
  const pad = n => String(n).padStart(2, '0');
  const sameDay = t.toDateString() === now.toDateString();
  return sameDay ? `${pad(t.getHours())}:${pad(t.getMinutes())}` : `${t.getMonth() + 1}/${t.getDate()}`;
}
app.use((req, res, next) => { res.locals.authorLabel = authorLabel; res.locals.fmtTime = fmtTime; res.locals.BOARDS = board.BOARDS; next(); });

app.get('/board', requireLogin, loadActiveCharacter, async (req, res, next) => {
  try {
    const key = board.boardKey(req.query.b);
    const list = await board.listPosts(key, req.query.page);
    res.render('board_list', { boardKey: key, ...list });
  } catch (err) { next(err); }
});

app.post('/board/active', requireLogin, loadActiveCharacter, (req, res) => {
  const id = Number(req.body.character_id);
  if (req.myCharacters.some(c => c.id === id)) req.session.activeChar = id;
  const back = String(req.body.back || '/board');
  res.redirect(back.startsWith('/board') ? back : '/board');
});

app.get('/board/write', requireLogin, loadActiveCharacter, (req, res) => {
  const key = board.boardKey(req.query.b);
  if (!req.activeCharacter) { flash(req, '글을 쓰려면 먼저 캐릭터를 만들어 주세요.'); return res.redirect(`/board?b=${key}`); }
  res.render('board_write', { boardKey: key });
});

app.post('/board', requireLogin, loadActiveCharacter, async (req, res, next) => {
  try {
    const key = board.boardKey(req.body.board);
    if (!req.activeCharacter) { flash(req, '글을 쓰려면 먼저 캐릭터를 만들어 주세요.'); return res.redirect(`/board?b=${key}`); }
    const r = await board.createPost(key, req.activeCharacter, req.body);
    if (r.error) { flash(req, r.error); return res.redirect(`/board/write?b=${key}`); }
    res.redirect(`/board/${r.id}`);
  } catch (err) { next(err); }
});

app.get('/board/:id', requireLogin, loadActiveCharacter, async (req, res, next) => {
  try {
    const found = await board.getPost(Number(req.params.id));
    if (!found) { flash(req, '없는 글이에요.'); return res.redirect('/board'); }
    res.render('board_post', { ...found, boardKey: found.post.board, me: req.session.user.id });
  } catch (err) { next(err); }
});

app.post('/board/:id/comments', requireLogin, loadActiveCharacter, async (req, res, next) => {
  try {
    const id = Number(req.params.id);
    if (!req.activeCharacter) { flash(req, '댓글을 쓰려면 먼저 캐릭터를 만들어 주세요.'); return res.redirect(`/board/${id}`); }
    const found = await board.getPost(id);
    if (!found) return res.redirect('/board');
    const r = await board.addComment(id, req.activeCharacter, req.body);
    if (r.error) flash(req, r.error);
    res.redirect(`/board/${id}#comments`);
  } catch (err) { next(err); }
});

app.post('/board/:id/delete', requireLogin, async (req, res, next) => {
  try {
    const ok = await board.deletePost(Number(req.params.id), req.session.user.id);
    flash(req, ok ? '글을 지웠어요.' : '내 캐릭터가 쓴 글만 지울 수 있어요.');
    res.redirect(ok ? `/board?b=${board.boardKey(req.body.board)}` : `/board/${req.params.id}`);
  } catch (err) { next(err); }
});

app.post('/comments/:id/delete', requireLogin, async (req, res, next) => {
  try {
    const postId = await board.deleteComment(Number(req.params.id), req.session.user.id);
    if (!postId) { flash(req, '내 캐릭터가 쓴 댓글만 지울 수 있어요.'); return res.redirect('back'); }
    res.redirect(`/board/${postId}#comments`);
  } catch (err) { next(err); }
});

// ---------- 캐릭터 프로필 (닉네임 클릭) ----------
app.get('/profile/:id', requireLogin, loadActiveCharacter, async (req, res, next) => {
  try {
    const [rows] = await db.query('SELECT * FROM characters WHERE id = ?', [req.params.id]);
    if (!rows.length) { flash(req, '이미 세상을 떠났거나 삭제된 캐릭터예요.'); return res.redirect('back'); }
    const c = rows[0];
    const recent = await board.recentPostsBy(c.id);
    res.render('profile', { p: c, recent, game, C: game.C, mine: c.user_id === req.session.user.id });
  } catch (err) { next(err); }
});

// 소개 고치기 (내 캐릭터만 · 최대 200자 · 사용자 요청 2026-11-23)
app.post('/profile/:id/intro', requireLogin, async (req, res, next) => {
  try {
    const [rows] = await db.query('SELECT id, user_id FROM characters WHERE id = ?', [req.params.id]);
    if (!rows.length || rows[0].user_id !== req.session.user.id) { flash(req, '내 캐릭터의 소개만 고칠 수 있어요.'); return res.redirect('back'); }
    const intro = String(req.body.intro || '').replace(/\s+/g, ' ').trim().slice(0, 200);
    await db.query('UPDATE characters SET intro = ? WHERE id = ?', [intro, rows[0].id]);
    flash(req, '소개를 고쳤어요.');
    res.redirect(`/profile/${rows[0].id}`);
  } catch (err) { next(err); }
});

// ============================================================
//  테스트 페이지 (아이디 test1 로그인일 때만 · 다른 사람에게는 없는 페이지처럼 404)
//  전투·연출·장면을 '보기만' 함 — 캐릭터·DB 에는 아무것도 저장하지 않음 (사용자 요청 2026-11-25)
// ============================================================
const TEST_LOGIN = 'test1';
const isTester = req => !!(req.session.user && req.session.user.loginId === TEST_LOGIN);
function testerOnly(req, res, next) { if (!isTester(req)) return next('route'); next(); }
// 미리보기용 가상 캐릭터 (직업·능력치만 고를 수 있음)
function testChar(req) {
  const t = req.session.testChar || {};
  const job = game.C.JOBS.some(j => j.name === t.job) ? t.job : '전사';
  const stat = Math.max(1, Math.min(300, Number(t.stat) || 30));
  return { id: 0, user_id: req.session.user.id, name: t.name || '테스트', gender: '남성', job, phase: 'adult', age: 20, year_no: 1, season: 0,
    rank_level: 2, str: stat, intel: stat, agi: stat, cha: 10, luck: 0, mana: job === '마법사' ? Number(t.mana) || 5 : 0,
    hp: null, hp_bonus: 0, fatigue: 0, gold: 999, equipment: '', records: '', story_done: '', seen_events: '', npcAff: {} };
}
function testScenes() {
  const all = [...game.getData().events.values()];
  const has = re => all.filter(e => re.test(e.text || '')).map(e => ({ id: e.id, title: e.title }));
  const cap = all.filter(e => e.file === 'story.csv' && e.kind === 'rank' && e.minRank <= 1).sort((a, b) => a.order - b.order).slice(0, 3);
  return { sun: has(/\{연출:태양\}/), clash: has(/\{연출:합\}/), vn: has(/\{비주얼노벨:/), chapters: cap.map(e => ({ id: e.id, title: e.title, order: e.order })) };
}
app.get('/test', requireLogin, testerOnly, (req, res) => {
  const enemies = Object.entries(game.C.COMBAT.enemies).map(([id, e]) => ({ id, name: e.name, hp: e.hp, rescue: !!e.rescue, finale: !!e.finale }));
  res.render('test', { enemies, scenes: testScenes(), tc: testChar(req), C: game.C, game });
});
app.post('/test/char', requireLogin, testerOnly, (req, res) => {
  req.session.testChar = { job: String(req.body.job || ''), stat: Number(req.body.stat) || 30, mana: Number(req.body.mana) || 5 };
  res.redirect(String(req.body.back || '/test').startsWith('/test') ? String(req.body.back || '/test') : '/test');
});
// 전투 미리보기: ?rescue=1 이면 HP 1 로 시작 → 첫 공격에 바로 난입(맵 곳곳의 Just Guard 등) 연출
app.get('/test/combat/:enemy', requireLogin, testerOnly, (req, res, next) => {
  const c = testChar(req);
  const seed = Math.floor(Math.random() * 1e9);
  const combat = game.combatPlan(c, req.params.enemy, seed);
  if (!combat) return next('route');
  const rescueNow = req.query.rescue === '1';
  if (rescueNow) combat.player.hp = 1;
  req.session.testCombat = { enemy: req.params.enemy, seed, rescueNow, back: String(req.query.back || '') };
  res.render('test_combat', { combat, tc: c, back: req.session.testCombat.back, rescueNow });
});
app.post('/test/combat/result', requireLogin, testerOnly, (req, res) => {
  const s = req.session.testCombat;
  if (!s) return res.redirect('/test');
  let offsets = [];
  try { offsets = JSON.parse(String(req.body.offsets || '[]')); } catch { offsets = []; }
  const plan = game.combatPlan(testChar(req), s.enemy, s.seed);
  if (s.rescueNow) plan.player.hp = 1;
  const sim = game.simulateCombat(plan, offsets);
  res.render('test_result', { sim, plan, s });
});
app.get('/test/go', requireLogin, testerOnly, (req, res) => res.redirect('/test/scene/' + encodeURIComponent(String(req.query.id || '').trim())));
// 장면 미리보기: 선택지를 누르면 그 결과 문장 + 이어지는 장면 (능력치·호감도 판정 없이 모두 성공으로 봄)
app.get('/test/scene/:id', requireLogin, testerOnly, (req, res, next) => {
  const ev = game.findEvent(req.params.id);
  if (!ev) { flash(req, `장면 ${req.params.id} 을(를) 찾지 못했어요.`); return res.redirect('/test'); }
  const c = testChar(req);
  const lines = [];
  const prev = req.query.from ? game.findEvent(String(req.query.from)) : null;
  const pick = prev && prev.choices[Number(req.query.pick)];
  if (pick) {
    if (!/^\(.*\)$/.test(pick.text)) lines.push({ kind: 'choice', text: pick.text });
    const r = req.query.fail === '1' ? pick.fail : pick.success;
    if (r) lines.push({ kind: 'result', text: game.fill(r, c) });
  }
  lines.push({ kind: 'event', text: game.fill(ev.text || '', c) });
  const choices = ev.choices.map((ch, i) => {
    const go = [];
    if (ch.branch) ch.branch.cases.forEach(k => go.push({ to: k.to, label: ch.branch.title ? `칭호 「${ch.branch.title}」 있으면` : `${(game.getData().npcs.get(ch.branch.npc) || {}).name || ch.branch.npc} ${k.min}↑` }));
    if (ch.next) go.push({ to: ch.next, label: ch.branch ? '아니면' : '' });
    return { i, text: ch.text, auto: /^\(.*\)$/.test(ch.text), stat: ch.stat, fail: !!ch.fail, go };
  });
  const vn = game.vnFor(ev, c);
  res.render('test_scene', { ev, lines, choices, vn, C: game.C });
});

// CSV 데이터 확인 페이지 (서버가 읽은 그대로 보여 줌)
// 개발용: 서버(production)에서는 아예 없는 페이지로 처리 → 게임 데이터(스토리 분기·수치)가 플레이어에게 안 보임
app.get('/data', (req, res, next) => {
  if (PROD) return next();
  const data = game.getData();
  res.render('data', { data, game, C: game.C });
});

// 칭호 도감: 계정 보너스(특별 칭호) 목록과 획득 힌트, 이 계정의 해금 여부
app.get('/codex', requireLogin, async (req, res, next) => {
  try {
    const unlocks = await accountUnlocks(req.session.user.id);
    const list = game.C.ACCOUNT_BONUSES.filter(b => b.codex !== false).map(b => {
      const u = unlocks.find(x => x.unlock_id === b.id);
      const t = game.C.TITLES[b.grant && b.grant.title];
      const { desc, condition, ...pub } = b;             // 정확한 조건은 화면에 안 보냄 (미공개)
      return { ...pub, unlocked: !!u, by: u ? u.character_name : null, at: u ? u.unlocked_at : null,
        effectText: t && t.effects ? game.describeEffects(t.effects) : '' };
    });
    res.render('codex', { list, total: list.length, got: list.filter(x => x.unlocked).length });
  } catch (err) { next(err); }
});

app.get('/dead', requireLogin, (req, res) => {
  const death = req.session.lastDeath;
  delete req.session.lastDeath;
  if (!death) return res.redirect('/slots');
  res.render('dead', { death });
});

// ---------- 에러 ----------
app.use((err, req, res, next) => {
  console.error(err);
  let message = '서버에서 문제가 생겼어요. 터미널의 에러 메시지를 확인해 주세요.';
  if (err.code === 'ECONNREFUSED' || err.code === 'ER_ACCESS_DENIED_ERROR') {
    message = 'DB에 연결하지 못했어요. MariaDB가 켜져 있는지, .env 의 계정 정보와 포트가 맞는지 확인해 주세요.';
  } else if (err.code === 'ER_BAD_FIELD_ERROR' && /equipment/.test(err.sqlMessage)) {
    message = `장비 칸이 DB에 없어요. migrate_v12.sql 을 실행해 주세요 (데이터는 그대로). (${err.sqlMessage})`;
  } else if (err.code === 'ER_BAD_FIELD_ERROR' && /hp_bonus/.test(err.sqlMessage)) {
    message = `추가 최대 HP 칸이 DB에 없어요. migrate_v11.sql 을 실행해 주세요 (데이터는 그대로). (${err.sqlMessage})`;
  } else if (err.code === 'ER_NO_SUCH_TABLE' || err.code === 'ER_BAD_FIELD_ERROR') {
    // DB 구조가 코드보다 옛날 버전 → schema.sql 을 다시 실행 (주의: 데이터가 초기화됨)
    message = `DB 구조가 옛날 버전이에요. schema.sql 을 다시 실행해 주세요 (기존 데이터는 지워져요). (${err.sqlMessage})`;
  }
  // 개발 중에는 원인을 화면에도 보여 줌 (배포할 때 .env 에 NODE_ENV=production 을 넣으면 숨겨짐)
  const detail = process.env.NODE_ENV === 'production' ? null : `${err.code || err.name}: ${err.message}`;
  res.status(500).render('error', { message, detail });
});

const PORT = Number(process.env.PORT || 3000);
// 직업명 변경 (2026-11-21 모험가 → 전사, 정찰자 → 사냥꾼): 서버가 켜질 때 예전 이름을 자동으로 바꿈 (migrate_v13.sql 과 같은 내용, 여러 번 해도 안전)
db.query("UPDATE characters SET job = CASE job WHEN '모험가' THEN '전사' WHEN '정찰자' THEN '사냥꾼' END WHERE job IN ('모험가', '정찰자')")
  .then(([r]) => { if (r.affectedRows) console.log(`[직업명] ${r.affectedRows}명 새 이름으로 변경`); })
  .catch(err => console.warn('[직업명] 변경 실패:', err.message));

app.listen(PORT, () => {
  console.log(`서버 실행 중: http://localhost:${PORT}`);
  try {
    const d = game.getData();
    console.log(`[데이터] 이벤트 ${d.events.size}개, 아이템 ${d.items.length}개 읽음. 확인: http://localhost:${PORT}/data`);
  } catch (err) {
    console.error('[데이터] data/choices.csv 또는 data/items.csv 를 읽지 못했어요:', err.message);
  }
});
