// ============================================================
//  팝업 창 — 링크에 data-modal 이 있으면 그 페이지의 '?modal=1' 조각을 불러와 화면 위에 띄움
//  (지금은 상단 메뉴의 '대장간'). 닫기: ×, 바깥 클릭, Esc.
//  팝업 안에서 구매하면 서버가 원래 보던 페이지로 돌려보내며 '?smithy=1' 을 붙여 줌 → 다시 열림.
// ============================================================
(function () {
  var open = null;

  function close() {
    if (!open) return;
    open.remove(); open = null;
    document.documentElement.classList.remove('modal-open');
  }

  function show(html) {
    close();
    var back = document.createElement('div');
    back.className = 'modal-backdrop';
    back.innerHTML = '<div class="modal" role="dialog" aria-modal="true">' + html + '</div>';
    document.body.appendChild(back);
    document.documentElement.classList.add('modal-open');
    open = back;
    // 구매 뒤 돌아올 곳 = 지금 보는 페이지
    var here = location.pathname + location.search.replace(/([?&])smithy=1(&|$)/, '$1').replace(/[?&]$/, '');
    Array.prototype.forEach.call(back.querySelectorAll('input[name="back"]'), function (i) { i.value = here; });
    back.addEventListener('click', function (e) {
      if (e.target === back || e.target.closest('[data-modal-close]')) close();
    });
    var first = back.querySelector('.smithy-buy:not([disabled])') || back.querySelector('[data-modal-close]');
    if (first) first.focus({ preventScroll: true });
  }

  function load(link) {
    var url = link.getAttribute('href');
    fetch(url + (url.indexOf('?') < 0 ? '?' : '&') + 'modal=1', { credentials: 'same-origin', headers: { 'X-Modal': '1' } })
      .then(function (r) { return r.ok ? r.text() : Promise.reject(); })
      .then(function (html) {
        if (html.indexOf('data-smithy-panel') < 0) { location.href = url; return; }   // 아직 못 여는 경우 등 → 그냥 이동
        show(html);
      })
      .catch(function () { location.href = url; });
  }

  document.addEventListener('click', function (e) {
    var a = e.target.closest && e.target.closest('a[data-modal]');
    if (!a || e.ctrlKey || e.metaKey || e.shiftKey) return;
    e.preventDefault(); load(a);
  });
  document.addEventListener('keydown', function (e) { if (e.key === 'Escape') close(); });

  // 구매하고 돌아온 경우 다시 열기
  if (/[?&]smithy=1(&|$)/.test(location.search)) {
    var link = document.querySelector('a[data-modal="smithy"]');
    var clean = location.pathname + location.search.replace(/([?&])smithy=1(&|$)/, '$1').replace(/[?&]$/, '') + location.hash;
    try { history.replaceState(null, '', clean); } catch (_) {}
    if (link) load(link);
  }
})();
