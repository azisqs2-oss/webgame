// ============================================================
//  단련 화면 (마나 단련 등)
//  - 몬스터 없이 전투 화면이 열리고, 가운데 마법진을 꾹 누르고 있으면 파란 구체가 점점 커집니다.
//  - 손을 떼면 조금씩 흩어지고, 끝까지 모으면 완료 → 서버로 전송 (서버가 걸린 시간을 다시 확인)
// ============================================================
(function () {
  var planEl = document.getElementById('trainPlan');
  var canvas = document.getElementById('trainCanvas');
  if (!planEl || !canvas) return;
  var plan = JSON.parse(planEl.textContent);
  var overlay = document.getElementById('trainOverlay');
  var startBtn = document.getElementById('trainStart');
  var form = document.getElementById('trainForm');
  var heldInput = document.getElementById('trainHeld');

  var W = 720, H = 420, CX = W / 2, CY = H / 2 + 10;
  var ctx = canvas.getContext('2d');
  var dpr = Math.min(2, window.devicePixelRatio || 1);
  canvas.width = W * dpr; canvas.height = H * dpr;
  ctx.scale(dpr, dpr);

  var bgImg = null;
  if (plan.bg) { var bi = new Image(); bi.onload = function () { bgImg = bi; }; bi.src = plan.bg; }

  var CIRCLE_R = 70, ORB_MAX = 62;
  var state = 'ready', now = 0, last = 0;
  var charge = 0, held = 0, holding = false, doneAt = 0;
  var motes = [], sparks = [];

  function inCircle(px, py) { return Math.hypot(px - CX, py - CY) <= CIRCLE_R + 30; }
  function pos(e) {
    var r = canvas.getBoundingClientRect();
    return { x: (e.clientX - r.left) * W / r.width, y: (e.clientY - r.top) * H / r.height };
  }
  canvas.addEventListener('pointerdown', function (e) {
    e.preventDefault();
    if (state !== 'charge') return;
    var p = pos(e);
    if (inCircle(p.x, p.y)) { holding = true; try { canvas.setPointerCapture(e.pointerId); } catch (_) {} }
  });
  ['pointerup', 'pointercancel', 'pointerleave'].forEach(function (ev) {
    canvas.addEventListener(ev, function () { holding = false; });
  });
  canvas.addEventListener('contextmenu', function (e) { e.preventDefault(); });

  startBtn.addEventListener('click', function () {
    overlay.style.display = 'none';
    state = 'charge';
  });

  function finish() {
    state = 'done'; doneAt = now; holding = false;
    if (window.SFX) window.SFX.play('done');
    for (var i = 0; i < 140; i++) {
      var a = Math.random() * Math.PI * 2, sp = 120 + Math.random() * 520;
      sparks.push({ x: CX, y: CY, vx: Math.cos(a) * sp, vy: Math.sin(a) * sp, born: now, life: 700 + Math.random() * 700, w: 2 + Math.random() * 3 });
    }
    setTimeout(function () { heldInput.value = String(Math.round(held)); form.submit(); }, 1600);
  }

  function frame(t) {
    now = t; var dt = last ? Math.min(50, t - last) : 16; last = t;
    if (state === 'charge') {
      if (holding) { charge = Math.min(plan.holdMs, charge + dt); held += dt; if (window.SFX && Math.floor((charge - dt) / 400) !== Math.floor(charge / 400)) window.SFX.play('charge'); }
      else charge = Math.max(0, charge - dt * 0.6);           // 손을 떼면 조금씩 흩어짐
      if (charge >= plan.holdMs) finish();
      if (holding && Math.random() < 0.8) {                    // 사방에서 빨려 들어오는 마나
        var a = Math.random() * Math.PI * 2, d = 160 + Math.random() * 160;
        motes.push({ x: CX + Math.cos(a) * d, y: CY + Math.sin(a) * d, born: now, life: 700 });
      }
    }
    draw();
    requestAnimationFrame(frame);
  }

  function draw() {
    if (bgImg) ctx.drawImage(bgImg, -10, -10, W + 20, H + 20);
    else { ctx.fillStyle = '#1d1a2a'; ctx.fillRect(0, 0, W, H); }
    ctx.fillStyle = 'rgba(10,10,30,.55)'; ctx.fillRect(0, 0, W, H);
    var k = charge / plan.holdMs;

    // 바닥 마법진
    ctx.save(); ctx.translate(CX, CY);
    ctx.shadowColor = 'rgba(130,120,255,.9)'; ctx.shadowBlur = 16 + 20 * k;
    ctx.strokeStyle = 'rgba(170,190,255,' + (0.45 + 0.5 * k) + ')'; ctx.lineWidth = 2.5;
    ctx.beginPath(); ctx.arc(0, 0, CIRCLE_R, 0, Math.PI * 2); ctx.stroke();
    ctx.lineWidth = 1.2; ctx.beginPath(); ctx.arc(0, 0, CIRCLE_R - 10, 0, Math.PI * 2); ctx.stroke();
    ctx.rotate(-now / 2400);
    for (var i = 0; i < 16; i++) {
      var ang = i / 16 * Math.PI * 2, r1 = CIRCLE_R - 10, r2 = CIRCLE_R - (i % 4 ? 16 : 22);
      ctx.beginPath(); ctx.moveTo(Math.cos(ang) * r1, Math.sin(ang) * r1); ctx.lineTo(Math.cos(ang) * r2, Math.sin(ang) * r2); ctx.stroke();
    }
    ctx.rotate(now / 900);
    ctx.lineWidth = 1.8;
    [0, Math.PI / 3].forEach(function (off) {
      ctx.beginPath();
      for (var t = 0; t < 3; t++) {
        var an = off + t / 3 * Math.PI * 2 - Math.PI / 2, rr = CIRCLE_R - 24;
        if (t === 0) ctx.moveTo(Math.cos(an) * rr, Math.sin(an) * rr); else ctx.lineTo(Math.cos(an) * rr, Math.sin(an) * rr);
      }
      ctx.closePath(); ctx.stroke();
    });
    ctx.restore();

    // 빨려 들어오는 마나 알갱이
    motes = motes.filter(function (m) { return now - m.born < m.life; });
    ctx.save(); ctx.globalCompositeOperation = 'lighter';
    motes.forEach(function (m) {
      var p = (now - m.born) / m.life, x = m.x + (CX - m.x) * p, y = m.y + (CY - m.y) * p;
      ctx.fillStyle = 'rgba(140,180,255,' + (0.8 * (1 - p * 0.5)) + ')';
      ctx.beginPath(); ctx.arc(x, y, 2.5, 0, Math.PI * 2); ctx.fill();
    });

    // 파란 구체
    var r = state === 'done' ? ORB_MAX * (1 + Math.min(1, (now - doneAt) / 300) * 0.4) : 6 + (ORB_MAX - 6) * k;
    var fade = state === 'done' ? Math.max(0, 1 - (now - doneAt) / 900) : 1;
    var pulse = 1 + 0.04 * Math.sin(now / 90);
    var g = ctx.createRadialGradient(CX, CY, 0, CX, CY, r * pulse * 1.9);
    g.addColorStop(0, 'rgba(235,245,255,' + fade + ')');
    g.addColorStop(0.3, 'rgba(120,170,255,' + 0.9 * fade + ')');
    g.addColorStop(0.55, 'rgba(70,90,255,' + 0.45 * fade + ')');
    g.addColorStop(1, 'rgba(40,40,200,0)');
    ctx.fillStyle = g; ctx.beginPath(); ctx.arc(CX, CY, r * pulse * 1.9, 0, Math.PI * 2); ctx.fill();
    // 구체 본체 (또렷한 파란 구슬)
    var core = ctx.createRadialGradient(CX - r * 0.3, CY - r * 0.35, r * 0.05, CX, CY, r * pulse);
    core.addColorStop(0, 'rgba(245,250,255,' + fade + ')');
    core.addColorStop(0.45, 'rgba(110,160,255,' + 0.95 * fade + ')');
    core.addColorStop(1, 'rgba(40,60,210,' + 0.9 * fade + ')');
    ctx.fillStyle = core; ctx.beginPath(); ctx.arc(CX, CY, r * pulse, 0, Math.PI * 2); ctx.fill();

    // 완료 불꽃
    sparks = sparks.filter(function (s) { return now - s.born < s.life; });
    sparks.forEach(function (s) {
      var dt = (now - s.born) / 1000, q = (now - s.born) / s.life;
      var x = s.x + s.vx * dt, y = s.y + s.vy * dt;
      ctx.strokeStyle = 'rgba(170,200,255,' + (1 - q) + ')'; ctx.lineWidth = s.w; ctx.lineCap = 'round';
      ctx.beginPath(); ctx.moveTo(x - s.vx * 0.03, y - s.vy * 0.03); ctx.lineTo(x, y); ctx.stroke();
    });
    ctx.restore();

    // 진행 막대
    ctx.fillStyle = 'rgba(0,0,0,.45)'; ctx.fillRect(W / 2 - 150, H - 34, 300, 10);
    ctx.fillStyle = '#7fa8ff'; ctx.fillRect(W / 2 - 150, H - 34, 300 * k, 10);
    if (state === 'charge' && !holding) {
      ctx.fillStyle = 'rgba(230,235,255,.85)'; ctx.font = '15px system-ui, sans-serif'; ctx.textAlign = 'center';
      ctx.fillText(charge > 0 ? '마나가 흩어지고 있어요 — 다시 눌러 주세요' : '가운데 마법진을 꾹 누르세요', W / 2, H - 46);
    }
  }
  requestAnimationFrame(frame);
})();
