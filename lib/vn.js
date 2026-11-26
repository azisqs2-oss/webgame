// ============================================================
//  비주얼노벨 대본 읽기 — data/vn/<이름>.txt
//  story.csv 장면 글에 {비주얼노벨:이름} 을 넣으면, 그 장면에서 전투 화면 크기의 틀에
//  그림 + 대사 상자로 대본을 보여 주고, 다 보면 평소 선택지가 나옴 (public/vn.js).
//
//  대본 쓰는 법 (한 줄에 하나)
//    그냥 글                 → 지문 (이름표 없음)
//    <이름>대사              → 그 사람의 대사          예) <세실>네, 엄마!
//    <이름>                  → 다음 줄을 그 사람이 말함
//    [ 글 ]                  → 방금 말한 사람의 '속뜻·섬뜩한 말' (붉은 글씨)
//    [배경 그림이름]          → 배경 바꾸기 (public/img/vn/그림이름.jpg 또는 .png · 없으면 임시 그림)
//    [인물 그림이름 왼쪽|가운데|오른쪽] / [인물 없음]
//    [효과 어둠|밝게|암전|흔들림|합|태양]
//    [선택] 다음 줄부터 "* 고를 글 => 라벨" 여러 줄
//    [라벨 이름] / [이동 라벨] / [더하기 이름 숫자] / [만약 이름 >= 숫자 => 라벨] / [끝]
//    # 로 시작하는 줄, ( ) 로 감싼 줄 = 메모 (화면에 안 나옴)
// ============================================================
const fs = require('fs');
const path = require('path');

const DIR = path.join(__dirname, '..', 'data', 'vn');
const COMMANDS = ['배경', '인물', '효과', '선택', '라벨', '이동', '더하기', '만약', '끝'];
const cache = new Map();

function parse(src, id) {
  const ops = [], labels = {}, errors = [];
  const lines = src.replace(/^﻿/, '').split(/\r?\n/);
  let pendingSpeaker = null, lastSpeaker = null;
  for (let i = 0; i < lines.length; i++) {
    const raw = lines[i], line = raw.trim(), at = `${id}.txt ${i + 1}번째 줄`;
    if (!line || line.startsWith('#') || /^\(.*\)$/.test(line)) continue;
    const cmd = line.match(/^\[(\S+)(?:\s+(.*?))?\s*\]$/);
    if (cmd && COMMANDS.includes(cmd[1])) {
      const [, name, arg = ''] = cmd;
      if (name === '배경') ops.push({ op: 'bg', name: arg });
      else if (name === '인물') {
        const [img, pos = '가운데'] = arg.split(/\s+/);
        ops.push(img === '없음' || !img ? { op: 'char', name: null } : { op: 'char', name: img, pos: { 왼쪽: 'left', 오른쪽: 'right' }[pos] || 'center' });
      } else if (name === '효과') ops.push({ op: 'fx', name: arg });
      else if (name === '라벨') { labels[arg] = ops.length; }
      else if (name === '이동') ops.push({ op: 'goto', label: arg, at });
      else if (name === '끝') ops.push({ op: 'end' });
      else if (name === '더하기') {
        const m = arg.match(/^(\S+)\s+(-?\d+)$/);
        if (m) ops.push({ op: 'add', key: m[1], n: Number(m[2]) }); else errors.push(`${at}: [더하기 이름 숫자] 형식이 아니에요`);
      } else if (name === '만약') {
        const m = arg.match(/^(\S+)\s*(>=|<=|==|>|<)\s*(-?\d+)\s*=>\s*(\S+)$/);
        if (m) ops.push({ op: 'if', key: m[1], cmp: m[2], n: Number(m[3]), label: m[4], at }); else errors.push(`${at}: [만약 이름 >= 숫자 => 라벨] 형식이 아니에요`);
      } else if (name === '선택') {
        const options = [];
        while (i + 1 < lines.length && /^\s*\*/.test(lines[i + 1])) {
          i++;
          const m = lines[i].trim().match(/^\*\s*(.+?)\s*=>\s*(\S+)$/);
          if (m) options.push({ text: m[1], label: m[2] }); else errors.push(`${id}.txt ${i + 1}번째 줄: "* 고를 글 => 라벨" 형식이 아니에요`);
        }
        if (!options.length) errors.push(`${at}: [선택] 아래에 "* 고를 글 => 라벨" 줄이 없어요`);
        ops.push({ op: 'choice', options, at });
      }
      continue;
    }
    // 대사 / 지문
    const sp = line.match(/^<([^>]+)>\s*(.*)$/);
    if (sp) {
      if (!sp[2]) { pendingSpeaker = sp[1]; continue; }
      ops.push({ op: 'say', who: sp[1], text: sp[2] }); lastSpeaker = sp[1]; pendingSpeaker = null; continue;
    }
    const em = line.match(/^\[\s*(.*?)\s*\]$/);
    if (em) { ops.push({ op: 'say', who: pendingSpeaker || lastSpeaker, text: em[1], style: 'dark' }); pendingSpeaker = null; continue; }
    if (pendingSpeaker) { ops.push({ op: 'say', who: pendingSpeaker, text: line }); lastSpeaker = pendingSpeaker; pendingSpeaker = null; continue; }
    ops.push({ op: 'say', who: null, text: line });
  }
  // 라벨 확인
  ops.forEach(o => {
    if (o.op === 'goto' || o.op === 'if') { if (!(o.label in labels)) errors.push(`${o.at}: 없는 라벨 "${o.label}"`); }
    if (o.op === 'choice') o.options.forEach(op => { if (!(op.label in labels)) errors.push(`${o.at}: 없는 라벨 "${op.label}"`); });
  });
  return { id, ops, labels, errors };
}

// 대본 하나 읽기 (파일이 바뀌면 다시 읽음)
function load(id) {
  if (!/^[\w가-힣-]+$/.test(id)) return null;
  const file = path.join(DIR, id + '.txt');
  let stat;
  try { stat = fs.statSync(file); } catch (_) { return { id, ops: [{ op: 'say', who: null, text: `(대본 파일 data/vn/${id}.txt 이 없어요)` }], labels: {}, errors: [`data/vn/${id}.txt 없음`] }; }
  const hit = cache.get(id);
  if (hit && hit.mtime === stat.mtimeMs) return hit.script;
  const script = parse(fs.readFileSync(file, 'utf8'), id);
  cache.set(id, { mtime: stat.mtimeMs, script });
  return script;
}

const VN_RE = /\{비주얼노벨:([\w가-힣-]+)\}/;
// 장면 글에 붙은 대본 이름
const idOf = text => { const m = String(text || '').match(VN_RE); return m ? m[1] : null; };
// 모든 대본의 오류 (데이터 확인 페이지용)
function allErrors() {
  let files = [];
  try { files = fs.readdirSync(DIR).filter(f => f.endsWith('.txt')); } catch (_) {}
  return files.flatMap(f => load(f.slice(0, -4)).errors);
}

module.exports = { load, idOf, allErrors, VN_RE };
