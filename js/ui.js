/* js/ui.js — 画面の描画とボタン操作の受け付け（RE.UI）。中身の判断は RE.Main が行う */
(function () {
  'use strict';
  var C = RE.Config;
  var K = C.KX;
  var M = C.KXMSG;
  var S = C.PLAYER_STATE;
  var el = {};
  var h = null;
  var SCREENS = ['screen-library', 'screen-drive', 'screen-import', 'screen-mark', 'screen-study', 'screen-settings'];

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
    // 一覧
    on('btn-open-settings', function () { h.onOpenSettings(); });
    on('btn-add-drive', function () { h.onAddDrive(); });
    on('btn-add-article', function () { h.onAddArticle(); });
    el['list-articles'].addEventListener('click', function (ev) {
      var b = ev.target.closest('button'); if (!b) return;
      var card = b.closest('.article-card'); if (!card) return;
      var id = card.getAttribute('data-id');
      if (b.classList.contains('article-open')) h.onOpenArticle(id);
      else if (b.classList.contains('article-remark')) h.onRemark(id);
      else if (b.classList.contains('article-delete')) h.onDeleteArticle(id);
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
    // 記録
    on('btn-mark-back', function () { h.onMarkBack(); });
    on('btn-mark-play', function () { h.onMarkPlay(); });
    on('btn-mark-back5', function () { h.onMarkSeek(-K.SEEK_SEC); });
    on('btn-mark-fwd5', function () { h.onMarkSeek(K.SEEK_SEC); });
    on('btn-mark-here', function () { h.onMarkHere(); });
    on('btn-mark-break', function () { h.onMarkBreak(); });
    on('btn-mark-end', function () { h.onMarkEnd(); });
    on('btn-mark-reset', function () { h.onMarkReset(); });
    on('btn-mark-skip', function () { h.onMarkSkip(); });
    on('btn-mark-undo', function () { h.onMarkUndo(); });
    on('btn-mark-save', function () { h.onMarkSave(); });
    el['list-marks'].addEventListener('click', function (ev) {
      var b = ev.target.closest('button'); if (!b) return;
      var bi = parseInt(b.getAttribute('data-bi'), 10), pi = parseInt(b.getAttribute('data-pi'), 10);
      if (b.classList.contains('mark-preview')) { h.onMarkPreview(bi, pi); return; }
      var which = b.getAttribute('data-which'), dir = Number(b.getAttribute('data-dir'));
      if (which) h.onMarkAdjust(bi, pi, which, dir * K.ADJUST_SEC);
    });
    // 学習
    on('btn-study-back', function () { h.onStudyBack(); });
    on('btn-study-tools', function () { h.onToggleTools(); });
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
    on('btn-range-edit', function () { h.onToggleRangeEdit(); });
    on('btn-mark-start', function () { h.onMarkRange('start'); });
    on('btn-mark-end-range', function () { h.onMarkRange('end'); });
    on('btn-all', function () { commitInput_(); h.onSelectAll(); });
    document.querySelectorAll('.digit-btn').forEach(function (b) {
      b.addEventListener('click', function () {
        var d = Number(b.getAttribute('data-unit')) * Number(b.getAttribute('data-dir'));
        if (b.getAttribute('data-target') === 'start') h.onStartStep(d); else h.onEndStep(d);
      });
    });
    on('btn-stop', function () { commitInput_(); h.onStop(); });
    on('btn-play', function () { commitInput_(); h.onPlayPause(); });
    on('btn-prev-chunk', function () { commitInput_(); h.onPrevChunk(); });
    on('btn-next-chunk', function () { commitInput_(); h.onNextChunk(); });
    on('btn-complete', function () { h.onComplete(); });
    on('btn-move-minus', function () { h.onMoveStep(-1); });
    on('btn-move-plus', function () { h.onMoveStep(1); });
    el['input-move'].addEventListener('change', function () { h.onMoveCommitted(this.value); });
    document.querySelectorAll('.gap-btn').forEach(function (b) {
      b.addEventListener('click', function () { h.onGapSelect(Number(b.getAttribute('data-gap'))); });
    });
    document.querySelectorAll('.rate-btn').forEach(function (b) {
      b.addEventListener('click', function () { commitInput_(); h.onRateSelect(Number(b.getAttribute('data-rate'))); });
    });
    // 設定
    on('btn-settings-back', function () { h.onSettingsBack(); });
    ['L', 'M', 'S'].forEach(function (f) { on('btn-font-' + f, function () { h.onFontSelect(f); }); });
    K.DEADLINE_OPTIONS.forEach(function (w) { on('btn-deadline-' + w, function () { h.onDeadlineSelect(w); }); });
    on('btn-gas-save', function () { h.onGasSave(el['input-gas-url'].value, el['input-gas-key'].value); });
    bindPressed_();
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

  // 入力中の移動時間を先に確定させる（iPhoneはボタンを押しても入力欄の確定が起きないため）
  function commitInput_() {
    if (document.activeElement === el['input-move']) el['input-move'].blur();
  }

  // 画面切替
  function showScreen(id) {
    SCREENS.forEach(function (s) { el[s].hidden = s !== id; });
    if (id !== 'screen-study') renderSectionSheet(false);
    RE.State.screen = id;
    window.scrollTo(0, 0);
  }

  // メッセージ（screenId は 'library' 'drive' 'import' 'mark' 'study' 'settings'）
  function showMessage(screenId, text, isError) {
    var m = el['msg-' + screenId]; if (!m) return;
    m.textContent = text || '';
    m.classList.toggle('msg-error', !!isError);
    m.classList.toggle('msg-on', !!text);
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
    el['btn-drive-pick-audio'].hidden = !RE.State.drivePending;
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

  // ===== 記録 =====
  function renderMark() {
    var st = RE.State, blocks = st.view ? st.view.blocks : [], n = blocks.length, L = K.MARK_LABELS;
    var nextName = st.markIndex < n ? blocks[st.markIndex].label : '';
    var here = el['btn-mark-here'];
    here.textContent = nextName ? fill(L.HERE, { name: nextName }) : L.ALL;
    here.disabled = !nextName;
    // 節中断／中断終了
    var brk = el['btn-mark-break'], cur = st.markParts[st.markIndex - 1];
    brk.textContent = st.markState === 'paused' ? L.RESUME : L.BREAK;
    brk.disabled = st.markState === 'idle' || (st.markState === 'open' && cur && cur.length >= K.PART_LETTERS.length);
    brk.classList.toggle('is-active', st.markState === 'paused');
    // 節END／次節START
    var end = el['btn-mark-end'];
    if (st.markState === 'idle') {
      end.textContent = nextName ? fill(L.NEXT_START, { name: nextName }) : L.END;
      end.disabled = !nextName;
      end.classList.toggle('is-active', !!nextName && st.markIndex > 0);
    } else {
      end.textContent = L.END; end.disabled = false; end.classList.remove('is-active');
    }
    el['btn-mark-skip'].disabled = st.markIndex >= n;
    el['btn-mark-undo'].disabled = !st.markHistory.length;
    var reset = el['btn-mark-reset'];
    reset.hidden = !st.markFromSaved;
    reset.textContent = st.markResetPending ? '本当に記録し直す' : '最初から記録し直す';
    reset.classList.toggle('btn-danger', !!st.markResetPending);
    renderMarkPlay_();
    // 記録した区間の一覧
    var box = el['list-marks']; box.textContent = '';
    blocks.forEach(function (b, bi) {
      var ps = st.markParts[bi];
      if (ps === undefined) return;
      if (!ps.length) {
        var r0 = make_('div', 'mark-row');
        var top0 = make_('div', 'mark-top');
        top0.appendChild(make_('span', 'mark-label', b.label));
        top0.appendChild(make_('span', 'mark-time mark-skipped', '—（とばした）'));
        r0.appendChild(top0); box.appendChild(r0);
        return;
      }
      ps.forEach(function (pt, pi) {
        var row = make_('div', 'mark-row');
        var top = make_('div', 'mark-top');
        var name = ps.length > 1 ? b.label + K.PART_LETTERS.charAt(pi) : b.label;
        top.appendChild(make_('span', 'mark-label', name));
        top.appendChild(make_('span', 'mark-time', RE.Utils.formatTime(pt.s) + '〜' + (pt.e === null ? '…' : RE.Utils.formatTime(pt.e))));
        var pv = make_('button', 'btn btn-mini mark-preview', '▶'); pv.type = 'button';
        pv.setAttribute('data-bi', bi); pv.setAttribute('data-pi', pi);
        top.appendChild(pv);
        row.appendChild(top);
        var adj = make_('div', 'mark-adjust');
        [['s', -1, '始−1'], ['s', 1, '始＋1'], ['e', -1, '終−1'], ['e', 1, '終＋1']].forEach(function (x) {
          var bt = make_('button', 'btn btn-mini mark-adj', x[2]); bt.type = 'button';
          bt.setAttribute('data-bi', bi); bt.setAttribute('data-pi', pi);
          bt.setAttribute('data-which', x[0]); bt.setAttribute('data-dir', x[1]);
          if (x[0] === 'e' && pt.e === null) bt.disabled = true;
          adj.appendChild(bt);
        });
        row.appendChild(adj);
        box.appendChild(row);
      });
    });
  }
  function renderMarkPlay_() {
    var playing = RE.State.playerState === S.PLAYING;
    el['btn-mark-play'].textContent = playing ? '❚❚' : '▶';
    el['btn-mark-play'].setAttribute('aria-label', playing ? '一時停止' : '再生');
  }

  // ===== 学習 =====
  function renderStudyTop() {
    var st = RE.State, a = st.article;
    if (!a || !st.view) return;
    el['txt-study-title'].textContent = a.title;
    el['txt-progress'].textContent = RE.Main.studyProgressText();
    var nav = RE.Main.navList(), idx = RE.Main.navIndex();
    var cur = nav[idx];
    var label = cur ? cur.label : '';
    if (cur && cur.blockId !== K.SECTION_NONE) {
      var n = st.view.blocks.length;
      label += '（' + (cur.blockIndex + 1) + '/' + n + '）';
      var sec = RE.Main.sectionEntry(cur.blockId);
      if (sec && sec.done) label += ' ✓';
      if (sec && !sec.parts.length) label += ' —';
    }
    el['btn-sec-label'].textContent = label;
    el['btn-sec-prev'].disabled = idx <= 0;
    el['btn-sec-next'].disabled = idx >= nav.length - 1;
    var r = RE.Main.currentRange();
    var playable = !!r;
    renderRange_(r);
    ['btn-play', 'btn-stop', 'btn-all', 'btn-prev-chunk', 'btn-next-chunk', 'btn-mark-start', 'btn-mark-end-range', 'btn-range-edit'].forEach(function (id) {
      el[id].disabled = !playable;
    });
    el['txt-next-step'].textContent = '＋' + RE.Utils.calcStepSec(st.moveSec) + '秒';
    var isNone = !cur || cur.blockId === K.SECTION_NONE;
    var secE = cur ? RE.Main.sectionEntry(cur.blockId) : null;
    el['btn-complete'].disabled = isNone || !secE || !secE.parts.length;
    el['btn-complete'].textContent = secE && secE.done ? '完了を取り消す' : 'この節を完了';
    el['btn-complete'].classList.toggle('is-done', !!(secE && secE.done));
    var playing = st.playerState === S.PLAYING;
    el['btn-play'].textContent = playing ? '❚❚' : '▶';
    el['btn-play'].setAttribute('aria-label', playing ? '一時停止' : '再生');
    // 再生の設定
    el['panel-tools'].hidden = !st.toolsOpen;
    el['btn-study-tools'].classList.toggle('is-on', st.toolsOpen);
    el['input-move'].value = st.moveSec;
    document.querySelectorAll('.gap-btn').forEach(function (b) {
      b.setAttribute('aria-pressed', String(Number(b.getAttribute('data-gap')) === st.gapSec));
    });
    document.querySelectorAll('.rate-btn').forEach(function (b) {
      b.setAttribute('aria-pressed', String(Number(b.getAttribute('data-rate')) === st.rate));
      b.disabled = !playable;
    });
    if (st.sheetOpen) renderSectionSheet(true);
  }

  // 範囲の行・時刻の▲▼の表示（仕様 6.5・8.5）
  function renderRange_(r) {
    var st = RE.State, f = RE.Utils.formatTime;
    el['btn-range-edit'].textContent = r ? f(r.s) + '〜' + f(r.e) : '--:--〜--:--';
    el['btn-range-edit'].classList.toggle('is-on', !!st.rangeEditOpen);
    el['panel-range'].hidden = !st.rangeEditOpen || !r;
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
  // 文番号の区切り
  function renderSidSep_(sid) { return make_('div', 'sid-sep', '── ' + sid + ' ──'); }

  // 単語一覧を作り直し、先頭へ戻す
  function renderWordList() {
    var st = RE.State, box = el['list-words'];
    box.textContent = '';
    if (!st.view) return;
    if (st.blockId === K.SECTION_NONE) {
      st.view.unmatched.forEach(function (it) { box.appendChild(renderWord_(it)); });
    } else {
      var groups = st.view.rows[st.blockId] || [];
      if (!groups.length) box.appendChild(make_('div', 'empty', '（この節に新しい語はありません）'));
      groups.forEach(function (g) {
        box.appendChild(renderSidSep_(g.sid));
        g.items.forEach(function (hit) { box.appendChild(renderWord_(hit.item)); });
      });
    }
    window.scrollTo(0, 0);
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

  // 位置の表示（学習画面はバーの塗り、記録画面は時刻）
  function updatePosition(sec) {
    if (RE.State.screen === 'screen-study') {
      var r = RE.Main.currentRange();
      var f = r && r.e > r.s ? Math.min(1, Math.max(0, (sec - r.s) / (r.e - r.s))) : 0;
      el['bar-range-fill'].style.width = (f * 100).toFixed(1) + '%';
    } else if (RE.State.screen === 'screen-mark') {
      var dur = RE.State.article ? RE.State.article.durationSec : 0;
      el['txt-mark-pos'].textContent = RE.Utils.formatTime(sec) + ' / ' + RE.Utils.formatTime(dur);
    }
  }

  // 再生ボタンの見た目だけ更新（エンジンの状態が変わったとき）
  function renderPlayButtons() {
    if (RE.State.screen === 'screen-mark') renderMarkPlay_();
    else if (RE.State.screen === 'screen-study') renderStudyTop();
  }

  // ===== 設定 =====
  function renderSettings() {
    var st = RE.State;
    ['L', 'M', 'S'].forEach(function (f) { el['btn-font-' + f].setAttribute('aria-pressed', String(st.fontSize === f)); });
    K.DEADLINE_OPTIONS.forEach(function (w) { el['btn-deadline-' + w].setAttribute('aria-pressed', String(st.deadlineWeekday === w)); });
    var s = RE.Drive.getSettings();
    el['input-gas-url'].value = s.url;
    el['input-gas-key'].value = s.key;
  }

  RE.UI = {
    init: init, fill: fill, showScreen: showScreen, showMessage: showMessage, clearMessage: clearMessage,
    applyFontSize: applyFontSize, renderLibrary: renderLibrary, renderDrive: renderDrive,
    renderImport: renderImport, setImportSummary: setImportSummary, setImportTitle: setImportTitle, setArticleText: setArticleText,
    renderMark: renderMark, renderStudyTop: renderStudyTop, renderWordList: renderWordList,
    renderSectionSheet: renderSectionSheet, updatePosition: updatePosition, renderPlayButtons: renderPlayButtons,
    renderSettings: renderSettings
  };
})();
