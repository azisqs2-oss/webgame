// ============================================================
//  새로 생긴 로그 줄을 한 글자씩 타이핑하듯 보여 주는 연출
//  - 서버가 새 줄에 class="new" 를 붙여 보내 줍니다.
//  - 타이핑이 끝나기 전에는 선택지·버튼을 숨겨 둡니다.
//  - 건너뛰기는 없고, 화면의 1×~4× 버튼으로 속도만 바꿀 수 있어요 (브라우저에 기억됨).
//  기본 속도를 바꾸고 싶으면 아래 SPEED 숫자를 고치세요 (밀리초, 작을수록 빠름).
// ============================================================
(function () {
  var SPEED = { event: 28, system: 22, daily: 14, choice: 18 }; // 1× 기준 글자당 시간
  var PAUSE_AFTER_LINE = 280;                                    // 줄 사이 쉬는 시간
  var PAUSE_BEFORE_VERDICT = 450;                                // [성공]/[실패] 뜨기 전 뜸들이기
  var MAX_MULT = 4;

  // ---- 배속 (1×~4×) ----
  var mult = 1;
  try { mult = Math.min(MAX_MULT, Math.max(1, parseInt(localStorage.getItem('textSpeed'), 10) || 1)); } catch (e) {}
  var bar = document.getElementById('speedBar');
  function paintSpeed() {
    if (!bar) return;
    Array.prototype.forEach.call(bar.querySelectorAll('button'), function (b) {
      b.classList.toggle('on', Number(b.getAttribute('data-speed')) === mult);
    });
  }
  if (bar) {
    bar.addEventListener('click', function (e) {
      var b = e.target.closest('button[data-speed]');
      if (!b) return;
      mult = Math.min(MAX_MULT, Math.max(1, Number(b.getAttribute('data-speed')) || 1));
      try { localStorage.setItem('textSpeed', String(mult)); } catch (err) {}
      paintSpeed();
    });
    paintSpeed();
  }

  var log = document.getElementById('log');
  var actions = document.getElementById('actions');
  if (!log) return;

  // 화면 따라가기
  //  - PC: 로그 상자 안에서만 아래로 스크롤
  //  - 휴대폰(좁은 화면): 로그 상자가 페이지 전체로 늘어나므로, 페이지 자체를 내려서
  //    타이핑 중인 줄 → 끝나면 선택지가 화면에 보이게 함 (새로고침될 때마다 다시 내리지 않아도 됨)
  var mobile = window.matchMedia ? window.matchMedia('(max-width: 760px)') : { matches: false };
  function revealBottom(el, pad) {
    if (!el) return;
    var r = el.getBoundingClientRect();
    var delta = r.height > window.innerHeight * 0.85 ? r.top - 12 : r.bottom - window.innerHeight + (pad || 24);
    if (delta > 0) window.scrollBy(0, delta);           // 위로는 안 올림 (읽던 위치 유지)
  }
  // 휴대폰(사용자 요청 2026-11-23): 타이핑하는 동안 페이지를 억지로 움직이지 않음.
  //  페이지가 열릴 때 한 번만 대화 상자가 화면 위쪽에 오도록 순간 이동 → 타이핑은 PC처럼 대화 상자 안에서만 스크롤.
  //  타이핑이 끝났는데 선택지가 화면 밖이면 아래에 '▼ 선택지' 버튼만 띄움 (누르면 그때 내려감).
  var scrollDown = function () {
    log.scrollTop = log.scrollHeight;                   // PC: 로그 상자 안에서만 스크롤 (페이지는 안 움직임)
  };
  function jumpTo(el) {                                 // 휴대폰: 열릴 때 한 번만, 애니메이션 없이
    if (!el || !mobile.matches) return;
    var y = el.getBoundingClientRect().top + window.scrollY - 12;
    window.scrollTo({ top: Math.max(0, y), behavior: 'instant' });
  }
  function choicesHint() {                              // 휴대폰: 선택지가 화면 밖이면 버튼
    if (!mobile.matches || !actions) return;
    var r = actions.getBoundingClientRect();
    if (r.top < window.innerHeight - 40) return;        // 이미 보임
    var b = document.createElement('button');
    b.type = 'button'; b.className = 'choices-hint'; b.textContent = '▼ 선택지';
    b.addEventListener('click', function () { actions.scrollIntoView({ behavior: 'smooth', block: 'start' }); b.remove(); });
    document.body.appendChild(b);
    window.addEventListener('scroll', function onScroll() {
      if (actions.getBoundingClientRect().top < window.innerHeight - 40) { b.remove(); window.removeEventListener('scroll', onScroll); }
    }, { passive: true });
  }
  var items = Array.prototype.slice.call(log.querySelectorAll('.new'));
  // (예전엔 '애니메이션 줄이기' 설정(prefers-reduced-motion)이면 타이핑을 건너뛰었는데,
  //  학교·회사 PC 등은 이 설정이 꺼져 있는 경우가 많아 타이핑 자체가 사라져 보여서 뺌 — 타이핑은 게임 연출의 일부)
  if (!items.length) { scrollDown(); if (mobile.matches) revealBottom(actions); return; }   // 새 글이 없으면 (새로고침 등) 예전처럼 선택지 쪽으로 한 번

  // 준비: 새 줄은 숨기고, 원래 내용은 따로 보관
  // 연출 표시 (play.ejs 가 {연출:합} 등을 글자 하나짜리 표시로 바꿔 둠) — 그 자리까지 타이핑되면 storyfx.js 효과
  var FX_MARK = { '\uE001': '합', '\uE002': '태양' }, FX_RE = /[\uE001-\uE00F]/g;
  var queue = items.map(function (el) {
    var verdict = el.querySelector('.verdict');
    var data = { el: el, html: el.innerHTML.replace(FX_RE, ''), verdict: verdict ? verdict.outerHTML : '', text: '' };
    if (verdict) verdict.remove();
    data.text = el.textContent.replace(/^\s+/, '');
    el.textContent = '';
    el.classList.add('pending');
    return data;
  });
  if (actions) actions.classList.add('waiting');
  scrollDown();
  jumpTo(document.querySelector('.mobile-hud') || log);                                        // 휴대폰: 대화 상자가 화면 맨 위에 오게 한 번만 (타이핑은 상자 안에서만 스크롤)

  var timer = null;
  var wait = function (ms) { return Math.max(4, ms / mult); };

  function finish() {
    clearTimeout(timer);
    if (actions) actions.classList.remove('waiting');
    scrollDown();
    choicesHint();
    document.dispatchEvent(new Event('typing-done'));
    var first = actions && actions.querySelector('button:not([disabled])');
    if (first) first.focus({ preventScroll: true });
  }

  function typeLine(i) {
    if (i >= queue.length) return finish();
    var q = queue[i];
    q.el.classList.remove('pending');

    if (q.el.classList.contains('divider')) { // 나이·계절 구분선은 바로 표시
      q.el.innerHTML = q.html;
      scrollDown();
      timer = setTimeout(function () { typeLine(i + 1); }, wait(160));
      return;
    }

    var kind = q.el.classList.contains('choice') ? 'choice'
      : q.el.classList.contains('event') ? 'event'
      : q.el.classList.contains('system') ? 'system' : 'daily';
    var pos = 0;
    q.el.classList.add('typing');

    function start() {
      if (q.verdict) q.el.innerHTML = q.verdict + ' ';
      tick();
    }
    function tick() {
      pos++;
      var mark = FX_MARK[q.text.charAt(pos - 1)];
      if (mark && window.STORY_FX) window.STORY_FX(mark);
      q.el.innerHTML = (q.verdict ? q.verdict + ' ' : '') + escapeHtml(q.text.slice(0, pos).replace(FX_RE, ''));
      scrollDown();
      if (pos < q.text.length) {
        var ch = q.text.charAt(pos - 1);
        var extra = /[.,!?—]/.test(ch) ? SPEED[kind] * 4 : ch === '\n' ? SPEED[kind] * 6 : 0; // 문장부호·줄바꿈에서 살짝 멈춤
        timer = setTimeout(tick, wait(SPEED[kind] + extra));
      } else {
        q.el.innerHTML = q.html;
        q.el.classList.remove('typing');
        timer = setTimeout(function () { typeLine(i + 1); }, wait(PAUSE_AFTER_LINE));
      }
    }
    timer = setTimeout(start, q.verdict ? wait(PAUSE_BEFORE_VERDICT) : 0);
  }

  function escapeHtml(s) {
    return s.replace(/[&<>"]/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]; });
  }

  timer = setTimeout(function () { typeLine(0); }, 200);
})();
