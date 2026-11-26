// ============================================================
//  효과음 (파일 없이 브라우저가 직접 소리를 만듦 · Web Audio)
//  - SFX.play('perfect') 처럼 부름. 처음 버튼을 누를 때 소리가 켜짐 (브라우저 자동 재생 제한)
//  - 끄고 켠 설정은 이 브라우저에만 저장 (localStorage)
//  - public/audio/ 에 파일이 있으면 그 파일을 재생 (FILES), 없거나 아직 못 읽었으면 합성음
// ============================================================
(function () {
  var ctx = null, master = null, drive = null, noiseBuf = null;
  var muted = false;
  var volume = 0.8;                                         // 효과음 크기 0~1 (조절 막대)
  try { muted = localStorage.getItem('sfxMuted') === '1'; } catch (_) {}
  try { var sv = localStorage.getItem('sfxVolume'); if (sv !== null && !isNaN(+sv)) volume = Math.max(0, Math.min(1, +sv)); } catch (_) {}

  function ensure() {
    if (ctx) { if (ctx.state === 'suspended') ctx.resume(); return true; }
    var AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return false;
    ctx = new AC();
    // 컴프레서로 타격음을 단단하게 + 살짝 찌그러뜨려(드라이브) 둔탁하게
    var comp = ctx.createDynamicsCompressor();
    comp.threshold.value = -18; comp.knee.value = 6; comp.ratio.value = 6; comp.attack.value = 0.002; comp.release.value = 0.12;
    comp.connect(ctx.destination);
    drive = ctx.createWaveShaper();
    var curve = new Float32Array(1024);
    for (var ci = 0; ci < 1024; ci++) { var x = ci / 512 - 1; curve[ci] = Math.tanh(x * 2.2); }
    drive.curve = curve; drive.connect(comp);
    master = ctx.createGain(); master.gain.value = 0.6; master.connect(drive);
    noiseBuf = ctx.createBuffer(1, ctx.sampleRate * 0.5, ctx.sampleRate);
    var d = noiseBuf.getChannelData(0);
    for (var i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
    decodeAll();
    return true;
  }
  // 첫 클릭·터치·키 입력 때 오디오를 깨움
  // ---- 효과음 파일 (사용자가 구해 온 mp3 · 시작 부분 잘라 냄) ----
  // 이름: [파일, 크기, 재생 속도]
  var FILES = {
    count:   ['countdown', 0.8, 1],
    go:      ['countdown', 1, 0.8],      // 시작: 같은 소리를 조금 낮게
    perfect: ['just_guard', 1, 1],
    great:   ['guard', 0.9, 1],
    good:    ['miss', 0.9, 1],
    hit:     ['hit', 1, 1],
    magicPerfect: ['just_guard', 1, 1],  // 마법사도 같은 소리 (사용자: 마법 따위 사도다)
    magicGreat:   ['guard', 0.9, 1],
    // 그 밖의 소리(출혈·석궁·재생·난입·승리·패배·마나 단련)는 넣지 않음 (사용자 지시) → 표에 없으면 무음
  };
  var raw = {}, bufs = {};
  Object.keys(FILES).forEach(function (k) {
    if (!FILES[k]) return;
    var f = FILES[k][0];
    if (raw[f] !== undefined) return;
    raw[f] = null;
    try {
      fetch('/audio/' + f + '.mp3').then(function (r) { return r.ok ? r.arrayBuffer() : null; })
        .then(function (ab) { raw[f] = ab; if (ctx) decodeAll(); }).catch(function () {});
    } catch (_) {}
  });
  function decodeAll() {
    Object.keys(raw).forEach(function (f) {
      var ab = raw[f];
      if (!ab || bufs[f]) return;
      raw[f] = false; // 한 번만
      ctx.decodeAudioData(ab, function (b) { bufs[f] = b; }, function () {});
    });
  }
  function playFile(name) {
    var spec = FILES[name]; if (!spec || !bufs[spec[0]]) return false;
    var src = ctx.createBufferSource(), g = ctx.createGain();
    src.buffer = bufs[spec[0]]; src.playbackRate.value = spec[2]; g.gain.value = spec[1] * volume * volume;   // 귀에 자연스럽게 (제곱)
    src.connect(g); g.connect(ctx.destination); src.start();
    return true;
  }

  ['pointerdown', 'keydown'].forEach(function (ev) { window.addEventListener(ev, function () { if (!muted) ensure(); }, { once: false, passive: true }); });

  // 음 하나: 주파수(끝 주파수로 미끄러짐), 길이, 파형, 크기, 시작 지연
  function tone(f, dur, type, vol, delay, f2) {
    var t = ctx.currentTime + (delay || 0);
    var o = ctx.createOscillator(), g = ctx.createGain();
    o.type = type || 'sine'; o.frequency.setValueAtTime(f, t);
    if (f2) o.frequency.exponentialRampToValueAtTime(f2, t + dur);
    g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(vol || 0.3, t + 0.006);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    o.connect(g); g.connect(master); o.start(t); o.stop(t + dur + 0.02);
  }
  // 잡음: 필터 종류·주파수(끝 주파수로 미끄러짐)
  function noise(dur, ftype, f, vol, delay, f2, q) {
    var t = ctx.currentTime + (delay || 0);
    var s = ctx.createBufferSource(), fl = ctx.createBiquadFilter(), g = ctx.createGain();
    s.buffer = noiseBuf; fl.type = ftype; fl.frequency.setValueAtTime(f, t); fl.Q.value = q || 1;
    if (f2) fl.frequency.exponentialRampToValueAtTime(f2, t + dur);
    g.gain.setValueAtTime(vol || 0.3, t); g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    s.connect(fl); fl.connect(g); g.connect(master); s.start(t); s.stop(t + dur + 0.02);
  }

  // 둔탁한 '쿵' (사인파가 아래로 빠르게 떨어짐)
  function thump(f, dur, vol, delay) { tone(f, dur, 'sine', vol, delay, Math.max(30, f * 0.35)); }
  // 무딘 금속 '깡' : 서로 안 맞는 배음 몇 개를 저역 필터로 눌러서 짧게
  function clank(base, dur, vol, cutoff, delay) {
    var t = ctx.currentTime + (delay || 0);
    var fl = ctx.createBiquadFilter(); fl.type = 'lowpass'; fl.frequency.value = cutoff || 2200; fl.Q.value = 0.8;
    var g = ctx.createGain(); g.gain.setValueAtTime(vol || 0.3, t); g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    fl.connect(g); g.connect(master);
    [1, 1.47, 2.09, 2.76].forEach(function (m, i) {
      var o = ctx.createOscillator(); o.type = i ? 'triangle' : 'square';
      o.frequency.setValueAtTime(base * m, t);
      var og = ctx.createGain(); og.gain.value = [0.5, 0.35, 0.25, 0.15][i];
      o.connect(og); og.connect(fl); o.start(t); o.stop(t + dur + 0.02);
    });
  }

  var SOUNDS = {
    count: function () { thump(220, 0.12, 0.35); noise(0.03, 'lowpass', 1500, 0.2); },                                            // 북 '둥'
    go: function () { thump(160, 0.3, 0.6); noise(0.08, 'lowpass', 1200, 0.35); clank(260, 0.18, 0.15, 1400); },
    // 막기: 무기끼리 부딪히는 묵직한 소리
    perfect: function () { thump(150, 0.22, 0.7); noise(0.05, 'bandpass', 2500, 0.5, 0, 0, 0.7); clank(330, 0.4, 0.35, 3200); clank(495, 0.25, 0.15, 2600, 0.01); },  // 쾅-깡!
    great: function () { thump(130, 0.16, 0.55); noise(0.04, 'bandpass', 1800, 0.4); clank(260, 0.18, 0.25, 1800); },                                       // 깡
    good: function () { thump(110, 0.14, 0.5); noise(0.07, 'lowpass', 900, 0.4); },                                                                           // 턱 (겨우 막음)
    // 맞음: 몸에 박히는 둔탁한 소리
    hit: function () { thump(95, 0.32, 0.9); noise(0.16, 'lowpass', 600, 0.7, 0, 150); noise(0.03, 'bandpass', 1200, 0.3); },                                // 퍽
    magicPerfect: function () { thump(140, 0.2, 0.5); tone(523, 0.5, 'sine', 0.22); tone(784, 0.4, 'sine', 0.14, 0.02); noise(0.06, 'bandpass', 2000, 0.25); },
    magicGreat: function () { thump(120, 0.15, 0.4); tone(392, 0.3, 'sine', 0.2); noise(0.04, 'bandpass', 1500, 0.2); },
    bleed: function () { noise(0.14, 'lowpass', 500, 0.4, 0, 180, 2); thump(80, 0.1, 0.25); },                                                                   // 출혈 (축축하고 낮게)
    bolt: function () { noise(0.1, 'bandpass', 1800, 0.35, 0, 600, 1.5); thump(140, 0.08, 0.45, 0.09); noise(0.03, 'lowpass', 1500, 0.3, 0.09); },          // 휙-턱
    regen: function () { tone(140, 0.4, 'sine', 0.25, 0, 260); noise(0.35, 'lowpass', 400, 0.18, 0, 900); },                                                  // 꿈틀
    rescue: function () { thump(70, 1.0, 1.0); noise(0.7, 'lowpass', 700, 0.7, 0, 80); clank(196, 0.9, 0.3, 1500, 0.05); },                                 // 쿠웅
    win: function () { thump(130, 0.25, 0.5); [262, 330, 392, 523].forEach(function (f, i) { tone(f, 0.35, 'triangle', 0.2, 0.05 + i * 0.12); }); },
    lose: function () { thump(70, 0.6, 0.7); [262, 220, 175].forEach(function (f, i) { tone(f, 0.45, 'triangle', 0.2, 0.1 + i * 0.2); }); },
    charge: function () { tone(110, 0.3, 'sine', 0.12, 0, 140); },
    done: function () { thump(120, 0.3, 0.5); [523, 784, 1046].forEach(function (f, i) { tone(f, 0.5, 'sine', 0.18, i * 0.09); }); },
  };

  window.SFX = {
    play: function (name) {
      if (muted || !SOUNDS[name]) return;
      try {
        if (!ensure()) return;
        playFile(name);                                       // 파일이 있는 소리만 냄 (합성음은 안 씀)
      } catch (_) {}
    },
    get muted() { return muted; },
    get volume() { return volume; },
    setVolume: function (v) {
      volume = Math.max(0, Math.min(1, +v || 0));
      try { localStorage.setItem('sfxVolume', String(volume)); } catch (_) {}
    },
    setMuted: function (v) {
      muted = !!v;
      try { localStorage.setItem('sfxMuted', muted ? '1' : '0'); } catch (_) {}
      if (!muted) ensure();
    },
    // 켜기/끄기 버튼 연결: <button data-sfx-toggle> · 크기 막대: <input type="range" data-sfx-volume>
    bind: function (root) {
      Array.prototype.forEach.call((root || document).querySelectorAll('[data-sfx-volume]'), function (r) {
        var label = r.parentNode && r.parentNode.querySelector('[data-sfx-volume-label]');
        function paint() { r.value = Math.round(volume * 100); if (label) label.textContent = Math.round(volume * 100) + '%'; }
        paint();
        r.addEventListener('input', function () { window.SFX.setVolume(r.value / 100); if (label) label.textContent = r.value + '%'; });
        r.addEventListener('change', function () { if (!muted) window.SFX.play('great'); });   // 놓으면 미리 듣기
      });
      Array.prototype.forEach.call((root || document).querySelectorAll('[data-sfx-toggle]'), function (b) {
        function paint() { b.textContent = muted ? '🔇 효과음 꺼짐' : '🔊 효과음 켜짐'; b.setAttribute('aria-pressed', String(!muted)); }
        paint();
        b.addEventListener('click', function () { window.SFX.setMuted(!muted); paint(); if (!muted) window.SFX.play('great'); });
      });
    },
  };
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', function () { window.SFX.bind(); });
  else window.SFX.bind();
})();
