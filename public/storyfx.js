// ============================================================
//  메인 스토리 연출 — 글 속에 {연출:합} / {연출:태양} 을 넣으면,
//  글자가 그 자리까지 타이핑될 때 화면 전체에 효과가 나옵니다 (typewriter.js 가 부름).
//   합   : 배경 곳곳에 Just Guard 불꽃이 튀고 칼 부딪히는 소리 (길드장 vs 기사)
//   태양 : 화면 전체가 태양빛에 그을리듯 변함 (그왈흐메이의 신성 · 2026-11-26 덜 쨍하게)
//  화면을 막지 않음 (클릭은 그대로 아래로 통과)
// ============================================================
(function () {
  var reduce = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  if (window.SFX && window.SFX.prime) window.SFX.prime();

  function layer(cls) {
    var el = document.createElement(cls === 'canvas' ? 'canvas' : 'div');
    el.className = 'storyfx ' + (cls === 'canvas' ? 'storyfx-canvas' : cls);
    document.body.appendChild(el);
    return el;
  }

  // ---- 합: 칼끝이 부딪히는 불꽃이 여기저기서 ----
  function duel() {
    var cv = layer('canvas'), ctx = cv.getContext('2d');
    var dpr = Math.min(2, window.devicePixelRatio || 1), W = window.innerWidth, H = window.innerHeight;
    cv.width = W * dpr; cv.height = H * dpr; ctx.scale(dpr, dpr);
    var sparks = [], rings = [], t0 = performance.now(), DUR = 3000, next = 0, n = 0;
    function clash(now) {
      var x = W * (0.15 + Math.random() * 0.7), y = H * (0.18 + Math.random() * 0.6), big = Math.random() < 0.35;
      rings.push({ x: x, y: y, born: now, big: big });
      var k = big ? 22 : 12;
      for (var i = 0; i < k; i++) {
        var a = Math.random() * Math.PI * 2, sp = (200 + Math.random() * 520) * (big ? 1.2 : 0.8);
        sparks.push({ x: x, y: y, vx: Math.cos(a) * sp, vy: Math.sin(a) * sp - 160, born: now, life: 450 + Math.random() * 500, w: 2 + Math.random() * 3,
          c: Math.random() > 0.6 ? '255,250,215' : Math.random() > 0.4 ? '255,214,80' : '255,150,30' });
      }
      if (window.SFX) window.SFX.play(big ? 'perfect' : (n % 2 ? 'great' : 'perfect'));
      n++;
    }
    function frame(now) {
      var el = now - t0;
      if (el < DUR && now >= next) { clash(now); next = now + 170 + Math.random() * 230; }
      ctx.clearRect(0, 0, W, H);
      // 밝은 양피지 위에서도 불꽃이 보이게, 합을 겨루는 동안만 화면을 살짝 어둡게
      var env = Math.min(1, el / 300) * Math.max(0, Math.min(1, (DUR + 800 - el) / 800));
      ctx.fillStyle = 'rgba(25,12,0,' + (0.38 * env) + ')'; ctx.fillRect(0, 0, W, H);
      ctx.globalCompositeOperation = 'lighter';
      rings = rings.filter(function (r) { return now - r.born < 420; });
      rings.forEach(function (r) {
        var age = now - r.born, a = 1 - age / 420, R = (r.big ? 110 : 70);
        var g = ctx.createRadialGradient(r.x, r.y, 0, r.x, r.y, R);
        g.addColorStop(0, 'rgba(255,252,220,' + a + ')'); g.addColorStop(0.35, 'rgba(255,210,70,' + 0.5 * a + ')'); g.addColorStop(1, 'rgba(255,150,0,0)');
        ctx.fillStyle = g; ctx.fillRect(r.x - R, r.y - R, R * 2, R * 2);
        ctx.strokeStyle = 'rgba(255,220,90,' + a + ')'; ctx.lineWidth = 4 * a + 1;
        ctx.beginPath(); ctx.arc(r.x, r.y, 26 + age * 0.35, 0, Math.PI * 2); ctx.stroke();
      });
      sparks = sparks.filter(function (p) { return now - p.born < p.life; });
      ctx.lineCap = 'round';
      sparks.forEach(function (p) {
        var dt = (now - p.born) / 1000, k = (now - p.born) / p.life;
        var px = p.x + p.vx * dt, py = p.y + p.vy * dt + 520 * dt * dt;
        var tx = px - p.vx * 0.025, ty = py - (p.vy + 1040 * dt) * 0.025, al = 1 - k * k;
        ctx.beginPath(); ctx.moveTo(tx, ty); ctx.lineTo(px, py);
        ctx.strokeStyle = 'rgba(255,170,40,' + 0.25 * al + ')'; ctx.lineWidth = p.w * 3; ctx.stroke();
        ctx.strokeStyle = 'rgba(' + p.c + ',' + al + ')'; ctx.lineWidth = p.w; ctx.stroke();
      });
      ctx.globalCompositeOperation = 'source-over';
      if (el < DUR + 1000 || sparks.length) requestAnimationFrame(frame);
      else cv.remove();
    }
    requestAnimationFrame(frame);
  }

  // ---- 태양: 화면 전체가 그을림 ----
  function sun() {
    var glow = layer('storyfx-sun');
    document.documentElement.classList.add('scorched');
    requestAnimationFrame(function () { glow.classList.add('on'); });
    setTimeout(function () { glow.classList.add('off'); document.documentElement.classList.remove('scorched'); }, 6500);
    setTimeout(function () { glow.remove(); }, 9500);
  }

  var FX = { '합': duel, '태양': sun };
  window.STORY_FX = function (name) {
    if (reduce) return;
    try { if (FX[name]) FX[name](); } catch (e) {}
  };
})();
