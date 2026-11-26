// ============================================================
//  전투 화면 (가드)
//  - 서버가 보낸 공격 패턴(#combatPlan)대로 적이 공격합니다.
//  - 화면 아무 곳에나 붉은 고리(전조)가 생겨 안쪽 원으로 줄어듭니다.
//  - 맞닿는 순간 그 원을 클릭·터치하면 가드 → 판정(Just Guard·Guard·Miss)에 따라 반격.
//    그보다 어긋나면 못 막은 것(피격).
//  - 적에 rescue 가 있으면 HP가 rescueAt(기본 1) 아래로 떨어지는 순간 화면 전체 연출이 터집니다.
//    regenFull 이면 맞는 즉시 적 체력이 가득 참(연출: 막대가 초록으로 차오름).
//    finale 이 있으면 HP가 그 값 아래일 때 오는 공격(또는 마지막 공격)은 막을 수 없고, 닿는 순간 난입.
//    rescueStyle 'flame' = 노란 Just Guard 대신 붉은 불꽃 (마나 각성 등), rescueTitle = 큰 글자
//  - immune 이면 반격해도 적에게 피해가 들어가지 않습니다.
//  - 조작 방식: 시작 전에 '클릭'(기본) / '키보드' 중 고름. 키보드면 원마다 Q·W·E·R 중 하나가 무작위로 적히고,
//    그 키를 누르면 그 글자가 적힌 원 중 가장 먼저 닿는 원을 막음 (틀린 키는 아무 일 없음).
//    판정·서버 전송은 클릭과 똑같음 (얼마나 어긋났는지 ms 만 보냄).
//  - 화면은 공격마다 "얼마나 어긋났는지(ms)"만 서버로 보내고, 승패는 서버가 다시 계산합니다.
//  - 적 그림: image 경로에 파일이 있으면 그걸 쓰고, 없으면 도형으로 그립니다.
// ============================================================
(function () {
  var planEl = document.getElementById('combatPlan');
  var canvas = document.getElementById('combatCanvas');
  if (!planEl || !canvas) return;
  var plan = JSON.parse(planEl.textContent);
  var E = plan.enemy;
  var overlay = document.getElementById('combatOverlay');
  var startBtn = document.getElementById('combatStart');
  var form = document.getElementById('combatForm');
  var offsetsInput = document.getElementById('combatOffsets');

  // ---- 화면 크기 (선명하게) ----
  var W = 720, H = 420;
  var ctx = canvas.getContext('2d');
  var dpr = Math.min(2, window.devicePixelRatio || 1);
  canvas.width = W * dpr; canvas.height = H * dpr;
  ctx.scale(dpr, dpr);

  var TARGET_R = 40, RING_START = 112;
  var TOUCH_R = 72;                                   // 이 거리 안을 누르면 그 원을 누른 것으로 봄 (손가락 여유)
  var LABEL = { perfect: 'Just Guard', great: 'Guard', good: 'Miss' };
  var COLOR = { perfect: '#ffd34d', great: '#9fd0ff', good: '#c9c0aa', miss: '#ff6b5e' };
  var ENEMY_X = 372, ENEMY_Y = E.art === 'bear' ? 150 : 165;

  // 적 이미지 (있으면 사용)
  var enemyImg = null;
  if (E.image) { var im = new Image(); im.onload = function () { enemyImg = im; }; im.src = E.image; }
  var bgImg = null;
  if (E.bg && E.bg !== 'arcane') {
    var bi = new Image(); bi.onload = function () { bgImg = bi; };
    bi.onerror = function () { if (bi.src.indexOf('/img/bg_forest.jpg') < 0) bi.src = '/img/bg_forest.jpg'; };   // 그림이 아직 없으면 기본 숲 배경
    bi.src = E.bg;
  }
  var NOENEMY = E.art === 'none';                     // 적 없이 패턴만 버티는 시험 (마법사 승급)

  // ---- 상태 ----
  var state = 'ready';               // ready → count → fight → (rescue) → end
  var t0 = 0, now = 0;
  var offsets = [], resolved = [];
  var php = plan.player.hp, ehp = E.hp;
  var BL = plan.player.bleed, stacks = 0, stackFlash = 0, shieldLeft = plan.player.missShield || 0;
  // finale: HP가 이 값 아래로 내려간 뒤 오는 공격(또는 마지막 공격)은 막을 수 없음 → 난입 (서버와 같은 규칙)
  var regenAnim = null;                              // regenFull: 깎인 체력이 곧바로 차오르는 연출
  var FIN = E.finale || 0, finalIdx = FIN ? (php < FIN ? 0 : plan.attacks.length - 1) : -1;
  var sfx = function (n) { if (window.SFX) window.SFX.play(n); }, lastCount = 0;   // 효과음 (public/sfx.js)   // 사냥꾼 출혈 — 서버 simulateCombat 과 같은 규칙
  var effects = [], sparks = [], jgFlash = 0, MAX_SPARKS = 180;
  var shake = 0, redFlash = 0, enemyHit = 0, lunge = null;
  var result = null, rescueAt = 0, dispHp = php;

  // ---- 조작 방식 (클릭 / 키보드 QWER) ----
  var MODE = 'click';
  // 공격마다 고리가 줄어드는 시간 (보통은 적의 approach, 흑마법사의 느린 공격은 더 김)
  function AP(a) { return a.ap || E.approach; }
  var MAX_AP = plan.attacks.reduce(function (m, a) { return Math.max(m, AP(a)); }, E.approach);
  var KEYS = ['Q', 'W', 'E', 'R'];
  plan.attacks.forEach(function (a) { a.key = KEYS[Math.floor(Math.random() * 4)]; });
  var modeBtns = document.querySelectorAll('#combatOverlay [data-mode]');
  var keyNote = document.getElementById('combatKeyNote');
  Array.prototype.forEach.call(modeBtns, function (b) {
    b.addEventListener('click', function () {
      MODE = b.getAttribute('data-mode');
      Array.prototype.forEach.call(modeBtns, function (x) { x.classList.toggle('on', x === b); x.setAttribute('aria-pressed', x === b); });
      if (keyNote) keyNote.hidden = MODE !== 'key';
    });
  });

  function gradeOf(off) {
    if (off === null) return 'miss';
    var d = Math.abs(off), w = plan.windows;
    return d <= w.perfect ? 'perfect' : d <= w.great ? 'great' : d <= w.good ? 'good' : 'miss';
  }

  // ---- 판정 하나 확정 (서버의 simulateCombat 과 같은 규칙) ----
  function resolve(i, off) {
    if (resolved[i] || state !== 'fight') return;
    resolved[i] = true;
    offsets[i] = off;
    var a = plan.attacks[i];
    if (i === finalIdx) { php = Math.max(1, php); return rescue(a); }   // 막을 수 없는 일격
    var g = gradeOf(off);
    var dmg = g === 'miss' ? E.damage : (E.guardDamage[g] || 0);
    if (g === 'miss' && shieldLeft > 0) { shieldLeft--; dmg = 0; effects.push({ type: 'text', text: '로브가 막아 냈다', color: '#d9c79a', x: 360, y: 300, life: 900, born: now }); }   // 늑대가죽 로브: 놓친 공격 1회 무시
    if (FIN) dmg = Math.min(dmg, Math.max(0, php - 1));

    // 출혈: 적이 공격할 때마다 쌓인 중첩만큼 피해
    if (BL && stacks > 0 && !E.immune) {
      var bd = Math.round(stacks * BL.per);
      sfx('bleed');
      ehp = Math.max(0, ehp - bd);
      effects.push({ type: 'num', text: '-' + bd, color: '#ff5a5a', x: ENEMY_X + 70, y: 150, life: 900, born: now });
      for (var bi = 0; bi < 5; bi++) effects.push({ type: 'drip', x: ENEMY_X - 40 + Math.random() * 80, y: ENEMY_Y + Math.random() * 40, life: 700, born: now });
    }

    if (g !== 'miss') {
      sfx(plan.player.style === 'magic' && g !== 'good' ? (g === 'perfect' ? 'magicPerfect' : 'magicGreat') : g);
      var hit = E.immune ? 0 : E.counterFixed ? E.counterFixed : Math.round(plan.player.atk * plan.mult[g]) + (plan.player.flat || 0); // 마법사: 마나만큼 고정 추가 · counterFixed = 반격 피해 고정
      ehp = Math.max(0, ehp - hit);
      enemyHit = 1;
      if (g === 'perfect') burst(a.x, a.y, 1);
      else effects.push({ type: 'spark', x: a.x, y: a.y, color: COLOR[g], life: 450, born: now });
      effects.push({ type: 'slash', x: a.x, y: a.y, color: COLOR[g], life: 380, born: now });
      effects.push({ type: 'text', text: LABEL[g], color: COLOR[g], x: a.x, y: a.y - 62, life: 850, born: now, big: g === 'perfect' });
      if (hit) effects.push({ type: 'num', text: '-' + hit, color: '#fff3d6', x: ENEMY_X + (Math.random() * 60 - 30), y: 112, life: 900, born: now });
      shake = Math.max(shake, g === 'perfect' ? 10 : 4);
      // 출혈 가득(최대 중첩)에서 Just Guard → 출혈 피해 한 번 더 (서버와 같은 규칙)
      if (BL && g === 'perfect' && stacks >= BL.max && !E.immune && !E.bleedImmune) {
        var bd2 = Math.round(stacks * BL.per);
        ehp = Math.max(0, ehp - bd2);
        effects.push({ type: 'num', text: '-' + bd2, color: '#ff2a2a', x: ENEMY_X - 70, y: 140, life: 1000, born: now });
        for (var bj = 0; bj < 9; bj++) effects.push({ type: 'drip', x: ENEMY_X - 50 + Math.random() * 100, y: ENEMY_Y + Math.random() * 50, life: 800, born: now });
      }
      if (BL && BL.add[g]) {
        if (g === 'perfect' && BL.crossbow) sfx('bolt');
        if (g === 'perfect' && BL.crossbow) effects.push({ type: 'bolt', x: 150, y: 330, tx: ENEMY_X, ty: ENEMY_Y + 10, life: 260, born: now });
        if (E.bleedImmune) {                              // 상처가 곧바로 아묾
          stacks = 0; sfx('regen');
          effects.push({ type: 'text', text: '재생', color: '#7dffa0', x: ENEMY_X, y: 92, life: 800, born: now });
        } else { stacks = Math.min(BL.max, stacks + BL.add[g]); stackFlash = 1; }
      }
    } else {
      effects.push({ type: 'claw', x: a.x, y: a.y, life: 420, born: now });
    }
    lunge = { x: a.x, y: a.y, amt: 1 };
    if (E.regenFull && ehp < E.hp) {                   // 맞는 즉시 재생 (서버와 같은 규칙)
      regenAnim = { from: ehp, born: now };
      ehp = E.hp;
      if (!(BL && BL.add[g])) effects.push({ type: 'text', text: '재생', color: '#7dffa0', x: 360, y: 92, life: 800, born: now });
    }

    // 쓰러지기 직전 난입 (rescueAt 이 있으면 HP가 그 아래로 떨어지려는 순간 · HP는 그대로)
    if (dmg > 0 && E.rescue && php - dmg < (E.rescueAt || 1)) { if (!E.rescueAt) php = 1; return rescue(a); }
    if (dmg > 0) {
      php = Math.max(0, php - dmg);
      sfx('hit');
      shake = Math.max(shake, 12); redFlash = Math.min(1, 0.5 + dmg / 30);
      effects.push({ type: 'num', text: '-' + dmg, color: COLOR.miss, x: 150, y: 362, life: 900, born: now });
    }
    if (FIN && php < FIN && finalIdx > i) finalIdx = i + 1;
    if (php <= 0 || ehp <= 0) end();
  }

  // ---- 일리치 난입: 화면 전체에 커다란 Just Guard ----
  function rescue(a) {
    state = 'rescue';
    rescueAt = now;
    shake = 26; sfx('rescue');
    if (E.rescueStyle === 'flame') { flameBurst(W / 2, H / 2 + 40, 4); flameBurst(a.x, a.y, 1.5); }
    else { burst(W / 2, H / 2, 4); burst(a.x, a.y, 1.5); }
    jgFlash = { x: W / 2, y: H / 2, born: now, big: true };
    setTimeout(function () { end(true); }, 2600);
  }

  function end(rescued) {
    if (state === 'end') return;
    state = 'end';
    result = { win: !rescued && php > 0 && (!E.mustKill || ehp <= 0), rescued: !!rescued }; // mustKill 이면 체력을 다 깎아야 승리
    if (!rescued) sfx(result.win ? 'win' : 'lose');
    setTimeout(function () {
      var used = 0;
      for (var i = 0; i < resolved.length; i++) if (resolved[i]) used = i + 1;
      offsetsInput.value = JSON.stringify(offsets.slice(0, used).map(function (v) { return v === undefined ? null : v; }));
      form.submit();
    }, rescued ? 900 : 1800);
  }

  // 누른 순간의 전투 시각 (화면이 버벅여도 판정은 정확하게 · 프레임 시각 now 는 최대 한 프레임 이상 늦을 수 있음)
  function pressTime(e) {
    var p = performance.now(), ts = e && e.timeStamp;
    var t = (ts && Math.abs(p - ts) < 1000) ? ts : p;   // 이벤트가 실제로 일어난 시각 (밀린 처리 시간까지 보정)
    return t - t0;
  }
  // ---- 입력: 클릭·터치한 위치에서 가장 가까운 원 ----
  function press(px, py, tp) {
    if (state !== 'fight' || MODE !== 'click') return;
    effects.push({ type: 'tap', x: px, y: py, life: 250, born: now });
    var best = -1, bestHit = Infinity;
    for (var i = 0; i < plan.attacks.length; i++) {
      if (resolved[i] || i === finalIdx) continue;     // 막을 수 없는 일격은 눌러도 소용없음
      var a = plan.attacks[i];
      if (a.hit - now > MAX_AP) break;                 // 아직 전조가 안 뜬 공격부터는 볼 필요 없음
      if (a.hit - now > AP(a)) continue;
      if (Math.hypot(a.x - px, a.y - py) <= TOUCH_R && a.hit < bestHit) { best = i; bestHit = a.hit; }
    }
    if (best < 0) return;                              // 빈 곳을 누르면 아무 일 없음
    var off = Math.round(tp - plan.attacks[best].hit);  // 음수 = 일찍, 양수 = 늦게
    resolve(best, off < -plan.windows.good ? null : off);
  }
  canvas.addEventListener('pointerdown', function (e) {
    e.preventDefault();
    var r = canvas.getBoundingClientRect();
    press((e.clientX - r.left) / r.width * W, (e.clientY - r.top) / r.height * H, pressTime(e));
  });
  canvas.addEventListener('contextmenu', function (e) { e.preventDefault(); });

  // ---- 입력: 키보드 (한글 입력 상태여도 되도록 e.code 로 봄) ----
  document.addEventListener('keydown', function (e) {
    if (MODE !== 'key' || state !== 'fight' || e.repeat) return;
    var k = { KeyQ: 'Q', KeyW: 'W', KeyE: 'E', KeyR: 'R' }[e.code];
    if (!k) return;
    e.preventDefault();
    var best = -1;
    for (var i = 0; i < plan.attacks.length; i++) {
      if (resolved[i] || i === finalIdx) continue;
      var a = plan.attacks[i];
      if (a.hit - now > MAX_AP) break;
      if (a.hit - now > AP(a)) continue;
      if (a.key === k) { best = i; break; }           // 그 글자가 적힌 원 중 가장 먼저 닿는 원
    }
    effects.push({ type: 'keytap', text: k, life: 300, born: now });
    if (best < 0) return;
    var off = Math.round(pressTime(e) - plan.attacks[best].hit);
    resolve(best, off < -plan.windows.good ? null : off);
  });

  startBtn.addEventListener('click', function () {
    overlay.hidden = true;
    state = 'count';
    t0 = performance.now() + 2400;                     // 3, 2, 1 뒤에 시작
  });

  // ---- 불꽃 ----
  // ---- 막을 수 없는 일격: 화면이 어두워지고, 가드 원은 금이 가 흐려지며, 검붉은 고리가 맥박치듯 조여 옴 ----
  function finalRing(a, left) {
    var span = E.approach * 1.6;
    var p = Math.max(0, Math.min(1, 1 - left / span));          // 0 → 1
    var beat = 0.5 + 0.5 * Math.sin(now / (110 - 50 * p));      // 다가올수록 빨라지는 맥박
    ctx.save();
    // 어둠: 화면 전체 + 가장자리 붉은 기운
    ctx.fillStyle = 'rgba(0,0,0,' + (0.62 * p) + ')';
    ctx.fillRect(-20, -20, W + 40, H + 40);
    var vg = ctx.createRadialGradient(a.x, a.y, 40, a.x, a.y, Math.max(W, H));
    vg.addColorStop(0, 'rgba(0,0,0,0)');
    vg.addColorStop(1, 'rgba(90,0,0,' + (0.55 * p * (0.6 + 0.4 * beat)) + ')');
    ctx.fillStyle = vg; ctx.fillRect(-20, -20, W + 40, H + 40);
    // 가드 원: 깜빡이며 꺼져 가고, 금이 감
    var flick = Math.random() < 0.18 * p ? 0.15 : 1;
    ctx.globalAlpha = Math.max(0.12, (1 - p * 0.75)) * flick;
    ctx.strokeStyle = 'rgba(200,190,170,.7)'; ctx.lineWidth = 2;
    ctx.setLineDash([10, 7 + 14 * p]);
    ctx.beginPath(); ctx.arc(a.x, a.y, TARGET_R, 0, Math.PI * 2); ctx.stroke();
    ctx.setLineDash([]);
    ctx.globalAlpha = Math.min(1, p * 1.4) * flick;
    ctx.strokeStyle = 'rgba(230,220,200,.75)'; ctx.lineWidth = 1.6;
    for (var k = 0; k < 5; k++) {                               // 금
      var ang = k * 1.31 + i0(a) , len = TARGET_R * (0.35 + 0.65 * p);
      ctx.beginPath(); ctx.moveTo(a.x, a.y);
      ctx.lineTo(a.x + Math.cos(ang) * len * 0.5 + Math.cos(ang + 0.6) * 6, a.y + Math.sin(ang) * len * 0.5 + Math.sin(ang + 0.6) * 6);
      ctx.lineTo(a.x + Math.cos(ang) * len, a.y + Math.sin(ang) * len);
      ctx.stroke();
    }
    // 검붉은 고리
    ctx.globalAlpha = 1;
    var r = TARGET_R + (RING_START * 1.25 - TARGET_R) * (1 - p);
    ctx.shadowColor = 'rgba(255,20,0,.9)'; ctx.shadowBlur = 14 + 22 * beat;
    ctx.strokeStyle = 'rgba(' + Math.round(150 + 90 * beat) + ',10,10,' + (0.55 + 0.45 * p) + ')';
    ctx.lineWidth = 5 + 9 * p + 3 * beat;
    ctx.beginPath(); ctx.arc(a.x, a.y, Math.max(6, r), 0, Math.PI * 2); ctx.stroke();
    ctx.restore();
    shake = Math.max(shake, 2 + 5 * p * p);
  }
  function i0(a) { return (a.x * 7 + a.y * 13) % 6.28; }

  function burst(x, y, scale) {
    var n = Math.round(26 * scale);                    // 렉 때문에 줄임 (80 → 26)
    for (var i = 0; i < n; i++) {
      var ang = Math.random() * Math.PI * 2, sp = (220 + Math.random() * 640) * Math.sqrt(scale);
      var hot = Math.random();
      sparks.push({
        x: x, y: y, vx: Math.cos(ang) * sp, vy: Math.sin(ang) * sp - 220,
        life: (550 + Math.random() * 650) * (scale > 1 ? 1.5 : 1), born: now, w: (2 + Math.random() * 3.5) * Math.min(2, scale),
        c: MAGIC ? (hot > 0.7 ? '240,240,255' : hot > 0.3 ? '170,160,255' : '110,170,255')
                 : (hot > 0.7 ? '255,250,215' : hot > 0.3 ? '255,214,80' : '255,150,30'),
      });
    }
    if (scale <= 1.5) jgFlash = { x: x, y: y, born: now };
  }

  // ---- 마법사: 마법진 ----
  var MAGIC = plan.player.style === 'magic';
  if (MAGIC) { COLOR.perfect = '#d9c8ff'; COLOR.great = '#8fc4ff'; }
  function magicCircle(x, y, p, seed) {
    var a = 0.3 + 0.6 * Math.min(1, p), rot = now / 1400 + seed;
    ctx.save();
    ctx.translate(x, y);
    ctx.shadowColor = 'rgba(140,120,255,.9)'; ctx.shadowBlur = 14;
    ctx.fillStyle = 'rgba(70,60,160,' + (0.08 + 0.12 * p) + ')';
    ctx.strokeStyle = 'rgba(170,190,255,' + a + ')'; ctx.lineWidth = 2.5;
    ctx.beginPath(); ctx.arc(0, 0, TARGET_R, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
    ctx.lineWidth = 1.2;
    ctx.beginPath(); ctx.arc(0, 0, TARGET_R - 7, 0, Math.PI * 2); ctx.stroke();
    // 테두리 룬 눈금
    ctx.rotate(-rot * 0.6);
    for (var k = 0; k < 12; k++) {
      var ang = k / 12 * Math.PI * 2;
      ctx.beginPath(); ctx.moveTo(Math.cos(ang) * (TARGET_R - 7), Math.sin(ang) * (TARGET_R - 7));
      ctx.lineTo(Math.cos(ang) * (TARGET_R - (k % 3 ? 11 : 15)), Math.sin(ang) * (TARGET_R - (k % 3 ? 11 : 15))); ctx.stroke();
    }
    // 육망성 (천천히 회전)
    ctx.rotate(rot * 1.6);
    ctx.lineWidth = 1.8; ctx.strokeStyle = 'rgba(200,210,255,' + a + ')';
    [0, Math.PI / 3].forEach(function (off) {
      ctx.beginPath();
      for (var t = 0; t < 3; t++) {
        var an = off + t / 3 * Math.PI * 2 - Math.PI / 2, rr = TARGET_R - 13;
        if (t === 0) ctx.moveTo(Math.cos(an) * rr, Math.sin(an) * rr); else ctx.lineTo(Math.cos(an) * rr, Math.sin(an) * rr);
      }
      ctx.closePath(); ctx.stroke();
    });
    ctx.beginPath(); ctx.arc(0, 0, 7, 0, Math.PI * 2); ctx.stroke();
    ctx.restore();
  }

  // 붉은 불꽃 (위로 피어오름) — 마나 각성 연출
  var FLAME = ['255,235,190', '255,170,60', '255,110,30', '230,60,20'];
  function flameBurst(x, y, scale) {
    var n = Math.round(40 * scale);                    // 렉 때문에 줄임 (110 → 40)
    for (var i = 0; i < n; i++) {
      var ang = -Math.PI / 2 + (Math.random() - 0.5) * Math.PI * 1.6, sp = (120 + Math.random() * 480) * Math.sqrt(scale);
      sparks.push({
        x: x + (Math.random() - 0.5) * 60 * scale, y: y, vx: Math.cos(ang) * sp, vy: Math.sin(ang) * sp, rise: true,
        life: 600 + Math.random() * 900, born: now, w: (6 + Math.random() * 12) * Math.min(1.6, Math.max(0.6, scale)),
        c: FLAME[Math.floor(Math.random() * FLAME.length)],
      });
    }
  }

  // ---- 그림 ----
  function bg() {
    if (bgImg) { ctx.drawImage(bgImg, -10, -10, W + 20, H + 20); return; }
    if (E.bg === 'arcane') {
      // 마탑 시험장: 어두운 보랏빛 + 바닥의 커다란 마법진
      var ag = ctx.createRadialGradient(W / 2, H / 2, 40, W / 2, H / 2, 480);
      ag.addColorStop(0, '#2a2350'); ag.addColorStop(1, '#0c0a1a');
      ctx.fillStyle = ag; ctx.fillRect(0, 0, W, H);
      ctx.save(); ctx.translate(W / 2, H / 2); ctx.rotate(now / 9000);
      ctx.strokeStyle = 'rgba(150,140,255,.16)'; ctx.lineWidth = 2;
      [190, 172, 120].forEach(function (r) { ctx.beginPath(); ctx.arc(0, 0, r, 0, Math.PI * 2); ctx.stroke(); });
      for (var q = 0; q < 2; q++) {
        ctx.beginPath();
        for (var t = 0; t < 3; t++) { var an = q * Math.PI / 3 + t / 3 * Math.PI * 2 - Math.PI / 2; if (t === 0) ctx.moveTo(Math.cos(an) * 172, Math.sin(an) * 172); else ctx.lineTo(Math.cos(an) * 172, Math.sin(an) * 172); }
        ctx.closePath(); ctx.stroke();
      }
      ctx.restore();
      return;
    }
    var g = ctx.createLinearGradient(0, 0, 0, H);
    g.addColorStop(0, '#16202a'); g.addColorStop(0.55, '#1d2b25'); g.addColorStop(1, '#2a2418');
    ctx.fillStyle = g; ctx.fillRect(0, 0, W, H);
    ctx.fillStyle = 'rgba(240,226,190,.85)'; ctx.beginPath(); ctx.arc(612, 62, 26, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = '#16202a'; ctx.beginPath(); ctx.arc(624, 54, 24, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = '#0f1814';
    [[40, 220, 70], [110, 250, 55], [650, 230, 70], [700, 260, 50], [-10, 270, 60]].forEach(function (t) {
      ctx.beginPath(); ctx.moveTo(t[0], t[1] - t[2] * 2.4); ctx.lineTo(t[0] - t[2] * 0.7, t[1]); ctx.lineTo(t[0] + t[2] * 0.7, t[1]); ctx.fill();
      ctx.fillRect(t[0] - 5, t[1], 10, 40);
    });
    ctx.fillStyle = '#231d14'; ctx.fillRect(0, 262, W, H - 262);
    ctx.fillStyle = 'rgba(255,240,200,.04)';
    for (var i = 0; i < 9; i++) ctx.fillRect(0, 262 + i * 18, W, 1);
  }

  function wolf(x, y, flash) {
    ctx.save(); ctx.translate(x, y);
    ctx.fillStyle = flash ? '#e9e2d0' : '#3b3833';
    ctx.beginPath(); ctx.moveTo(70, -10); ctx.quadraticCurveTo(120, -40, 108, -70); ctx.quadraticCurveTo(96, -30, 60, -2); ctx.fill();
    ctx.beginPath(); ctx.ellipse(20, 0, 70, 34, 0, 0, Math.PI * 2); ctx.fill();
    [[-28, 24], [-6, 26], [44, 24], [66, 22]].forEach(function (l) { ctx.fillRect(l[0], l[1], 13, 40); });
    ctx.beginPath(); ctx.moveTo(-40, -30); ctx.lineTo(-110, 4); ctx.lineTo(-44, 22); ctx.closePath(); ctx.fill();
    ctx.beginPath(); ctx.ellipse(-46, -6, 30, 28, 0, 0, Math.PI * 2); ctx.fill();
    ctx.beginPath(); ctx.moveTo(-58, -26); ctx.lineTo(-52, -62); ctx.lineTo(-38, -30); ctx.fill();
    ctx.beginPath(); ctx.moveTo(-36, -28); ctx.lineTo(-26, -60); ctx.lineTo(-18, -24); ctx.fill();
    ctx.fillStyle = '#ff5a3c'; ctx.shadowColor = '#ff5a3c'; ctx.shadowBlur = 12;
    ctx.beginPath(); ctx.ellipse(-60, -10, 5, 3, -0.3, 0, Math.PI * 2); ctx.fill();
    ctx.shadowBlur = 0; ctx.fillStyle = '#efe6cf';
    for (var i = 0; i < 4; i++) { ctx.beginPath(); ctx.moveTo(-100 + i * 12, 6); ctx.lineTo(-95 + i * 12, 14); ctx.lineTo(-90 + i * 12, 6); ctx.fill(); }
    ctx.restore();
  }

  // 일어선 그리즐리 베어
  function bear(x, y, flash) {
    ctx.save(); ctx.translate(x, y);
    var fur = flash ? '#efe2c6' : '#4a3424', dark = flash ? '#d8c7a2' : '#33241a';
    ctx.fillStyle = dark;                                             // 다리
    ctx.beginPath(); ctx.ellipse(-38, 70, 26, 34, 0, 0, Math.PI * 2); ctx.fill();
    ctx.beginPath(); ctx.ellipse(38, 70, 26, 34, 0, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = fur;                                              // 몸통
    ctx.beginPath(); ctx.ellipse(0, 10, 78, 82, 0, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = dark; ctx.beginPath(); ctx.ellipse(0, 22, 46, 54, 0, 0, Math.PI * 2); ctx.fill(); // 배
    ctx.fillStyle = fur;                                              // 들어 올린 앞발
    ctx.beginPath(); ctx.ellipse(-86, -44, 24, 46, -0.5, 0, Math.PI * 2); ctx.fill();
    ctx.beginPath(); ctx.ellipse(86, -44, 24, 46, 0.5, 0, Math.PI * 2); ctx.fill();
    ctx.strokeStyle = '#efe6cf'; ctx.lineWidth = 3; ctx.lineCap = 'round';  // 발톱
    [[-104, -84], [-94, -90], [-84, -92]].forEach(function (p) { ctx.beginPath(); ctx.moveTo(p[0] + 4, p[1] + 8); ctx.lineTo(p[0] - 4, p[1] - 6); ctx.stroke(); });
    [[104, -84], [94, -90], [84, -92]].forEach(function (p) { ctx.beginPath(); ctx.moveTo(p[0] - 4, p[1] + 8); ctx.lineTo(p[0] + 4, p[1] - 6); ctx.stroke(); });
    ctx.fillStyle = fur;                                              // 머리·귀
    ctx.beginPath(); ctx.arc(-30, -96, 15, 0, Math.PI * 2); ctx.fill();
    ctx.beginPath(); ctx.arc(30, -96, 15, 0, Math.PI * 2); ctx.fill();
    ctx.beginPath(); ctx.ellipse(0, -74, 44, 40, 0, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = flash ? '#cdbb94' : '#7a5a3c';                    // 주둥이
    ctx.beginPath(); ctx.ellipse(0, -60, 22, 16, 0, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = '#1a120c'; ctx.beginPath(); ctx.ellipse(0, -68, 8, 5, 0, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = '#7a1b12'; ctx.beginPath(); ctx.ellipse(0, -52, 12, 6, 0, 0, Math.PI); ctx.fill(); // 벌린 입
    ctx.fillStyle = '#ff5a3c'; ctx.shadowColor = '#ff5a3c'; ctx.shadowBlur = 14;  // 눈
    ctx.beginPath(); ctx.arc(-17, -84, 4, 0, Math.PI * 2); ctx.fill();
    ctx.beginPath(); ctx.arc(17, -84, 4, 0, Math.PI * 2); ctx.fill();
    ctx.restore();
  }

  // 사람 모양 적 (그림 파일이 없을 때) · art 'skeleton' = 스켈레톤, 'mage' = 흑마법사
  function figure(x, y, flash) {
    ctx.save(); ctx.translate(x, y);
    if (E.art === 'soldier' || E.art === 'knight') { armored(x, y, flash); ctx.restore(); return; }
    var skel = E.art === 'skeleton';
    var body = flash ? '#f4efe2' : (skel ? '#d9d2bf' : '#2c2236');
    ctx.fillStyle = body; ctx.strokeStyle = body; ctx.lineCap = 'round';
    if (skel) {
      ctx.lineWidth = 7;
      ctx.beginPath(); ctx.moveTo(0, -62); ctx.lineTo(0, 10); ctx.stroke();                     // 척추
      for (var r = 0; r < 4; r++) { ctx.beginPath(); ctx.ellipse(0, -48 + r * 13, 26 - r * 3, 5, 0, 0, Math.PI * 2); ctx.lineWidth = 4; ctx.stroke(); }   // 갈비뼈
      ctx.lineWidth = 7;
      ctx.beginPath(); ctx.moveTo(-8, 10); ctx.lineTo(-20, 64); ctx.moveTo(8, 10); ctx.lineTo(20, 64); ctx.stroke();   // 다리
      ctx.beginPath(); ctx.moveTo(-24, -58); ctx.lineTo(-44, -8); ctx.moveTo(24, -58); ctx.lineTo(42, -14); ctx.stroke(); // 팔
      ctx.lineWidth = 5; ctx.strokeStyle = flash ? '#fff' : '#8a8f96';
      ctx.beginPath(); ctx.moveTo(-44, -8); ctx.lineTo(-70, -96); ctx.stroke();               // 녹슨 칼
      ctx.fillStyle = body; ctx.beginPath(); ctx.arc(0, -84, 19, 0, Math.PI * 2); ctx.fill();   // 해골
      ctx.fillRect(-11, -70, 22, 10);
    } else {
      ctx.beginPath(); ctx.moveTo(0, -112); ctx.quadraticCurveTo(30, -100, 28, -64); ctx.lineTo(48, 64); ctx.lineTo(-48, 64); ctx.lineTo(-28, -64); ctx.quadraticCurveTo(-30, -100, 0, -112); ctx.fill();   // 로브
      ctx.fillStyle = '#0d0a12'; ctx.beginPath(); ctx.ellipse(0, -78, 15, 18, 0, 0, Math.PI * 2); ctx.fill();   // 두건 속 어둠
      ctx.strokeStyle = flash ? '#fff' : '#5b4a3a'; ctx.lineWidth = 5;
      ctx.beginPath(); ctx.moveTo(46, -110); ctx.lineTo(40, 64); ctx.stroke();               // 지팡이
      ctx.fillStyle = '#9b5cff'; ctx.shadowColor = '#9b5cff'; ctx.shadowBlur = 18;
      ctx.beginPath(); ctx.arc(46, -116, 8, 0, Math.PI * 2); ctx.fill();
    }
    ctx.fillStyle = skel ? '#7fd4ff' : '#ff5a3c'; ctx.shadowColor = ctx.fillStyle; ctx.shadowBlur = 12;   // 눈
    ctx.beginPath(); ctx.arc(-7, -84, 3.5, 0, Math.PI * 2); ctx.fill();
    ctx.beginPath(); ctx.arc(7, -84, 3.5, 0, Math.PI * 2); ctx.fill();
    ctx.restore();
  }

  // 갑옷 입은 사람 (그림 파일이 없을 때) · 'soldier' = 보호소 경비병(가죽·곤봉), 'knight' = 기사(강철·장검·망토)
  function armored(x, y, flash) {
    var kn = E.art === 'knight';
    var metal = flash ? '#f4efe2' : kn ? '#b9bec6' : '#7a5a3a', dark = flash ? '#fff' : kn ? '#5d636c' : '#3e2c1c';
    ctx.lineCap = 'round';
    if (kn) { ctx.fillStyle = flash ? '#fff' : '#6b1e1e'; ctx.beginPath(); ctx.moveTo(-26, -66); ctx.lineTo(-40, 62); ctx.lineTo(40, 62); ctx.lineTo(26, -66); ctx.fill(); }   // 망토
    ctx.fillStyle = metal; ctx.strokeStyle = dark; ctx.lineWidth = 3;
    ctx.beginPath(); ctx.moveTo(-26, -66); ctx.lineTo(26, -66); ctx.lineTo(22, 8); ctx.lineTo(-22, 8); ctx.closePath(); ctx.fill(); ctx.stroke();   // 몸통
    ctx.lineWidth = 12; ctx.strokeStyle = metal;
    ctx.beginPath(); ctx.moveTo(-12, 8); ctx.lineTo(-18, 64); ctx.moveTo(12, 8); ctx.lineTo(18, 64); ctx.stroke();   // 다리
    ctx.beginPath(); ctx.moveTo(-26, -60); ctx.lineTo(-40, -10); ctx.moveTo(26, -60); ctx.lineTo(44, -18); ctx.stroke();   // 팔
    ctx.lineWidth = kn ? 6 : 9; ctx.strokeStyle = flash ? '#fff' : kn ? '#e4e8ee' : '#5b3b22';
    ctx.beginPath(); ctx.moveTo(44, -18); ctx.lineTo(kn ? 74 : 62, kn ? -118 : -70); ctx.stroke();   // 장검 / 곤봉
    if (kn) { ctx.lineWidth = 4; ctx.strokeStyle = dark; ctx.beginPath(); ctx.moveTo(34, -30); ctx.lineTo(56, -38); ctx.stroke(); }
    ctx.fillStyle = metal; ctx.strokeStyle = dark; ctx.lineWidth = 3;
    ctx.beginPath(); ctx.arc(0, -86, 19, 0, Math.PI * 2); ctx.fill(); ctx.stroke();   // 투구
    ctx.fillStyle = '#111'; ctx.fillRect(-12, -90, 24, 5);   // 투구 틈
    if (kn) { ctx.fillStyle = flash ? '#fff' : '#a52a2a'; ctx.beginPath(); ctx.moveTo(-3, -105); ctx.quadraticCurveTo(10, -128, 22, -112); ctx.lineTo(3, -102); ctx.fill(); }   // 깃털
    else { ctx.fillStyle = metal; ctx.beginPath(); ctx.ellipse(-44, -14, 14, 22, 0, 0, Math.PI * 2); ctx.fill(); ctx.stroke(); }   // 나무 방패
  }

  function drawEnemy(x, y, flash) {
    if (enemyImg) {
      // 발이 그림자에 닿도록 아래쪽 기준으로 그림
      var h = E.spriteH || (E.art === 'bear' ? 262 : 235), w = h * enemyImg.width / enemyImg.height;   // spriteH = 그림 높이 (키 큰 적은 줄여서 체력바에 안 가리게)
      var bottom = E.art === 'bear' ? 262 : 242;
      ctx.save(); if (flash) ctx.filter = 'brightness(1.9)';
      ctx.drawImage(enemyImg, x - w / 2, bottom - h + (y - ENEMY_Y), w, h);
      ctx.restore();
    } else if (E.art === 'bear') bear(x, y, flash);
    else if (E.art === 'skeleton' || E.art === 'mage' || E.art === 'soldier' || E.art === 'knight') figure(x, y, flash);
    else wolf(x, y, flash);
  }

  function hpBar(x, y, w, cur, max, color, label, hidden) {
    ctx.fillStyle = 'rgba(0,0,0,.45)'; ctx.fillRect(x - 2, y - 2, w + 4, 16);
    ctx.fillStyle = '#3a2a22'; ctx.fillRect(x, y, w, 12);
    ctx.fillStyle = color; ctx.fillRect(x, y, w * Math.max(0, cur) / max, 12);
    ctx.fillStyle = '#f3e7cc'; ctx.font = '600 13px "Gowun Batang", serif'; ctx.textAlign = 'left';
    ctx.fillText(label + '  ' + (hidden ? '???' : Math.max(0, Math.round(cur)) + ' / ' + max), x, y - 6);
  }

  function draw() {
    ctx.save();
    if (shake > 0) { ctx.translate((Math.random() - 0.5) * shake, (Math.random() - 0.5) * shake); shake *= 0.88; if (shake < 0.5) shake = 0; }
    bg();

    // 적: 다음 공격 쪽으로 몸을 기울임
    var lean = 0;
    if (state === 'fight') {
      for (var i = 0; i < plan.attacks.length; i++) if (!resolved[i]) {
        var nx = plan.attacks[i];
        var p0 = 1 - Math.max(0, Math.min(1, (nx.hit - now) / AP(nx)));
        lean = (nx.x - ENEMY_X) * 0.12 * p0; break;
      }
    }
    if (lunge && lunge.amt > 0) { lean += (lunge.x - ENEMY_X) * 0.25 * lunge.amt; lunge.amt *= 0.88; }
    var ex = ENEMY_X + lean, ey = ENEMY_Y - (enemyHit > 0 ? 6 * enemyHit : 0);
    if (!NOENEMY) {
      ctx.fillStyle = 'rgba(0,0,0,.35)'; ctx.beginPath(); ctx.ellipse(ex + 6, E.art === 'bear' ? 248 : 232, E.art === 'bear' ? 110 : (E.art === 'skeleton' || E.art === 'mage' || E.art === 'soldier' || E.art === 'knight') ? 52 : 92, 12, 0, 0, Math.PI * 2); ctx.fill();
      if (ehp > 0 || !result || !result.win) drawEnemy(ex, ey, enemyHit > 0.5);
      else { ctx.globalAlpha = 0.35; drawEnemy(ex, ey + 20, false); ctx.globalAlpha = 1; }
    }
    if (enemyHit > 0) enemyHit = Math.max(0, enemyHit - 0.08);

    if (E.regenFull) {
      var shownHp = ehp, rk = 0;
      if (regenAnim) {
        rk = Math.max(0, Math.min(1, (now - regenAnim.born - 180) / 320));
        shownHp = regenAnim.from + (E.hp - regenAnim.from) * rk * rk;
        if (rk >= 1 && now - regenAnim.born > 900) regenAnim = null;
      }
      hpBar(220, 30, 280, shownHp, E.hp, regenAnim && rk > 0 ? '#5fc77a' : '#b8322a', E.name);
    } else if (NOENEMY) {
      // 적 대신 남은 공격 수
      var doneN = 0; for (var d = 0; d < plan.attacks.length; d++) if (resolved[d]) doneN++;
      hpBar(220, 30, 280, plan.attacks.length - doneN, plan.attacks.length, E.bg === 'arcane' ? '#8f86ff' : '#b8322a', E.name + ' · 남은 공격');
    } else hpBar(220, 30, 280, ehp, E.hp, '#c9563c', E.name, E.hideHp);
    // 출혈 중첩 (체력바 아래 핏방울)
    if (BL) {
      ctx.save(); ctx.textAlign = 'left'; ctx.font = '700 13px system-ui, sans-serif';
      ctx.fillStyle = 'rgba(255,235,225,.85)'; ctx.fillText(BL.poison ? '독' : '출혈', 220, 62);
      for (var si = 0; si < BL.max; si++) {
        var full = si + 1 <= stacks, half = !full && si + 0.5 <= stacks;   // 0.5 중첩은 반쯤 찬 핏방울
        var col = BL.poison ? '80,190,70' : '220,40,40';   // 독 석궁이면 초록
        ctx.fillStyle = full ? 'rgba(' + col + ',' + (0.85 + 0.15 * stackFlash) + ')' : half ? 'rgba(' + col + ',.45)' : 'rgba(0,0,0,.35)';
        ctx.beginPath(); var sx = 256 + si * (BL.max > 6 ? 11 : 16), sy = 57;
        ctx.moveTo(sx, sy - 7); ctx.quadraticCurveTo(sx + 6, sy, sx, sy + 5); ctx.quadraticCurveTo(sx - 6, sy, sx, sy - 7); ctx.fill();
      }
      ctx.restore();
      if (stackFlash > 0) stackFlash = Math.max(0, stackFlash - 0.05);
    }

    // 전조: 화면 곳곳에 붉은 고리가 줄어듦
    if (state === 'fight') {
      plan.attacks.forEach(function (a, i) {
        if (resolved[i]) return;
        if (finalIdx >= 0 && i > finalIdx && finalIdx < plan.attacks.length - 1) return;   // 마지막 일격 뒤의 공격은 안 보임
        var left = a.hit - now;
        if (i === finalIdx && left <= E.approach * 1.6) { finalRing(a, left); if (left <= 0) resolve(i, null); return; }
        var ap = AP(a);                                  // 흑마법사의 느린 공격은 고리가 더 천천히 줄어듦
        if (left > ap) return;
        var p = 1 - left / ap;                           // 0 → 1
        var r = TARGET_R + (RING_START - TARGET_R) * (1 - Math.min(1, p));
        // 안쪽 원 (누를 곳) — 마법사는 마법진
        if (MAGIC) magicCircle(a.x, a.y, p, i);
        else {
          ctx.fillStyle = 'rgba(240,226,190,' + (0.06 + 0.1 * p) + ')';
          ctx.strokeStyle = 'rgba(240,226,190,' + (0.35 + 0.4 * p) + ')'; ctx.lineWidth = 3;
          ctx.beginPath(); ctx.arc(a.x, a.y, TARGET_R, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
        }
        if (MODE === 'key') {                            // 키보드 모드: 원 가운데 누를 키
          ctx.save();
          ctx.font = 'bold 30px system-ui, sans-serif'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
          ctx.lineWidth = 4; ctx.strokeStyle = 'rgba(0,0,0,.65)'; ctx.strokeText(a.key, a.x, a.y + 1);
          ctx.fillStyle = 'rgba(255,248,230,' + (0.55 + 0.45 * Math.min(1, p)) + ')'; ctx.fillText(a.key, a.x, a.y + 1);
          ctx.restore();
        }
        // 줄어드는 붉은 고리
        ctx.strokeStyle = 'rgba(232,70,50,' + (0.35 + 0.65 * Math.min(1, p)) + ')';
        if (left < 0) {                                  // 지나간 뒤: 원 안으로 파고들며 흐려짐
          r = TARGET_R + (RING_START - TARGET_R) * (left / ap);
          ctx.strokeStyle = 'rgba(232,70,50,' + Math.max(0, 1 + left / 150) + ')';
        }
        ctx.lineWidth = left < 0 ? 3 : 2.5 + p * 2;
        ctx.beginPath(); ctx.arc(a.x, a.y, Math.max(4, r), 0, Math.PI * 2); ctx.stroke();
        if (left < -plan.windows.good) resolve(i, null);   // 늦어서 놓침
      });
    }

    // 효과
    effects = effects.filter(function (f) { return now - f.born < f.life; });
    effects.forEach(function (f) {
      var k = (now - f.born) / f.life;
      ctx.globalAlpha = 1 - k;
      if (f.type === 'text') {
        ctx.fillStyle = f.color; ctx.textAlign = 'center';
        ctx.font = '700 ' + (f.big ? 36 : 26) + 'px "Gowun Batang", serif';
        if (f.big) { ctx.shadowColor = 'rgba(255,190,40,.95)'; ctx.shadowBlur = 18; }
        ctx.fillText(f.text, f.x, Math.max(40, f.y) - k * 24);
        ctx.shadowBlur = 0;
      } else if (f.type === 'drip') {                  // 출혈 핏방울
        ctx.fillStyle = 'rgba(200,20,20,' + (1 - k) + ')';
        ctx.beginPath(); ctx.arc(f.x, f.y + k * 40, 3.5, 0, Math.PI * 2); ctx.fill();
      } else if (f.type === 'bolt') {                  // 석궁 볼트
        var bx = f.x + (f.tx - f.x) * k, by = f.y + (f.ty - f.y) * k, ang = Math.atan2(f.ty - f.y, f.tx - f.x);
        ctx.strokeStyle = '#e8d9b0'; ctx.lineWidth = 3; ctx.lineCap = 'round';
        ctx.beginPath(); ctx.moveTo(bx - Math.cos(ang) * 26, by - Math.sin(ang) * 26); ctx.lineTo(bx, by); ctx.stroke();
      } else if (f.type === 'num') {
        ctx.fillStyle = f.color; ctx.textAlign = 'center'; ctx.font = '700 22px system-ui, sans-serif';
        ctx.fillText(f.text, f.x, f.y - k * 30);
      } else if (f.type === 'spark') {
        ctx.strokeStyle = f.color; ctx.lineWidth = 3;
        for (var s = 0; s < 10; s++) {
          var ang = s / 10 * Math.PI * 2, r1 = TARGET_R + k * 20, r2 = TARGET_R + 14 + k * 46;
          ctx.beginPath(); ctx.moveTo(f.x + Math.cos(ang) * r1, f.y + Math.sin(ang) * r1); ctx.lineTo(f.x + Math.cos(ang) * r2, f.y + Math.sin(ang) * r2); ctx.stroke();
        }
      } else if (f.type === 'slash') {
        ctx.strokeStyle = f.color; ctx.lineWidth = 5 * (1 - k) + 1;
        ctx.beginPath(); ctx.moveTo(f.x, f.y); ctx.lineTo(ex + (f.x - ex) * k * 0.3, ENEMY_Y - 10); ctx.stroke();
      } else if (f.type === 'claw') {
        ctx.strokeStyle = 'rgba(255,90,70,' + (1 - k) + ')'; ctx.lineWidth = 5; ctx.lineCap = 'round';
        for (var m = -1; m <= 1; m++) { ctx.beginPath(); ctx.moveTo(f.x - 34 + m * 16, f.y - 40); ctx.lineTo(f.x + 26 + m * 16, f.y + 34); ctx.stroke(); }
      } else if (f.type === 'tap') {
        ctx.strokeStyle = 'rgba(255,240,210,.8)'; ctx.lineWidth = 2;
        ctx.beginPath(); ctx.arc(f.x, f.y, 8 + k * 16, 0, Math.PI * 2); ctx.stroke();
      } else if (f.type === 'keytap') {                // 누른 키 (오른쪽 아래)
        ctx.fillStyle = 'rgba(255,240,210,.9)'; ctx.font = 'bold 22px system-ui, sans-serif'; ctx.textAlign = 'center';
        ctx.fillText(f.text, W - 40, H - 30 - k * 10);
      }
      ctx.globalAlpha = 1;
    });

    // 불꽃 입자
    sparks = sparks.filter(function (p) { return now - p.born < p.life; });
    if (sparks.length > MAX_SPARKS) sparks = sparks.slice(sparks.length - MAX_SPARKS);   // 한꺼번에 너무 많으면 오래된 것부터 버림
    ctx.save(); ctx.globalCompositeOperation = 'lighter';
    sparks.forEach(function (p) {
      var dt = (now - p.born) / 1000, k = (now - p.born) / p.life;
      var grav = p.rise ? -260 : 520; // 불꽃은 위로, 불티는 아래로
      var px = p.x + p.vx * dt, py = p.y + p.vy * dt + grav * dt * dt;
      if (p.rise) {
        // 불길: 위로 피어오르며 작아지는 불덩이
        var rad = p.w * (1 - k * 0.8);
        var fg = ctx.createRadialGradient(px, py, 0, px, py, rad);
        fg.addColorStop(0, 'rgba(255,240,200,' + (0.9 * (1 - k)) + ')');
        fg.addColorStop(0.4, 'rgba(' + p.c + ',' + (0.7 * (1 - k)) + ')');
        fg.addColorStop(1, 'rgba(180,30,0,0)');
        ctx.shadowBlur = 0; ctx.fillStyle = fg;
        ctx.beginPath(); ctx.arc(px, py, rad, 0, Math.PI * 2); ctx.fill();
        return;
      }
      var tx = px - p.vx * 0.025, ty = py - (p.vy + grav * 2 * dt) * 0.025;
      var al = 1 - k * k, lw = p.w * (1 - k * 0.5);
      ctx.lineCap = 'round'; ctx.shadowBlur = 0;     // shadowBlur 는 입자마다 쓰면 매우 무거움 → 굵고 옅은 선으로 빛 번짐 흉내
      ctx.beginPath(); ctx.moveTo(tx, ty); ctx.lineTo(px, py);
      ctx.strokeStyle = (MAGIC ? 'rgba(140,130,255,' : 'rgba(255,170,40,') + (0.25 * al) + ')'; ctx.lineWidth = lw * 3; ctx.stroke();
      ctx.strokeStyle = 'rgba(' + p.c + ',' + al + ')'; ctx.lineWidth = lw; ctx.stroke();
    });
    ctx.restore();
    if (jgFlash && !jgFlash.big) {
      var age = now - jgFlash.born, a2 = Math.max(0, 1 - age / 420);
      var gr = ctx.createRadialGradient(jgFlash.x, jgFlash.y, 0, jgFlash.x, jgFlash.y, 190);
      if (MAGIC) { gr.addColorStop(0, 'rgba(240,240,255,' + a2 + ')'); gr.addColorStop(0.3, 'rgba(150,140,255,' + 0.6 * a2 + ')'); gr.addColorStop(1, 'rgba(80,120,255,0)'); }
      else { gr.addColorStop(0, 'rgba(255,252,220,' + a2 + ')'); gr.addColorStop(0.3, 'rgba(255,210,70,' + 0.6 * a2 + ')'); gr.addColorStop(1, 'rgba(255,150,0,0)'); }
      ctx.save(); ctx.globalCompositeOperation = 'lighter';
      ctx.fillStyle = gr; ctx.fillRect(jgFlash.x - 190, jgFlash.y - 190, 380, 380);
      ctx.strokeStyle = MAGIC ? 'rgba(190,200,255,' + a2 + ')' : 'rgba(255,220,90,' + a2 + ')'; ctx.lineWidth = 6 * a2 + 1;
      ctx.shadowColor = MAGIC ? 'rgba(130,120,255,1)' : 'rgba(255,200,60,1)'; ctx.shadowBlur = 20;
      ctx.beginPath(); ctx.arc(jgFlash.x, jgFlash.y, TARGET_R + age * 0.45, 0, Math.PI * 2); ctx.stroke();
      ctx.restore();
      if (a2 <= 0) jgFlash = 0;
    }

    if (redFlash > 0) { ctx.fillStyle = 'rgba(200,30,20,' + redFlash * 0.35 + ')'; ctx.fillRect(-20, -20, W + 40, H + 40); redFlash = Math.max(0, redFlash - 0.05); }

    dispHp += (php - dispHp) * 0.25;
    hpBar(24, 392, 240, dispHp, plan.player.maxHp, dispHp <= plan.player.maxHp * 0.3 ? '#d0663f' : '#6fae58', '나');

    // 난입: 화면 전체 Just Guard
    if (rescueAt) drawRescue();

    ctx.textAlign = 'center';
    if (state === 'count') {
      var left = Math.ceil(-now / 800);                 // 카운트 중에는 now = (지금 − 시작 시각) 이라 음수 → 3, 2, 1
      if (left !== lastCount) { lastCount = left; sfx(left > 0 ? 'count' : 'go'); }
      ctx.fillStyle = '#f6e7c4'; ctx.font = '700 64px "Gowun Batang", serif';
      ctx.fillText(left > 0 ? String(left) : '!', W / 2, 250);
    }
    if (state === 'end' && result && !result.rescued) {
      ctx.fillStyle = 'rgba(20,14,8,.55)'; ctx.fillRect(-20, 150, W + 40, 110);
      ctx.fillStyle = result.win ? '#ffd76a' : '#ff8a7a'; ctx.font = '700 44px "Gowun Batang", serif';
      ctx.fillText(result.win ? (E.winText || (ehp <= 0 ? '승리' : '버텨 냈다')) : (E.mustKill && php > 0 ? '놓쳤다…' : '밀려났다…'), W / 2, 212);
      ctx.fillStyle = '#f3e7cc'; ctx.font = '15px system-ui, sans-serif';
      var c = { perfect: 0, great: 0, good: 0, miss: 0 };
      offsets.forEach(function (o, i) { if (resolved[i]) c[gradeOf(o)]++; });
      ctx.fillText('Just Guard ' + c.perfect + ' · Guard ' + c.great + ' · Miss ' + c.good + ' · 피격 ' + c.miss, W / 2, 242);
    }
    ctx.restore();
  }

  // 마나 각성: 화면 전체가 붉은 불꽃으로 터짐 (노란 Just Guard 대신)
  function drawFlameRescue(age) {
    if (age < 2200) { flameBurst(40 + Math.random() * (W - 80), H + 10, 0.25); flameBurst(W / 2 + (Math.random() - 0.5) * 200, H / 2 + 80, 0.15); } // 계속 피어오르는 불길
    var flash = Math.max(0, 1 - age / 500);
    ctx.save();
    ctx.globalCompositeOperation = 'lighter';
    var gr = ctx.createRadialGradient(W / 2, H / 2 + 40, 0, W / 2, H / 2 + 40, 560);
    gr.addColorStop(0, 'rgba(255,220,170,' + (0.2 + 0.7 * flash) + ')');
    gr.addColorStop(0.35, 'rgba(255,110,30,' + (0.18 + 0.5 * flash) + ')');
    gr.addColorStop(1, 'rgba(160,20,0,0)');
    ctx.fillStyle = gr; ctx.fillRect(0, 0, W, H);
    [0, 180].forEach(function (d) {
      var ag = age - d; if (ag < 0) return;
      var a = Math.max(0, 1 - ag / 1300);
      ctx.strokeStyle = 'rgba(255,120,40,' + a + ')'; ctx.lineWidth = 14 * a + 2;
      ctx.shadowColor = 'rgba(255,60,10,1)'; ctx.shadowBlur = 30;
      ctx.beginPath(); ctx.arc(W / 2, H / 2 + 40, 40 + ag * 0.6, 0, Math.PI * 2); ctx.stroke();
    });
    ctx.restore();
    if (!E.rescueTitle && !E.rescueName) return; // 글자 없이 불꽃만
    var s = Math.min(1, age / 180), pop = 1 + 0.25 * Math.max(0, 1 - age / 300);
    ctx.save();
    ctx.translate(W / 2, H / 2 - 6); ctx.scale(pop, pop);
    ctx.globalAlpha = s; ctx.textAlign = 'center';
    ctx.shadowColor = 'rgba(255,70,10,1)'; ctx.shadowBlur = 34;
    ctx.fillStyle = '#ffe2c4'; ctx.font = '700 76px "Gowun Batang", serif';
    if (E.rescueTitle) ctx.fillText(E.rescueTitle, 0, 0);
    if (E.rescueName && age > 500) {
      ctx.globalAlpha = Math.min(1, (age - 500) / 400);
      ctx.shadowBlur = 12; ctx.font = '700 24px "Gowun Batang", serif'; ctx.fillStyle = '#ffb07a';
      ctx.fillText(E.rescueName, 0, 50);
    }
    ctx.restore();
  }

  function drawRescue() {
    var age = now - rescueAt;
    if (E.rescueStyle === 'flame') return drawFlameRescue(age);
    // 하얗게 번쩍
    var flash = Math.max(0, 1 - age / 500);
    ctx.save();
    ctx.globalCompositeOperation = 'lighter';
    var gr = ctx.createRadialGradient(W / 2, H / 2, 0, W / 2, H / 2, 520);
    gr.addColorStop(0, 'rgba(255,250,225,' + (0.25 + 0.75 * flash) + ')');
    gr.addColorStop(0.35, 'rgba(255,205,70,' + (0.15 + 0.5 * flash) + ')');
    gr.addColorStop(1, 'rgba(255,140,0,0)');
    ctx.fillStyle = gr; ctx.fillRect(0, 0, W, H);
    // 화면을 가르는 검광
    var sk = Math.min(1, age / 140);
    ctx.strokeStyle = 'rgba(255,248,215,' + Math.max(0, 1 - age / 900) + ')'; ctx.lineWidth = 10; ctx.lineCap = 'round';
    ctx.shadowColor = 'rgba(255,210,80,1)'; ctx.shadowBlur = 30;
    ctx.beginPath(); ctx.moveTo(-40, H + 20); ctx.lineTo(-40 + (W + 80) * sk, H + 20 - (H + 60) * sk); ctx.stroke();
    // 퍼지는 금빛 고리 두 겹
    [0, 160].forEach(function (d) {
      var ag = age - d; if (ag < 0) return;
      var a = Math.max(0, 1 - ag / 1200);
      ctx.strokeStyle = 'rgba(255,220,90,' + a + ')'; ctx.lineWidth = 12 * a + 2;
      ctx.beginPath(); ctx.arc(W / 2, H / 2, 40 + ag * 0.6, 0, Math.PI * 2); ctx.stroke();
    });
    ctx.restore();
    // 커다란 글자
    var s = Math.min(1, age / 180), pop = 1 + 0.25 * Math.max(0, 1 - age / 300);
    ctx.save();
    ctx.translate(W / 2, H / 2 - 6); ctx.scale(pop, pop);
    ctx.globalAlpha = s; ctx.textAlign = 'center';
    ctx.shadowColor = 'rgba(255,180,30,1)'; ctx.shadowBlur = 30;
    ctx.fillStyle = '#fff3c4'; ctx.font = '700 84px "Gowun Batang", serif';
    ctx.fillText(E.rescueTitle || 'Just Guard', 0, 0);
    if (E.rescueName && age > 500) {
      ctx.globalAlpha = Math.min(1, (age - 500) / 400);
      ctx.shadowBlur = 12; ctx.font = '700 24px "Gowun Batang", serif'; ctx.fillStyle = '#ffe08a';
      ctx.fillText('— ' + E.rescueName, 0, 50);
    }
    ctx.restore();
  }

  function loop(ts) {
    if (state === 'count' && ts >= t0) state = 'fight';
    now = state === 'ready' ? 0 : ts - t0;
    if (state === 'fight' && plan.attacks.every(function (_, i) { return resolved[i]; })) end(); // 다 버티면 적이 물러남
    draw();
    requestAnimationFrame(loop);
  }
  requestAnimationFrame(loop);
})();
