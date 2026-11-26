// ============================================================
//  협동 의뢰: 방 만들기 · 들어가기 · 시작 · 각자 자기 몫 전투 · 라운드 정산
//  규칙(몫 계산, 전투 계획, 보상)은 lib/game.js, 숫자는 data/content.js 의 COOP
//
//  흐름
//   1) 방장이 의뢰를 골라 방을 만듦 (상태 open). 공개 = 목록에 보임 / 비공개 = 방 코드를 아는 사람만
//   2) 다른 캐릭터가 들어옴 (정원 COOP.maxMembers)
//   3) 방장이 시작 (최소 COOP.minMembers 명) → 상태 fighting, 1라운드, 각자 몫 = 전체 체력 ÷ 인원
//   4) 각자 편할 때 자기 몫 전투를 함 (won / lost)
//   5) 그 라운드 전원이 끝나면 정산
//      - 모두 성공 → 의뢰 성공, 보상 (중간에 빠진 구경꾼은 작은 보상)
//      - 일부 실패 → 실패한 사람은 구경꾼, 성공한 사람끼리 다시 나눠 다음 라운드
//      - 모두 실패 → 의뢰 실패
// ============================================================
const db = require('../db');
const game = require('./game');

const C = game.C;
const ACTIVE = "('open','fighting')";

async function addLog(conn, ch, text, kind = 'system') {
  await conn.query('INSERT INTO logs (character_id, label, kind, text) VALUES (?, ?, ?, ?)', [ch.character_id || ch.id, game.timeLabel(ch), kind, text]);
}

async function membersOf(conn, roomId) {
  const [rows] = await conn.query(
    `SELECT m.*, c.name, c.job, c.rank_level, c.user_id AS owner_id, c.year_no, c.season, c.phase, c.age
       FROM coop_members m JOIN characters c ON c.id = m.character_id
      WHERE m.room_id = ? ORDER BY m.joined_at, m.character_id`, [roomId]);
  return rows;
}

// 이 캐릭터가 들어가 있는 진행 중인 방 (없으면 null)
async function roomOf(charId) {
  const [rows] = await db.query(
    `SELECT r.* FROM coop_rooms r JOIN coop_members m ON m.room_id = r.id
      WHERE m.character_id = ? AND r.status IN ${ACTIVE} ORDER BY (r.status = 'fighting') DESC, r.id`, [charId]);
  if (!rows.length) return null;
  // 버튼을 빠르게 두 번 눌러 방이 겹쳐 생긴 경우 등: 남는 '모집 중' 방에서는 빠지고 정리 (빈 방은 닫힘)
  for (const extra of rows.slice(1)) {
    if (extra.status !== 'open') continue;
    await db.query('DELETE FROM coop_members WHERE room_id = ? AND character_id = ?', [extra.id, charId]);
    await tidy(extra.id);
  }
  await tidy(rows[0].id);
  return loadRoom(rows[0].id, charId);
}

async function loadRoom(roomId, charId) {
  const [rows] = await db.query('SELECT * FROM coop_rooms WHERE id = ?', [roomId]);
  if (!rows.length) return null;
  const room = rows[0];
  const members = await membersOf(db, roomId);
  const quest = game.coopQuest(room.quest_id);
  const me = members.find(m => m.character_id === charId) || null;
  return {
    ...room, members, quest, me,
    isLeader: room.leader_id === charId,
    canStart: room.status === 'open' && room.leader_id === charId && members.length >= C.COOP.minMembers,
    myTurn: room.status === 'fighting' && me && me.state === 'fighting',
  };
}

// 방 코드: 헷갈리는 글자(0 O 1 I L)는 뺌
const CODE_CHARS = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
async function newCode() {
  for (let tries = 0; tries < 20; tries++) {
    let code = '';
    for (let i = 0; i < C.COOP.codeLength; i++) code += CODE_CHARS[Math.floor(Math.random() * CODE_CHARS.length)];
    const [dup] = await db.query(`SELECT id FROM coop_rooms WHERE code = ? AND status IN ${ACTIVE}`, [code]);
    if (!dup.length) return code;
  }
  throw new Error('방 코드를 만들지 못했어요.');
}

