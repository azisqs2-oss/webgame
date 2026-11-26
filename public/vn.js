// ============================================================
//  비주얼노벨 화면 (전투 화면과 같은 크기 · lib/vn.js 가 읽은 대본을 그대로 실행)
//  클릭·스페이스·엔터 = 다음 (타이핑 중이면 그 줄을 바로 다 보여 줌)
//  대본이 끝나면 아래 평소 선택지(#vnChoices)가 나타남. 서버에는 아무것도 보내지 않음.
// ============================================================
(function () {
  var root = document.getElementById('vn');
  var dataEl = document.getElementById('vnScript');
  if (!root || !dataEl) return;
  var script = JSON.parse(dataEl.textContent);
  var ops = script.ops, labels = script.labels;
  var bgEl = root.querySelector('.vn-bg'), bgNext = root.querySelector('.vn-bg-next'), shade = root.querySelector('.vn-shade');
  var charEl = root.querySelector('.vn-char'), box = root.querySelector('.vn-box');
  var nameEl = root.querySelector('.vn-name'), textEl = root.querySelector('.vn-text'), moreEl = root.querySelector('.vn-more');
  var choiceEl = root.querySelector('.vn-choices'), startEl = root.querySelector('.vn-start');
  var after = document.getElementById('vnChoices');

  var pc = 0, vars = {}, typing = null, full = '', waiting = false, ended = false, started = false;
  var speed = 1; try { speed = Number(localStorage.getItem('textSpeed')) || 1; } catch (_) {}
  var CHAR_MS = 38 / speed;

  // ---- 그림 (없으면 임시 그림) ----
  var imgCache = {};
  function findImage(name, cb) {
    if (imgCache[name] !== undefined) return cb(imgCache[name]);
    var tries = /\.(jpe?g|png|webp)$/i.test(name) ? [name] : [name + '.jpg', name + '.png', name + '.webp'];
    (function next(i) {
      if (i >= tries.length) { imgCache[name] = null; return cb(null); }
      var im = new Image();
      im.onload = function () { imgCache[name] = '/img/vn/' + tries[i]; cb(imgCache[name]); };
      im.onerror = function () { next(i + 1); };
      im.src = '/img/vn/' + tries[i];
    })(0);
  }
  function placeholder(name) {   // 그림이 없을 때: 이름이 적힌 어두운 임시 배경
    var hue = 0; for (var i = 0; i < name.length; i++) hue = (hue * 31 + name.charCodeAt(i)) % 360;
    return 'radial-gradient(ellipse at 50% 35%, hsl(' + hue + ',28%,34%) 0%, hsl(' + hue + ',30%,14%) 70%, #07090c 100%)';
  }
  function setBg(name) {
    findImage(name, function (url) {
      bgNext.style.backgroundImage = url ? 'url("' + url + '")' : placeholder(name);
      bgNext.setAttribute('data-label', url ? '' : '배경: ' + name + ' (그림 없음)');
      bgNext.classList.add('show');
      setTimeout(function () {
        bgEl.style.backgroundImage = bgNext.style.backgroundImage;
        bgEl.setAttribute('data-label', bgNext.getAttribute('data-label'));
        bgNext.classList.remove('show');
      }, 600);
    });
    if (shade.classList.contains('black')) shade.className = 'vn-shade';   // 암전 뒤 새 배경이면 밝아짐
  }
  function setChar(name, pos) {
    if (!name) { charEl.classList.remove('show'); return; }
    findImage(name, function (url) {
      if (!url) { charEl.classList.remove('show'); return; }
      charEl.style.backgroundImage = 'url("' + url + '")';
      charEl.className = 'vn-char show ' + (pos || 'center');
    });
  }
  function fx(name) {
    if (name === '어둠') shade.className = 'vn-shade dark';
    else if (name === '밝게') shade.className = 'vn-shade';
    else if (name === '암전') shade.className = 'vn-shade black';
    else if (name === '흔들림') { root.classList.remove('shake'); void root.offsetWidth; root.classList.add('shake'); }
    else if (window.STORY_FX) window.STORY_FX(name);
  }

  // ---- 대사 ----
  function say(o) {
    nameEl.textContent = o.who || '';
    nameEl.hidden = !o.who;
    box.className = 'vn-box' + (o.style === 'dark' ? ' dark' : '') + (o.who ? '' : ' narration');
    full = o.text; textEl.textContent = ''; moreEl.hidden = true;
    var i = 0;
    clearInterval(typing);
    typing = setInterval(function () {
      i++; textEl.textContent = full.slice(0, i);
      if (i >= full.length) finishLine();
    }, CHAR_MS);
    waiting = true;
  }
  function finishLine() {
    clearInterval(typing); typing = null;
    textEl.textContent = full; moreEl.hidden = false;
  }

  function cmp(a, op, b) { return op === '>=' ? a >= b : op === '<=' ? a <= b : op === '>' ? a > b : op === '<' ? a < b : a === b; }

  // 다음 대사/선택지/끝이 나올 때까지 명령 실행
  function run() {
    var guard = 0;
    while (pc < ops.length && guard++ < 5000) {
      var o = ops[pc++];
      if (o.op === 'bg') setBg(o.name);
      else if (o.op === 'char') setChar(o.name, o.pos);
      else if (o.op === 'fx') fx(o.name);
      else if (o.op === 'add') vars[o.key] = (vars[o.key] || 0) + o.n;
      else if (o.op === 'goto') { if (o.label in labels) pc = labels[o.label]; }
      else if (o.op === 'if') { if (cmp(vars[o.key] || 0, o.cmp, o.n) && o.label in labels) pc = labels[o.label]; }
      else if (o.op === 'say') { say(o); return; }
      else if (o.op === 'choice') { showChoice(o); return; }
      else if (o.op === 'end') break;
    }
    end();
  }
  function showChoice(o) {
    waiting = false; moreEl.hidden = true;
    choiceEl.innerHTML = '';
    o.options.forEach(function (opt) {
      var b = document.createElement('button');
      b.type = 'button'; b.className = 'vn-option'; b.textContent = opt.text;
      b.addEventListener('click', function (e) {
        e.stopPropagation();
        choiceEl.hidden = true;
        if (opt.label in labels) pc = labels[opt.label];
        run();
      });
      choiceEl.appendChild(b);
    });
    choiceEl.hidden = false;
  }
  function end() {
    ended = true; waiting = false; clearInterval(typing);
    box.className = 'vn-box narration'; nameEl.hidden = true;
    textEl.textContent = '— 이야기가 끝났다 —'; moreEl.hidden = true;
    if (after) { after.hidden = false; var first = after.querySelector('button:not([disabled])'); if (first) first.focus({ preventScroll: true }); }
  }

  function advance() {
    if (!started || ended) return;
    if (!choiceEl.hidden) return;              // 선택지 고르는 중
    if (typing) { finishLine(); return; }
    if (waiting) { waiting = false; run(); }
  }
  root.addEventListener('click', advance);
  document.addEventListener('keydown', function (e) {
    if (!started || ended) return;
    if (e.code === 'Space' || e.code === 'Enter') {
      if (document.activeElement && document.activeElement.tagName === 'BUTTON' && !choiceEl.hidden) return;
      e.preventDefault(); advance();
    }
  });

  function start() {
    if (started) return;
    started = true; startEl.hidden = true; root.classList.add('started');
    if (window.SFX && window.SFX.prime) window.SFX.prime();
    run();
  }
  startEl.addEventListener('click', function (e) { e.stopPropagation(); start(); });
  // 첫 배경은 미리 깔아 둠
  for (var k = 0; k < ops.length; k++) { if (ops[k].op === 'bg') { setBg(ops[k].name); break; } if (ops[k].op === 'say' || ops[k].op === 'choice') break; }
})();
