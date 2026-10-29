/* js/ui.js — 画面の描画とボタン操作の受け付け（RE.UI）。中身の判断は RE.Main が行う */
/* 基づく仕様書：KEecolexico 仕様書 v1.0 */
(function () {
  'use strict';
  var C = RE.Config;
  var K = C.KX;
  var M = C.KXMSG;
  var S = C.PLAYER_STATE;
  var el = {};
  var h = null;
  var SCREENS = ['screen-library', 'screen-drive', 'screen-import', 'screen-mark', 'screen-study', 'screen-words', 'screen-settings'];
  // 画面 → 下のタブ（仕様 8.9）
  var TAB_OF = { 'screen-library': 'library', 'screen-drive': 'library', 'screen-import': 'library',
                 'screen-study': 'play', 'screen-words': 'words', 'screen-mark': 'mark', 'screen-settings': 'settings' };
  var TABS = ['library', 'play', 'words', 'mark', 'settings'];

  // id から要素を取る
  function $(id) { return document.getElementById(id); }

  // 文字の {名前} を値に置き換える
  function fill(tpl, vals) {
    return String(tpl).replace(/\{(\w+)\}/g, function (m, k) { return vals[k] !== undefined ? vals[k] : m; });
  }

  // 要素を作る（文字は textContent で入れる）
  function make_(tag, cls, text) {
    var e = document.createElement(tag);
    if (cls) e.className = cls;
    if (text !== undefined && text !== null) e.textContent = text;
    return e;
  }

  // 全部品を集め、イベントを付ける
  function init(handlers) {
    h = handlers;
    document.querySelectorAll('[id]').forEach(function (e) { el[e.id] = e; });
    el['input-audio'].setAttribute('accept', C.ACCEPT_AUDIO);
    el['input-drive-audio'].setAttribute('accept', C.ACCEPT_AUDIO);
    el['input-csv'].setAttribute('accept', K.CSV_ACCEPT);
    el['input-txt'].setAttribute('accept', K.TXT_ACCEPT);
    el['txt-version'].textContent = 'v' + C.APP_VERSION;
    bindEvents_();
  }

  // クリックなどの受け付け
  function bindEvents_() {
    var on = function (id, fn) { el[id].addEventListener('click', fn); };
    // 下のタブ
    TABS.forEach(function (name) { on('tab-' + name, function () { h.onTab(name); }); });
    // 固定の再生バー（仕様 8.10）
    on('btn-mini-sec', function () { renderSectionSheet(true); });
    on('btn-mini-play', function () { h.onPlayPause(); });
    on('btn-mini-prev-break', function () { h.onPrevBreak(); });
    on('btn-mini-next-break', function () { h.onNextBreak(); });
    // 倍速の枠と、上に開く一覧（仕様 8.10）
    on('btn-mini-rate', function (ev) { ev.stopPropagation(); renderRateMenu_(!RE.State.rateMenuOpen); });
    el['menu-rate'].addEventListener('click', function (ev) {
      ev.stopPropagation();
      var b = ev.target.closest('.rate-opt'); if (!b) return;
      renderRateMenu_(false);
      h.onRateSelect(Number(b.getAttribute('data-rate')));
    });
    document.addEventListener('click', function () { if (RE.State.rateMenuOpen) renderRateMenu_(false); });
    // シークバー：動かしている間は位置の文字だけ、離したら移る（仕様 6.5.2）
    el['seek-mini'].addEventListener('input', function () {
      RE.State.seekDragging = true;
      var v = Number(this.value);
      el['txt-mini-pos'].textContent = RE.Utils.formatTime(v);
      setSeekPct_(v);
    });
    el['seek-mini'].addEventListener('change', function () {
      RE.State.seekDragging = false;
      h.onSeek(Number(this.value));
    });
    // 一覧
    on('btn-add-drive', function () { h.onAddDrive(); });
    on('btn-add-article', function () { h.onAddArticle(); });
    el['list-articles'].addEventListener('click', function (ev) {
      var b = ev.target.closest('button'); if (!b) return;
      var card = b.closest('.article-card'); if (!card) return;
      var id = card.getAttribute('data-id');
      if (b.classList.contains('article-open')) h.onOpenArticle(id);
      else if (b.classList.contains('article-remark')) h.onRemark(id);
      else if (b.classList.contains('article-delete')) h.onDeleteArticle(id);
      else if (b.classList.contains('article-link')) h.onLinkDrive(id);
    });
    // ドライブ
    on('btn-drive-back', function () { h.onDriveBack(); });
    on('btn-drive-reload', function () { h.onDriveReload(); });
    on('btn-drive-pick-audio', function () { el['input-drive-audio'].click(); });
    el['input-drive-audio'].addEventListener('change', function () {
      var f = this.files && this.files[0]; this.value = ''; if (f) h.onDriveAudioPicked(f);
    });
    el['list-drive'].addEventListener('click', function (ev) {
      var item = ev.target.closest('.drive-item'); if (!item || item.disabled) return;
      h.onDriveImport(item.getAttribute('data-folder-id'));
    });
    // 予備の追加
    on('btn-import-back', function () { h.onImportBack(); });
    el['input-article'].addEventListener('input', function () { h.onArticleInput(this.value); });
    on('btn-pick-txt', function () { el['input-txt'].click(); });
    on('btn-pick-csv', function () { el['input-csv'].click(); });
    on('btn-pick-audio', function () { el['input-audio'].click(); });
    el['input-txt'].addEventListener('change', function () { var f = this.files && this.files[0]; this.value = ''; if (f) h.onTxtSelected(f); });
    el['input-csv'].addEventListener('change', function () { var f = this.files && this.files[0]; this.value = ''; if (f) h.onCsvSelected(f); });
    el['input-audio'].addEventListener('change', function () { var f = this.files && this.files[0]; this.value = ''; if (f) h.onAudioSelected(f); });
    el['input-title'].addEventListener('input', function () { RE.State.importDraft.title = this.value; });
    on('btn-import-save', function () { h.onImportSave(); });
    // 区切りタブ（仕様 8.4）
    on('btn-mark-reset', function () { h.onMarkReset(); });
    el['list-marks'].addEventListener('click', function (ev) {
      var b = ev.target.closest('button'); if (!b) return;
      var blk = b.getAttribute('data-block'), part = Number(b.getAttribute('data-part')), id = b.getAttribute('data-id');
      if (b.classList.contains('mark-sec-head')) h.onMarkToggle(blk);
      else if (b.classList.contains('mark-part-play')) h.onMarkPartPlay(blk, part);
      else if (b.classList.contains('mark-adj')) h.onMarkAdjust(blk, part, b.getAttribute('data-which'), Number(b.getAttribute('data-dir')) * K.ADJUST_SEC);
      else if (b.classList.contains('mark-part-del')) h.onMarkPartDelete(blk, part);
      else if (b.classList.contains('mark-memo-play')) h.onMemoTap(blk, id);
      else if (b.classList.contains('mark-memo-del')) h.onMemoDelete(blk, id);
    });
    // 作業場（仕様 8.5）
    on('btn-work-article', function () { h.onWorkTab('article'); });
    on('btn-work-section', function () { h.onWorkTab('section'); });
    el['sel-split-block'].addEventListener('change', function () { h.onSplitBlock(this.value); });
    el['panel-article-text'].addEventListener('click', function (ev) {
      var hd = ev.target.closest('.split-block'); if (hd) h.onSplitBlock(hd.getAttribute('data-block'));
    });
    on('btn-section-save', function () { h.onSectionSave(); });
    on('btn-section-add', function () { h.onSectionAddPart(); });
    el['panel-section-text'].addEventListener('click', function (ev) {
      var b = ev.target.closest('button');
      if (b && b.classList.contains('sent-play')) { h.onMemoTap(b.getAttribute('data-block'), b.getAttribute('data-id')); return; }
      if (b && b.classList.contains('sent-del')) { h.onMemoDelete(b.getAttribute('data-block'), b.getAttribute('data-id')); return; }
      var row = ev.target.closest('.sent-row'); if (row) h.onMemoSidChange(row.getAttribute('data-sid'));
    });
    on('btn-sec-prev', function () { h.onSectionPrev(); });
    on('btn-sec-next', function () { h.onSectionNext(); });
    on('btn-sec-label', function () { renderSectionSheet(true); });
    on('btn-sheet-close', function () { renderSectionSheet(false); });
    el['sheet-sections'].addEventListener('click', function (ev) {
      if (ev.target === el['sheet-sections']) { renderSectionSheet(false); return; }
      var b = ev.target.closest('.sheet-row'); if (!b) return;
      renderSectionSheet(false);
      h.onSectionGo(b.getAttribute('data-id'), Number(b.getAttribute('data-part')));
    });
    on('btn-sync-use-remote', function () { h.onSyncUseRemote(); });
    on('btn-sync-keep-local', function () { h.onSyncKeepLocal(); });
    on('btn-memo-save', function () { h.onMemoSave(); });
    on('btn-mark-start', function () { h.onMarkRange('start'); });
    on('btn-mark-end-range', function () { h.onMarkRange('end'); });
    on('btn-all', function () { h.onSelectAll(); });
    document.querySelectorAll('.digit-btn').forEach(function (b) {
      b.addEventListener('click', function () {
        var d = Number(b.getAttribute('data-unit')) * Number(b.getAttribute('data-dir'));
        if (b.getAttribute('data-target') === 'start') h.onStartStep(d); else h.onEndStep(d);
      });
    });
    on('btn-stop', function () { h.onStop(); });
    // 学習タブ
    on('btn-words-prev', function () { h.onSectionPrev(); });
    on('btn-words-next', function () { h.onSectionNext(); });
    el['list-words'].addEventListener('click', function (ev) {
      var b = ev.target.closest('button.sid-sep'); if (!b) return;
      h.onMemoTap(b.getAttribute('data-block'), b.getAttribute('data-id'));
    });
    on('btn-complete', function () { h.onComplete(); });
    // 設定
    document.querySelectorAll('.gap-btn').forEach(function (b) {
      b.addEventListener('click', function () { h.onGapSelect(Number(b.getAttribute('data-gap'))); });
    });
    ['L', 'M', 'S'].forEach(function (f) { on('btn-font-' + f, function () { h.onFontSelect(f); }); });
    K.DEADLINE_OPTIONS.forEach(function (w) { on('btn-deadline-' + w, function () { h.onDeadlineSelect(w); }); });
    on('btn-gas-save', function () { h.onGasSave(el['input-gas-url'].value, el['input-gas-key'].value); });
    on('txt-sync-status', function () { h.onSyncRetry(); });
    on('banner-update', function () { h.onUpdateTap(); });
    on('btn-backup-export', function () { h.onBackupExport(); });
    on('btn-backup-import', function () { el['input-backup'].click(); });
    el['input-backup'].addEventListener('change', function () {
      var f = this.files && this.files[0]; this.value = ''; if (f) h.onBackupImport(f);
    });
    bindPressed_();
    // 文字を入力している間は、下のタブと再生バーを隠す（キーボードと重ならないように）
    document.addEventListener('focusin', function (ev) {
      if (ev.target.matches('input:not([type="range"]), textarea')) { document.body.classList.add('kb-open'); if (RE.State.rateMenuOpen) renderRateMenu_(false); }
    });
    document.addEventListener('focusout', function () { document.body.classList.remove('kb-open'); });
  }

  // ボタンを押した瞬間に色を変える（iPhoneは :active だけでは色が変わりにくいため）
  function bindPressed_() {
    document.addEventListener('pointerdown', function (ev) {
      var b = ev.target.closest('button');
      if (!b || b.disabled) return;
      var t0 = Date.now();
      b.classList.add('pressed');
      var up = function () {
        var wait = Math.max(0, C.PRESS_MIN_MS - (Date.now() - t0));
        setTimeout(function () { b.classList.remove('pressed'); }, wait);
        document.removeEventListener('pointerup', up);
        document.removeEventListener('pointercancel', up);
      };
      document.addEventListener('pointerup', up);
      document.addEventListener('pointercancel', up);
    });
  }

  // 画面切替。画面ごとにスクロールの位置を覚えておき、戻ったときに元の位置へ（仕様 8.9）
  function showScreen(id) {
    var st = RE.State;
    if (st.screen && st.screen !== id) st.scrollPos[st.screen] = window.scrollY;
    SCREENS.forEach(function (s) { el[s].hidden = s !== id; });
    if (id !== 'screen-study' && id !== 'screen-words') renderSectionSheet(false);
    if (RE.State.rateMenuOpen) renderRateMenu_(false);
    var mini = id === 'screen-words' || id === 'screen-study';   // 固定の再生バーは学習・作業場（仕様 8.10）
    el['mini-player'].hidden = !mini;
    document.body.classList.toggle('has-mini', mini);
    var changed = st.screen !== id;
    st.screen = id;
    renderTabs();
    if (changed) window.scrollTo(0, st.scrollPos[id] || 0);
  }

  // 下のタブ：今のタブの印と、記事を開いていないときに押せないタブ
  function renderTabs() {
    var st = RE.State, cur = TAB_OF[st.screen];
    TABS.forEach(function (name) {
      var b = el['tab-' + name];
      if (name === cur) b.setAttribute('aria-current', 'page'); else b.removeAttribute('aria-current');
      b.disabled = (name === 'play' || name === 'words' || name === 'mark') && !st.article;
    });
  }

  // メッセージ（screenId は 'library' 'drive' 'import' 'mark' 'study' 'settings'）
  // 'study' のメッセージは、単語タブの再生バーにも同じものを出す
  function showMessage(screenId, text, isError) {
    var ids = screenId === 'study' ? ['msg-study', 'msg-words'] : ['msg-' + screenId];
    ids.forEach(function (id) {
      var m = el[id]; if (!m) return;
      m.textContent = text || '';
      m.classList.toggle('msg-error', !!isError);
      m.classList.toggle('msg-on', !!text);
    });
  }
  function clearMessage(screenId) { showMessage(screenId, '', false); }

  // 文字サイズを反映
  function applyFontSize() {
    var px = K.FONT_SIZES[RE.State.fontSize] || K.FONT_SIZES[K.FONT_DEFAULT];
    document.documentElement.style.setProperty('--fs', px + 'px');
    document.documentElement.style.setProperty('--fs-es', (px + 2) + 'px');
  }

  // ===== 記事一覧 =====
  function renderLibrary(articles) {
    var box = el['list-articles'];
    box.textContent = '';
    el['txt-library-empty'].hidden = articles.length > 0;
    articles.forEach(function (a) {
      var card = make_('div', 'article-card'); card.setAttribute('data-id', a.articleId);
      var open = make_('button', 'article-open'); open.type = 'button';
      open.appendChild(make_('div', 'article-title', a.title));
      open.appendChild(make_('div', 'article-sub', RE.Main.libraryProgressText(a)));
      card.appendChild(open);
      if (!a.driveFolderId) {   // 予備の方法で追加した記事だけ（仕様 8.7.1）
        var lr = make_('div', 'article-link-row');
        var lk = make_('button', 'btn btn-small article-link', M.DRIVE_LINK_BUTTON); lk.type = 'button';
        lr.appendChild(lk); card.appendChild(lr);
      }
      var row = make_('div', 'article-actions');
      var re = make_('button', 'btn btn-small article-remark', '節の位置を直す'); re.type = 'button';
      var confirming = RE.State.pendingDeleteId === a.articleId;
      var del = make_('button', 'btn btn-small article-delete' + (confirming ? ' btn-danger' : ''), confirming ? '本当に削除' : '削除'); del.type = 'button';
      row.appendChild(re); row.appendChild(del);
      card.appendChild(row);
      box.appendChild(card);
    });
  }

  // ===== ドライブ =====
  function renderDrive(importedIds) {
    var box = el['list-drive'];
    box.textContent = '';
    var busy = RE.State.driveBusy;
    el['btn-drive-back'].disabled = busy;
    el['btn-drive-reload'].disabled = busy;
    var linking = !!RE.State.driveLinkId;
    el['txt-drive-title'].textContent = linking ? M.DRIVE_LINK_TITLE : M.DRIVE_ADD_TITLE;
    el['btn-drive-pick-audio'].hidden = linking || !RE.State.drivePending;
    el['btn-drive-pick-audio'].disabled = busy;
    RE.State.driveList.forEach(function (it) {
      var b = make_('button', 'drive-item'); b.type = 'button';
      b.setAttribute('data-folder-id', it.folderId);
      var imported = importedIds.indexOf(it.folderId) >= 0;
      var head = make_('div', 'drive-head');
      head.appendChild(make_('span', 'drive-name', it.name));
      if (imported) head.appendChild(make_('span', 'drive-done', M.DRIVE_IMPORTED));
      b.appendChild(head);
      var mark = function (label, n) { return label + (n === 1 ? '○' : (n === 0 ? '✕' : n + 'つ')); };
      var line = [mark('本文', it.articleCount), mark('CSV', it.csvCount), mark('音声', it.audioCount)].join(' ');
      if (it.audioCount === 1 && it.audioSize) line += ' ' + (it.audioSize / 1048576).toFixed(1) + 'MB';
      b.appendChild(make_('div', 'drive-sub', line));
      var problem = RE.Main.driveProblemText(it);
      if (problem) b.appendChild(make_('div', 'drive-problem', problem));
      b.disabled = busy || imported || !!problem;
      box.appendChild(b);
    });
  }

  // ===== 予備の追加 =====
  function renderImport() {
    var d = RE.State.importDraft;
    el['input-article'].value = d.text;
    el['input-title'].value = d.title;
    el['txt-parse-summary'].textContent = '';
    el['txt-csv-summary'].textContent = '';
    el['txt-audio-summary'].textContent = '';
  }
  // 追加画面の各行の結果表示
  function setImportSummary(id, text, isError) {
    el[id].textContent = text || '';
    el[id].classList.toggle('summary-error', !!isError);
  }
  function setImportTitle(text) { el['input-title'].value = text; }
  function setArticleText(text) { el['input-article'].value = text; }

  // ===== 区切りタブ（仕様 8.4） =====
  // 区間の範囲の文字（A・B があれば「／」でつなぐ。無ければ「—（まだ）」）
  function partsText_(sec) {
    var f = RE.Utils.formatTime;
    if (!sec || !sec.parts.length) return M.MARK_NOT_YET;
    return sec.parts.map(function (pt) { return f(pt.s) + '〜' + f(pt.e); }).join('／');
  }
  // scrollOpen が true なら、開いた節の見出しが見える位置へ
  function renderMarks(scrollOpen) {
    var st = RE.State, a = st.article, v = st.view, f = RE.Utils.formatTime;
    var box = el['list-marks']; box.textContent = '';
    if (!a || !v) return;
    var done = 0, memoCount = 0;
    a.sections.forEach(function (s) { if (s.parts.length) done++; });
    Object.keys(a.memos || {}).forEach(function (k) { memoCount += a.memos[k].length; });
    el['txt-marks-summary'].textContent = fill(M.MARKS_SUMMARY, { done: done, total: a.sections.length, memos: memoCount });
    var openHead = null;
    v.blocks.forEach(function (b, bi) {
      var sec = RE.Main.sectionEntry(b.id), memos = RE.Main.memosOf(b.id), open = st.openMarkBlockId === b.id;
      var wrap = make_('div', 'mark-sec' + (open ? ' is-open' : ''));
      var head = make_('button', 'mark-sec-head'); head.type = 'button';
      head.setAttribute('data-block', b.id);
      head.setAttribute('aria-expanded', String(open));
      head.appendChild(make_('span', 'mark-sec-name', b.label + (sec && sec.done ? ' ✓' : '')));
      head.appendChild(make_('span', 'mark-sec-range' + (sec && sec.parts.length ? '' : ' is-empty'), partsText_(sec)));
      head.appendChild(make_('span', 'mark-sec-count', memos.length ? '文' + memos.length : ''));
      head.appendChild(make_('span', 'mark-sec-caret', open ? '▾' : '▸'));
      wrap.appendChild(head);
      if (open) {
        openHead = head;
        var body = make_('div', 'mark-sec-body');
        (sec ? sec.parts : []).forEach(function (pt, pi) {
          var row = make_('div', 'mark-part-row');
          var top = make_('div', 'mark-top');
          top.appendChild(make_('span', 'mark-label', sec.parts.length > 1 ? '区間' + K.PART_LETTERS.charAt(pi) : '区間'));
          top.appendChild(make_('span', 'mark-time', f(pt.s) + '〜' + f(pt.e)));
          var pv = make_('button', 'btn btn-mini mark-part-play', '▶'); pv.type = 'button';
          pv.setAttribute('data-block', b.id); pv.setAttribute('data-part', pi); pv.setAttribute('aria-label', 'この区間を再生');
          top.appendChild(pv);
          var pending = st.markDeleteKey === b.id + '|' + pi;
          var del = make_('button', 'btn btn-mini mark-part-del' + (pending ? ' btn-danger' : ''), pending ? '本当に×' : '×'); del.type = 'button';
          del.setAttribute('data-block', b.id); del.setAttribute('data-part', pi); del.setAttribute('aria-label', 'この区間を消す');
          top.appendChild(del);
          row.appendChild(top);
          var adj = make_('div', 'mark-adjust');
          [['s', -1, '始−1'], ['s', 1, '始＋1'], ['e', -1, '終−1'], ['e', 1, '終＋1']].forEach(function (x) {
            var bt = make_('button', 'btn btn-mini mark-adj', x[2]); bt.type = 'button';
            bt.setAttribute('data-block', b.id); bt.setAttribute('data-part', pi);
            bt.setAttribute('data-which', x[0]); bt.setAttribute('data-dir', x[1]);
            adj.appendChild(bt);
          });
          row.appendChild(adj);
          body.appendChild(row);
        });
        if (!memos.length) body.appendChild(make_('div', 'mark-empty', M.MARKS_NO_MEMO));
        memos.forEach(function (m) {
          var mr = make_('div', 'mark-memo-row');
          mr.appendChild(make_('span', 'mark-memo-sid', m.sid));
          mr.appendChild(make_('span', 'mark-time', f(m.s) + '〜' + f(m.e)));
          var mp = make_('button', 'btn btn-mini mark-memo-play', '▶'); mp.type = 'button';
          mp.setAttribute('data-block', b.id); mp.setAttribute('data-id', m.id); mp.setAttribute('aria-label', m.sid + ' をくり返す');
          var md = make_('button', 'btn btn-mini mark-memo-del', '×'); md.type = 'button';
          md.setAttribute('data-block', b.id); md.setAttribute('data-id', m.id); md.setAttribute('aria-label', m.sid + ' の区間メモを削除');
          mr.appendChild(mp); mr.appendChild(md);
          body.appendChild(mr);
        });
        wrap.appendChild(body);
      }
      box.appendChild(wrap);
    });
    var reset = el['btn-mark-reset'];
    reset.hidden = !a.marked;
    reset.textContent = st.markResetPending ? '本当に記録し直す' : '最初から記録し直す';
    reset.classList.toggle('btn-danger', !!st.markResetPending);
    if (scrollOpen && openHead) openHead.scrollIntoView({ block: 'nearest' });
  }

  // ===== 作業場・学習（仕様 8.5・8.10） =====
  function renderStudyTop() {
    var st = RE.State, a = st.article;
    if (!a || !st.view) return;
    el['txt-study-title'].textContent = a.title;
    renderSyncStatus();
    el['txt-progress'].textContent = RE.Main.studyProgressText();
    var nav = RE.Main.navList(), idx = RE.Main.navIndex();
    var cur = st.blockId ? nav[idx] : null;
    var label = cur ? cur.label : '';
    var secE = cur ? RE.Main.sectionEntry(cur.blockId) : null;
    if (cur && cur.blockId !== K.SECTION_NONE) {
      label += '（' + (cur.blockIndex + 1) + '/' + st.view.blocks.length + '）';
      if (secE && secE.done) label += ' ✓';
      if (secE && !secE.parts.length) label += ' —';
    }
    el['btn-sec-label'].textContent = label || '—';
    el['btn-sec-prev'].disabled = !cur || idx <= 0;
    el['btn-sec-next'].disabled = !cur || idx >= nav.length - 1;
    var r = RE.Main.currentRange();
    var playable = !!r;
    renderRange_(r);
    ['btn-stop', 'btn-all', 'btn-mark-start', 'btn-mark-end-range'].forEach(function (id) { el[id].disabled = !playable; });
    renderWork_(playable, cur);
    // 学習タブ
    var isNone = !cur || cur.blockId === K.SECTION_NONE;
    el['btn-complete'].disabled = isNone || !secE || !secE.parts.length;
    el['btn-complete'].textContent = secE && secE.done ? '完了を取り消す' : 'この節を完了';
    el['btn-complete'].classList.toggle('is-done', !!(secE && secE.done));
    el['txt-words-title'].textContent = label;
    el['txt-words-progress'].textContent = el['txt-progress'].textContent;
    el['btn-words-prev'].disabled = !cur || idx <= 0;
    el['btn-words-next'].disabled = !cur || idx >= nav.length - 1;
    renderMini_(playable, cur);
    if (st.sheetOpen) renderSectionSheet(true);
  }

  // 作業場の中身（小さなタブ・本文分割・節分割）。パネルは中身が変わったときだけ作り直す
  var splitKey_ = '', sectionKey_ = '';
  function renderWork_(playable, cur) {
    var st = RE.State, split = st.engineMode === 'split', f = RE.Utils.formatTime;
    el['btn-work-article'].setAttribute('aria-pressed', String(split));
    el['btn-work-section'].setAttribute('aria-pressed', String(!split));
    el['panel-work-article'].hidden = !split;
    el['panel-work-section'].hidden = split;
    el['btn-section-save'].hidden = !split;
    el['btn-section-add'].hidden = !split;
    el['btn-memo-save'].hidden = split;
    if (split) {
      var blocks = st.view.blocks;
      var key = st.article.articleId + '|' + st.splitBlockId + '|' + blocks.map(function (b) { return partsText_(RE.Main.sectionEntry(b.id)); }).join(',');
      if (key !== splitKey_) {
        splitKey_ = key; sectionKey_ = '';
        var sel = el['sel-split-block']; sel.textContent = '';
        var panel = el['panel-article-text']; panel.textContent = '';
        var target = null;
        blocks.forEach(function (b) {
          var sec = RE.Main.sectionEntry(b.id), has = !!(sec && sec.parts.length);
          var o = make_('option', '', (has ? '✓ ' : '') + b.label + '（' + (has ? partsText_(sec) : 'まだ') + '）');
          o.value = b.id; sel.appendChild(o);
          var box = make_('div', 'split-block' + (b.id === st.splitBlockId ? ' is-target' : ''));
          box.setAttribute('data-block', b.id);
          var hd = make_('div', 'split-block-head');
          hd.appendChild(make_('span', 'split-name', (b.id === st.splitBlockId ? '▶' : '') + b.label));
          hd.appendChild(make_('span', 'split-range', has ? partsText_(sec) : '（まだ）'));
          if (has) hd.appendChild(make_('span', 'split-check', '✓'));
          box.appendChild(hd);
          b.units.forEach(function (u) {
            if (u.kind === 'skipped') return;
            var row = make_('div', 'split-unit');
            row.appendChild(make_('span', 'split-sid', u.sid));
            row.appendChild(make_('span', 'split-text', u.text));
            box.appendChild(row);
          });
          panel.appendChild(box);
          if (b.id === st.splitBlockId) target = box;
        });
        sel.value = st.splitBlockId;
        if (target) panel.scrollTop = Math.max(0, target.offsetTop - 4);
      }
      el['btn-section-save'].textContent = M.SECTION_SAVE;
      el['btn-section-add'].textContent = M.SECTION_ADD;
      el['btn-section-save'].disabled = !playable || !st.splitBlockId;
      el['btn-section-add'].disabled = !playable || !st.splitBlockId;
      el['txt-hint-article'].textContent = M.HINT_ARTICLE;
      return;
    }
    // 節分割
    var bid = st.blockId, show = !!cur && bid !== K.SECTION_NONE;
    var memos = show ? RE.Main.memosOf(bid) : [], sents = show ? RE.Main.sectionSentences(bid) : [];
    var mm = {}; memos.forEach(function (m) { mm[m.sid] = m; });
    var key2 = st.article.articleId + '|' + bid + '|' + st.partIndex + '|' + st.memoSid + '|' + st.rangeStart + '-' + st.rangeEnd + '|' +
               memos.map(function (m) { return m.sid + ':' + m.s + '-' + m.e; }).join(',');
    if (key2 !== sectionKey_) {
      var sidChanged = sectionKey_.split('|')[3] !== st.memoSid || sectionKey_.split('|')[1] !== bid;
      sectionKey_ = key2; splitKey_ = '';
      var panel2 = el['panel-section-text']; panel2.textContent = '';
      var target2 = null;
      if (!sents.length) panel2.appendChild(make_('div', 'empty', show ? '（この節に文はありません）' : M.NEED_MARK));
      sents.forEach(function (x) {
        var row = make_('div', 'sent-row' + (x.sid === st.memoSid ? ' is-target' : ''));
        row.setAttribute('data-sid', x.sid);
        var line = make_('div', 'sent-line');
        line.appendChild(make_('span', 'sent-sid', x.sid));
        line.appendChild(make_('span', 'sent-text', x.text));
        row.appendChild(line);
        var m = mm[x.sid];
        if (m) {
          var mr = make_('div', 'sent-memo');
          mr.appendChild(make_('span', 'sent-time' + (RE.Main.isCurrentMemo(m) ? ' is-current' : ''), f(m.s) + '〜' + f(m.e)));
          var pb = make_('button', 'sent-play', '▶'); pb.type = 'button';
          pb.setAttribute('data-block', bid); pb.setAttribute('data-id', m.id); pb.setAttribute('aria-label', x.sid + ' をくり返す');
          var db = make_('button', 'sent-del', '×'); db.type = 'button';
          db.setAttribute('data-block', bid); db.setAttribute('data-id', m.id); db.setAttribute('aria-label', x.sid + ' の区間メモを削除');
          mr.appendChild(pb); mr.appendChild(db);
          row.appendChild(mr);
        }
        panel2.appendChild(row);
        if (x.sid === st.memoSid) target2 = row;
      });
      if (sidChanged && target2) {
        var top = target2.offsetTop, bottom = top + target2.offsetHeight;
        if (top < panel2.scrollTop || bottom > panel2.scrollTop + panel2.clientHeight) panel2.scrollTop = Math.max(0, top - 40);
      }
    }
    el['btn-memo-save'].textContent = fill(M.MEMO_SAVE, { sid: st.memoSid || '—' });
    el['btn-memo-save'].disabled = !playable || !st.memoSid || !show;
    el['txt-hint-section'].textContent = M.HINT_SECTION;
  }

  // 固定の再生バー（仕様 8.10）
  function renderMini_(playable, cur) {
    var st = RE.State, a = st.article, r = RE.Main.currentRange(), f = RE.Utils.formatTime;
    var label = '';
    if (st.engineMode === 'split') {
      var bi = RE.Main.blockIndex(st.splitBlockId);
      label = M.WORK_ARTICLE + '：' + (bi >= 0 ? st.view.blocks[bi].label : '');
    } else if (cur) {
      label = cur.label;
      var cm = RE.Main.memosOf(cur.blockId).filter(function (m) { return RE.Main.isCurrentMemo(m); })[0];
      if (cm) label += ' ' + cm.sid;
      var sec = RE.Main.sectionEntry(cur.blockId);
      if (sec && sec.done) label += ' ✓';
    }
    el['txt-mini-label'].textContent = label;
    el['txt-mini-range'].textContent = r ? f(r.s) + '〜' + f(r.e) : '--:--〜--:--';
    var playing = st.playerState === S.PLAYING;
    el['btn-mini-play'].disabled = !playable;
    el['btn-mini-play'].textContent = playing ? '❚❚' : '▶';
    el['btn-mini-play'].setAttribute('aria-label', playing ? '一時停止' : '再生');
    el['btn-mini-prev-break'].disabled = !a.marked;
    el['btn-mini-next-break'].disabled = !a.marked;
    // シークバー（範囲の開始〜終わり）と倍速の枠
    var seek = el['seek-mini'];
    seek.disabled = !playable;
    if (r) { seek.min = String(r.s); seek.max = String(r.e); }
    else { seek.min = '0'; seek.max = '1'; seek.value = '0'; el['txt-mini-pos'].textContent = '--:--'; setSeekPct_(0); }
    seek.step = String(K.SEEK_STEP_SEC);
    el['txt-mini-rate'].textContent = fill(M.RATE_LABEL, { rate: st.rate.toFixed(1) });
    el['btn-mini-rate'].disabled = !playable;
    el['btn-mini-rate'].classList.toggle('is-changed', st.rate !== 1);
    if (!playable && st.rateMenuOpen) renderRateMenu_(false);
    else if (st.rateMenuOpen) renderRateMenu_(true);
    if (!r) el['bar-range-fill'].style.width = '0%';
  }

  // シークバーの、今の位置までの線の長さ
  function setSeekPct_(v) {
    var s = el['seek-mini'], mn = Number(s.min), mx = Number(s.max);
    var f = mx > mn ? Math.min(1, Math.max(0, (v - mn) / (mx - mn))) : 0;
    s.style.setProperty('--pct', (f * 100).toFixed(1) + '%');
  }

  // 倍速の一覧の開閉と中身（仕様 8.10）
  function renderRateMenu_(open) {
    var st = RE.State, menu = el['menu-rate'];
    st.rateMenuOpen = !!open;
    menu.hidden = !open;
    el['btn-mini-rate'].setAttribute('aria-expanded', String(!!open));
    if (!open) return;
    menu.textContent = '';
    K.RATE_CHOICES.forEach(function (rt) {
      var on = rt === st.rate;
      var b = make_('button', 'rate-opt', (on ? '✓ ' : '\u2003') + fill(M.RATE_LABEL, { rate: rt.toFixed(1) }));
      b.type = 'button';
      b.setAttribute('role', 'menuitemradio');
      b.setAttribute('aria-checked', String(on));
      b.setAttribute('data-rate', String(rt));
      menu.appendChild(b);
    });
  }

  // 範囲の行・時刻の▲▼の表示（仕様 6.5・8.5）
  function renderRange_(r) {
    var st = RE.State, f = RE.Utils.formatTime;
    el['txt-range'].textContent = r ? f(r.s) + '〜' + f(r.e) : '--:--〜--:--';
    el['panel-range'].classList.toggle('is-off', !r);
    document.querySelectorAll('.digit-btn').forEach(function (b) { b.disabled = !r; });
    if (!r) { el['bar-range-fill'].style.width = '0%'; return; }
    [['start', r.s], ['end', r.e]].forEach(function (x) {
      var d = RE.Utils.splitDigits(x[1]);
      ['m10', 'm1', 's10', 's1'].forEach(function (k) { el['txt-' + x[0] + '-' + k].textContent = String(d[k]); });
    });
  }

  // 1語の表示
  function renderWord_(item) {
    var w = make_('div', 'word');
    var head = make_('div', 'word-head');
    head.appendChild(make_('span', 'word-es', item.form));
    if (item.pos === '動詞' && item.lemma && item.lemma.toLowerCase() !== item.form.toLowerCase()) {
      head.appendChild(make_('span', 'word-lemma', '← ' + item.lemma));
    }
    if (item.pos) head.appendChild(make_('span', 'word-pos', item.pos));
    w.appendChild(head);
    w.appendChild(make_('div', 'word-meaning', item.meaning));
    item.extra.forEach(function (x) { w.appendChild(make_('div', 'word-extra', x)); });
    if (item.context) w.appendChild(make_('div', 'word-context', item.context));
    return w;
  }
  // 文番号の区切り。区間メモがある文は、押すとその文をくり返すボタン（仕様 8.5）
  function renderSidSep_(sid, memo) {
    if (!memo) return make_('div', 'sid-sep', '── ' + sid + ' ──');
    var f = RE.Utils.formatTime;
    var b = make_('button', 'sid-sep has-memo', '── ' + sid + ' ▶ ' + f(memo.s) + '〜' + f(memo.e) + ' ──');
    b.type = 'button';
    b.setAttribute('data-block', RE.State.blockId);
    b.setAttribute('data-id', memo.id);
    b.setAttribute('aria-label', sid + ' の文をくり返す');
    if (RE.Main.isCurrentMemo(memo)) b.setAttribute('aria-current', 'true');
    return b;
  }

  // 単語一覧を作り直す。keepScroll が true でなければ先頭へ戻す
  function renderWordList(keepScroll) {
    var st = RE.State, box = el['list-words'];
    box.textContent = '';
    if (!st.view) return;
    if (st.blockId === K.SECTION_NONE) {
      st.view.unmatched.forEach(function (it) { box.appendChild(renderWord_(it)); });
    } else {
      var groups = st.view.rows[st.blockId] || [], gmap = {}, mmap = {}, used = {};
      groups.forEach(function (g) { gmap[g.sid] = g; });
      RE.Main.memosOf(st.blockId).forEach(function (m) { mmap[m.sid] = m; });
      if (!groups.length && !Object.keys(mmap).length) box.appendChild(make_('div', 'empty', '（この節に新しい語はありません）'));
      var put = function (sid) {
        var g = gmap[sid], m = mmap[sid];
        if (used[sid] || (!g && !m)) return;
        used[sid] = true;
        box.appendChild(renderSidSep_(sid, m));
        if (g) g.items.forEach(function (hit) { box.appendChild(renderWord_(hit.item)); });
      };
      RE.Main.sectionSentences(st.blockId).forEach(function (x) { put(x.sid); });
      groups.forEach(function (g) { put(g.sid); });
    }
    if (keepScroll) return;
    st.scrollPos['screen-words'] = 0;
    if (st.screen === 'screen-words') window.scrollTo(0, 0);
  }

  // 節の一覧の開閉
  function renderSectionSheet(open) {
    RE.State.sheetOpen = !!open;
    el['sheet-sections'].hidden = !open;
    if (!open || !RE.State.view) return;
    var box = el['list-sections']; box.textContent = '';
    RE.Main.navList().forEach(function (b) {
      var current = b.blockId === RE.State.blockId && b.part === RE.State.partIndex;
      var row = make_('button', 'sheet-row' + (current ? ' is-current' : '')); row.type = 'button';
      row.setAttribute('data-id', b.blockId);
      row.setAttribute('data-part', b.part);
      row.appendChild(make_('span', 'sheet-label', b.label));
      var sec = RE.Main.sectionEntry(b.blockId);
      var mark = sec ? (!sec.parts.length ? '—' : (sec.done ? '✓' : '')) : '';
      row.appendChild(make_('span', 'sheet-mark', mark));
      box.appendChild(row);
    });
  }

  // 更新のお知らせ帯を出す（仕様 8.11）
  function showUpdateBanner() {
    el['txt-update-main'].textContent = C.MSG.UPDATE_AVAILABLE;
    el['txt-update-note'].textContent = M.UPDATE_NOTE;
    el['banner-update'].hidden = false;
  }

  // 学習画面の受け渡しの状態（仕様 6.7.4）
  function renderSyncStatus() {
    var map = { checking: M.SYNC_STATUS_CHECKING, same: M.SYNC_STATUS_SAME, pending: M.SYNC_STATUS_PENDING,
                offline: M.SYNC_STATUS_OFFLINE, mismatch: M.SYNC_STATUS_MISMATCH };
    var st = RE.State, t = map[st.syncStatus] || '';
    var retry = st.syncStatus === 'pending' || st.syncStatus === 'offline';
    if (retry && st.syncError) t += ' ' + fill(M.SYNC_REASON, { reason: st.syncError });
    if (retry) t += ' ' + M.SYNC_RETRY_HINT;
    el['txt-sync-status'].textContent = t;
    el['txt-sync-status'].hidden = !t;
    el['txt-sync-status'].disabled = !retry;
    el['txt-sync-status'].classList.toggle('is-pending', retry);
  }

  // 「月/日 時:分」
  function formatSyncDate_(ms) {
    var d = new Date(Number(ms) || 0), p = function (n) { return (n < 10 ? '0' : '') + n; };
    return (d.getMonth() + 1) + '/' + d.getDate() + ' ' + p(d.getHours()) + ':' + p(d.getMinutes());
  }

  // 受け渡しの確認画面（仕様 8.8）
  function renderSyncSheet(open) {
    var r = RE.State.syncRemote, a = RE.State.article;
    el['sheet-sync'].hidden = !(open && r && a);
    if (el['sheet-sync'].hidden) return;
    var dev = r.device || K.SYNC_DEVICE_OTHER;
    var rs = RE.Sync.summary(r.sections, r.memos), ls = RE.Sync.summary(a.sections, a.memos);
    el['txt-sync-title'].textContent = M.SYNC_CONFLICT_TITLE;
    el['txt-sync-remote'].textContent = fill(M.SYNC_CONFLICT_REMOTE, { device: dev, date: formatSyncDate_(r.savedAt), parts: rs.parts, done: rs.done, memos: rs.memos });
    el['txt-sync-local'].textContent = fill(M.SYNC_CONFLICT_LOCAL, { parts: ls.parts, done: ls.done, memos: ls.memos });
    el['btn-sync-use-remote'].textContent = fill(M.SYNC_USE_REMOTE, { device: dev });
    el['btn-sync-keep-local'].textContent = M.SYNC_KEEP_LOCAL;
  }

  // 位置の表示（作業場は範囲のバーと再生バー、学習は再生バー）
  function updatePosition(sec) {
    var scr = RE.State.screen;
    if (scr === 'screen-study' || scr === 'screen-words') {
      var r = RE.Main.currentRange();
      var f = r && r.e > r.s ? Math.min(1, Math.max(0, (sec - r.s) / (r.e - r.s))) : 0;
      var w = (f * 100).toFixed(1) + '%';
      if (scr === 'screen-study') el['bar-range-fill'].style.width = w;
      if (!RE.State.seekDragging && r) {
        el['seek-mini'].value = String(sec);
        el['txt-mini-pos'].textContent = RE.Utils.formatTime(sec);
        setSeekPct_(sec);
      }
    }
  }

  // 再生ボタンの見た目だけ更新（エンジンの状態が変わったとき）
  function renderPlayButtons() {
    if (RE.State.screen === 'screen-study' || RE.State.screen === 'screen-words') renderStudyTop();
  }

  // ===== 設定 =====
  function renderSettings() {
    var st = RE.State;
    ['L', 'M', 'S'].forEach(function (f) { el['btn-font-' + f].setAttribute('aria-pressed', String(st.fontSize === f)); });
    K.DEADLINE_OPTIONS.forEach(function (w) { el['btn-deadline-' + w].setAttribute('aria-pressed', String(st.deadlineWeekday === w)); });
    var s = RE.Drive.getSettings();
    el['input-gas-url'].value = s.url;
    el['input-gas-key'].value = s.key;
    document.querySelectorAll('.gap-btn').forEach(function (b) {
      b.setAttribute('aria-pressed', String(Number(b.getAttribute('data-gap')) === st.gapSec));
    });
  }

  RE.UI = {
    init: init, fill: fill, showScreen: showScreen, showMessage: showMessage, clearMessage: clearMessage,
    applyFontSize: applyFontSize, renderLibrary: renderLibrary, renderDrive: renderDrive,
    renderImport: renderImport, setImportSummary: setImportSummary, setImportTitle: setImportTitle, setArticleText: setArticleText,
    renderMarks: renderMarks, renderStudyTop: renderStudyTop, renderWordList: renderWordList,
    renderSectionSheet: renderSectionSheet, updatePosition: updatePosition, renderPlayButtons: renderPlayButtons,
    renderSettings: renderSettings, renderSyncStatus: renderSyncStatus, renderSyncSheet: renderSyncSheet,
    renderTabs: renderTabs, showUpdateBanner: showUpdateBanner
  };
})();