// 모집 중인 공개 방 목록
async function openRooms() {
  // 아무도 없는 모집 중 방(캐릭터 삭제·사망 등으로 비어 버린 방)은 닫음
  await db.query(`UPDATE coop_rooms SET status = 'failed', ended_at = NOW()
     WHERE status = 'open' AND NOT EXISTS (SELECT 1 FROM coop_members m WHERE m.room_id = coop_rooms.id)`);
  const [rows] = await db.query(
    `SELECT r.*, c.name AS leader_name, (SELECT COUNT(*) FROM coop_members m WHERE m.room_id = r.id) AS cnt
       FROM coop_rooms r LEFT JOIN characters c ON c.id = r.leader_id
      WHERE r.status = 'open' AND r.is_private = 0 ORDER BY r.created_at DESC LIMIT 20`);
  return rows.map(r => ({ ...r, quest: game.coopQuest(r.quest_id) }));
}

// 공통 확인: 성인 · 피로도 · 다른 방에 없음
async function checkFree(c) {
  if (c.phase !== 'adult') return '성인이 되어야 협동 의뢰를 받을 수 있어요.';
  if (c.fatigue >= C.FATIGUE.questLimit) return `피로도가 ${C.FATIGUE.questLimit} 이상이라 협동 의뢰를 받을 수 없어요. 먼저 쉬세요.`;
  if (await roomOf(c.id)) return '이미 다른 협동 의뢰에 들어가 있어요.';
  return null;
}

async function create(c, questId, isPrivate = false) {
  const quest = game.coopQuest(questId);
  if (!quest) return { error: '없는 의뢰예요.' };
  if (c.rank_level < quest.minRank) return { error: '아직 등급이 부족합니다.' };
  const err = await checkFree(c);
  if (err) return { error: err };
  const code = isPrivate ? await newCode() : null;
  const [r] = await db.query("INSERT INTO coop_rooms (quest_id, leader_id, status, is_private, code) VALUES (?, ?, 'open', ?, ?)", [quest.id, c.id, isPrivate ? 1 : 0, code]);
  await db.query("INSERT INTO coop_members (room_id, character_id, state) VALUES (?, ?, 'joined')", [r.insertId, c.id]);
  // 거의 동시에 두 번 만들어졌으면(두 번 클릭) 먼저 만든 방만 남김
  const [mine] = await db.query(`SELECT r.id FROM coop_rooms r JOIN coop_members m ON m.room_id = r.id
     WHERE m.character_id = ? AND r.status IN ${ACTIVE} AND r.id < ?`, [c.id, r.insertId]);
  if (mine.length) {
    await db.query('DELETE FROM coop_members WHERE room_id = ?', [r.insertId]);
    await db.query("UPDATE coop_rooms SET status = 'failed', ended_at = NOW() WHERE id = ?", [r.insertId]);
    return { ok: true };
  }
  await addLog(db, c, `협동 의뢰 「${quest.title}」 파티를 ${isPrivate ? `비공개로 모집하기 시작했다. 방 코드는 ${code}.` : '모집하기 시작했다.'}`);
  return { ok: true };
}

// 방 코드로 들어가기 (비공개 방)
async function joinByCode(c, code) {
  const clean = String(code || '').toUpperCase().replace(/[^A-Z0-9]/g, '');
  if (!clean) return { error: '방 코드를 입력해 주세요.' };
  const [rows] = await db.query("SELECT id FROM coop_rooms WHERE code = ? AND status = 'open' LIMIT 1", [clean]);
  if (!rows.length) return { error: '그 코드로 모집 중인 방이 없어요. 이미 시작했거나 코드가 틀렸어요.' };
  return join(c, rows[0].id, true);
}

async function join(c, roomId, viaCode = false) {
  const err = await checkFree(c);
  if (err) return { error: err };
  const conn = await db.getConnection();
  try {
    await conn.beginTransaction();
    const [rows] = await conn.query('SELECT * FROM coop_rooms WHERE id = ? FOR UPDATE', [roomId]);
    const room = rows[0];
    if (!room || room.status !== 'open') { await conn.rollback(); return { error: '이미 시작했거나 없어진 방이에요.' }; }
    if (room.is_private && !viaCode) { await conn.rollback(); return { error: '비공개 방은 방 코드로만 들어갈 수 있어요.' }; }
    const quest = game.coopQuest(room.quest_id);
    if (quest && c.rank_level < quest.minRank) { await conn.rollback(); return { error: '아직 등급이 부족합니다.' }; }
    const members = await membersOf(conn, roomId);
    if (members.length >= C.COOP.maxMembers) { await conn.rollback(); return { error: '방이 가득 찼어요.' }; }
    if (!C.COOP.allowSameUser && members.some(m => m.owner_id === c.user_id)) { await conn.rollback(); return { error: '한 계정의 캐릭터는 한 명만 들어갈 수 있어요.' }; }
    await conn.query("INSERT INTO coop_members (room_id, character_id, state) VALUES (?, ?, 'joined')", [roomId, c.id]);
    for (const m of members) await addLog(conn, m, `${game.josa(c.name, '이', '가')} 협동 의뢰 파티에 들어왔다.`);
    await addLog(conn, c, `협동 의뢰 「${quest ? quest.title : room.quest_id}」 파티에 들어갔다.`);
    await conn.commit();
    return { ok: true };
  } catch (e) { await conn.rollback(); throw e; } finally { conn.release(); }
}

// 모집 중일 때만 나갈 수 있음 (전투 중에는 '포기')
async function leave(c) {
  const room = await roomOf(c.id);
  if (!room) return { error: '들어가 있는 방이 없어요.' };
  if (room.status !== 'open') return { error: '이미 시작한 의뢰예요. 포기하면 구경꾼이 됩니다.' };
  await db.query('DELETE FROM coop_members WHERE room_id = ? AND character_id = ?', [room.id, c.id]);
  await addLog(db, c, '협동 의뢰 파티에서 나왔다.');
  await tidy(room.id);
  return { ok: true };
}

async function start(c) {
  const conn = await db.getConnection();
  try {
    await conn.beginTransaction();
    const [rows] = await conn.query(
      `SELECT r.* FROM coop_rooms r JOIN coop_members m ON m.room_id = r.id
        WHERE m.character_id = ? AND r.status = 'open' FOR UPDATE`, [c.id]);
    const room = rows[0];
    if (!room) { await conn.rollback(); return { error: '모집 중인 방이 없어요.' }; }
    if (room.leader_id !== c.id) { await conn.rollback(); return { error: '방장만 시작할 수 있어요.' }; }
    const members = await membersOf(conn, room.id);
    if (members.length < C.COOP.minMembers) { await conn.rollback(); return { error: `${C.COOP.minMembers}명 이상 모여야 시작할 수 있어요.` }; }
    const quest = game.coopQuest(room.quest_id);
    const share = game.coopShare(quest, members.length);
    await conn.query("UPDATE coop_rooms SET status = 'fighting', round = 1, share = ? WHERE id = ?", [share, room.id]);
    await conn.query("UPDATE coop_members SET state = 'fighting' WHERE room_id = ?", [room.id]);
    for (const m of members) {
      await addLog(conn, m, `협동 의뢰 「${quest.title}」 시작! ${members.length}명이 ${quest.totalHp}의 체력을 나눠, 각자 ${share}씩 깎아야 한다.`);
    }
    await conn.commit();
    return { ok: true };
  } catch (e) { await conn.rollback(); throw e; } finally { conn.release(); }
}

// 자기 몫 전투 계획 (시드는 app.js 가 세션에 보관)
async function myPlan(c, seed) {
  const room = await roomOf(c.id);
  if (!room || !room.myTurn) return null;
  return { room, plan: game.coopPlan(c, room.quest, room.share, seed) };
}

// 전투 결과 저장 (giveUp = 싸우지 않고 포기)
async function submit(c, room, sim, giveUp = false) {
  const enemy = C.COMBAT.enemies[room.quest.enemy];
  const win = !giveUp && sim.win;
  const updates = {};
  if (!giveUp) {
    updates.fatigue = Math.min(C.FATIGUE.max, c.fatigue + C.COOP.fatigue);
    updates.hp = win ? Math.max(1, sim.php) : Math.max(1, enemy.loseHp || 1);
  }
  const conn = await db.getConnection();
  try {
    await conn.beginTransaction();
    const [rows] = await conn.query('SELECT * FROM coop_rooms WHERE id = ? FOR UPDATE', [room.id]);
    const [mine] = await conn.query('SELECT * FROM coop_members WHERE room_id = ? AND character_id = ?', [room.id, c.id]);
    if (!rows[0] || rows[0].status !== 'fighting' || rows[0].round !== room.round || !mine[0] || mine[0].state !== 'fighting') {
      await conn.rollback(); return { error: '이미 끝난 전투예요.' };
    }
    if (Object.keys(updates).length) await conn.query('UPDATE characters SET ? WHERE id = ?', [updates, c.id]);
    await conn.query('UPDATE coop_members SET state = ? WHERE room_id = ? AND character_id = ?', [win ? 'won' : 'lost', room.id, c.id]);
    const text = giveUp ? `[실패] 협동 의뢰 — 싸움을 포기하고 물러섰다. 이제 동료들을 지켜볼 뿐이다.`
      : win ? `[성공] 협동 의뢰 — ${enemy.name}에게 내 몫 ${room.share}의 피해를 입혔다. (${game.combatSummary(sim)} · 피로도 +${C.COOP.fatigue})`
        : `[실패] 협동 의뢰 — ${game.josa(enemy.name, '을', '를')} 끝내 몰아붙이지 못했다. (${game.combatSummary(sim)} · 피로도 +${C.COOP.fatigue})`;
    await addLog(conn, c, text, 'event');
    await settle(conn, room.id);
    await conn.commit();
    return { ok: true };
  } catch (e) { await conn.rollback(); throw e; } finally { conn.release(); }
}

// 라운드 정산 (트랜잭션 안에서 호출)
async function settle(conn, roomId) {
  const [rows] = await conn.query('SELECT * FROM coop_rooms WHERE id = ?', [roomId]);
  const room = rows[0];
  if (!room || room.status !== 'fighting') return;
  const members = await membersOf(conn, roomId);
  const inRound = members.filter(m => ['fighting', 'won', 'lost'].includes(m.state));
  if (inRound.some(m => m.state === 'fighting')) return; // 아직 싸우는 사람이 있음
  const quest = game.coopQuest(room.quest_id);
  const won = inRound.filter(m => m.state === 'won');
  const lost = inRound.filter(m => m.state === 'lost');

  if (!won.length) {
    await conn.query("UPDATE coop_rooms SET status = 'failed', ended_at = NOW() WHERE id = ?", [roomId]);
    for (const m of members) await addLog(conn, m, `협동 의뢰 「${quest.title}」 실패. 모두 물러날 수밖에 없었다.`);
    return;
  }
  if (!lost.length) {
    // 성공: 보상
    await conn.query("UPDATE coop_rooms SET status = 'cleared', ended_at = NOW() WHERE id = ?", [roomId]);
    for (const m of members) {
      const [cs] = await conn.query('SELECT * FROM characters WHERE id = ?', [m.character_id]);
      if (!cs.length) continue;
      const ch = cs[0];
      const spectator = m.state !== 'won';
      const r = game.coopReward(ch, spectator, quest);
      const set = { coop_count: ch.coop_count + 1, gold: ch.gold + r.gold };
      for (const [k, v] of Object.entries(r.effects)) set[k] = ch[k] + v;
      await conn.query('UPDATE characters SET ? WHERE id = ?', [set, ch.id]);
      await addLog(conn, ch, `협동 의뢰 「${quest.title}」 성공! ${spectator ? '지켜보기만 했지만 배운 것이 있었다. ' : ''}(${r.text})`, 'event');
    }
    return;
  }
  // 일부 실패: 실패한 사람은 구경, 성공한 사람끼리 다시
  const share = game.coopShare(quest, won.length);
  await conn.query('UPDATE coop_rooms SET round = round + 1, share = ? WHERE id = ?', [share, roomId]);
  for (const m of lost) await conn.query("UPDATE coop_members SET state = 'spectating' WHERE room_id = ? AND character_id = ?", [roomId, m.character_id]);
  for (const m of won) await conn.query("UPDATE coop_members SET state = 'fighting' WHERE room_id = ? AND character_id = ?", [roomId, m.character_id]);
  const names = lost.map(m => m.name).join(', ');
  for (const m of members) {
    await addLog(conn, m, `${game.josa(names, '이', '가')} 쓰러져 뒤로 물러났다. 남은 ${won.length}명이 다시 도전한다 — 각자 ${share}씩.`);
  }
}

// 다른 캐릭터로 바꿔 플레이하면: 같은 계정의 다른 캐릭터가 '모집 중'인 방에서는 빠짐
// (혼자 있던 방은 닫히고, 다른 사람이 있으면 방장이 넘어감 · 이미 싸우는 중인 방은 그대로) — 사용자 요청 2026-11-26
async function leaveOtherCharsRooms(userId, keepCharId) {
  const [rows] = await db.query(
    `SELECT r.id AS room_id, c.id AS char_id, c.name, c.year_no, c.season, c.phase, c.age
       FROM coop_rooms r JOIN coop_members m ON m.room_id = r.id JOIN characters c ON c.id = m.character_id
      WHERE c.user_id = ? AND c.id <> ? AND r.status = 'open'`, [userId, keepCharId]);
  for (const row of rows) {
    await db.query('DELETE FROM coop_members WHERE room_id = ? AND character_id = ?', [row.room_id, row.char_id]);
    await addLog(db, { id: row.char_id, name: row.name, year_no: row.year_no, season: row.season, phase: row.phase, age: row.age },
      '협동 의뢰 파티 모집을 그만두었다.');
    await tidy(row.room_id);
  }
}

// 방 정리: 방장이 없어졌으면 넘기고, 아무도 없으면 닫고, 전투 중 멈춰 있으면 정산
async function tidy(roomId) {
  const conn = await db.getConnection();
  try {
    await conn.beginTransaction();
    const [rows] = await conn.query('SELECT * FROM coop_rooms WHERE id = ? FOR UPDATE', [roomId]);
    const room = rows[0];
    if (room && ['open', 'fighting'].includes(room.status)) {
      const members = await membersOf(conn, roomId);
      if (!members.length) {
        await conn.query("UPDATE coop_rooms SET status = 'failed', ended_at = NOW() WHERE id = ?", [roomId]);
      } else {
        if (!members.some(m => m.character_id === room.leader_id)) {
          await conn.query('UPDATE coop_rooms SET leader_id = ? WHERE id = ?', [members[0].character_id, roomId]);
        }
        if (room.status === 'fighting') await settle(conn, roomId);
      }
    }
    await conn.commit();
  } catch (e) { await conn.rollback(); throw e; } finally { conn.release(); }
}

module.exports = { roomOf, openRooms, leaveOtherCharsRooms, create, join, joinByCode, leave, start, myPlan, submit };
