/* js/main.js — 起動と各操作のまとめ役（RE.Main）。画面の描画は RE.UI、再生は RE.Engine、保存は RE.Db に任せる */
(function () {
  'use strict';
  var C = RE.Config;
  var K = C.KX;
  var M = C.KXMSG;
  var S = C.PLAYER_STATE;
  var ST = function () { return RE.State; };
  var fill = function (t, v) { return RE.UI.fill(t, v); };

  var inputTimer_ = null;
  var deleteTimer_ = null;
  var lastRemote_ = 0;
  var swReg_ = null;          // サービスワーカーの登録（更新の確認に使う）
  var lastUpdateCheck_ = 0;   // 前回、新しい版を確かめた時刻
  var newArticleId_ = '';     // いま追加したばかりの記事（「先に記録して」を出さないため）

  // ===== 共通の計算 =====

  // 本文とCSVから、節ごとの一覧を作る（仕様 6.3）
  function buildView_(articleText, csvText) {
    var parsed = RE.Article.parseArticle(articleText);
    var blocks = RE.Article.buildBlocks(parsed.units);
    var items = RE.Lexicon.itemsFromCsv(csvText);
    var m = RE.Lexicon.matchItems(items, parsed.units);
    var order = {}; parsed.units.forEach(function (u, i) { order[u.sid] = i; });
    var rows = {};
    blocks.forEach(function (b) {
      var hs = m.hits.filter(function (h) { return h.blockId === b.id; });
      hs.sort(function (a, c) {
        return (order[a.sid] - order[c.sid]) || (a.at - c.at) || (c.len - a.len) || (a.item.idx - c.item.idx);
      });
      var groups = [];
      hs.forEach(function (h) {
        var g = groups[groups.length - 1];
        if (!g || g.sid !== h.sid) { g = { sid: h.sid, items: [] }; groups.push(g); }
        g.items.push(h);
      });
      rows[b.id] = groups;
    });
    return { blocks: blocks, rows: rows, unmatched: m.unmatched, parsed: parsed, itemCount: items.length };
  }

  // 本文として使えるか（質問と本文が1つ以上）
  function parseOk_(parsed) {
    var q = 0, b = 0;
    parsed.units.forEach(function (u) { if (u.kind === 'question') q++; if (u.kind === 'body') b++; });
    return q > 0 && b > 0;
  }

  // 「認識：…」の文
  function parseSummary_(view) {
    var u = view.parsed.units, cnt = function (k) { return u.filter(function (x) { return x.kind === k; }).length; };
    return fill(M.PARSE_OK, { blocks: view.blocks.length, body: cnt('body'), q: cnt('question'), r: cnt('review') });
  }

  // 「照合：…」の文
  function csvSummary_(view) {
    return fill(M.CSV_OK, { total: view.itemCount, found: view.itemCount - view.unmatched.length, none: view.unmatched.length });
  }

  // 区間の呼び名（仕様 6.4.2）。区間が1つなら節の名前のまま、2つ以上なら A・B…を付ける
  function partLabel_(blockIndex, partIndex) {
    var v = ST().view, a = ST().article;
    var b = v.blocks[blockIndex]; if (!b) return '';
    var sec = a ? sectionEntry(b.id) : null;
    var n = sec && sec.parts ? sec.parts.length : 0;
    if (n < 2 || partIndex < 0) return b.label;
    return b.label + K.PART_LETTERS.charAt(partIndex);
  }

  // 学習画面の並び（仕様 6.4.3）。1行＝{blockId, part, label, blockIndex}
  function navList() {
    var v = ST().view; if (!v) return [];
    var list = [];
    v.blocks.forEach(function (b, bi) {
      var sec = sectionEntry(b.id), n = sec && sec.parts ? sec.parts.length : 0;
      if (!n) { list.push({ blockId: b.id, part: -1, label: b.label, blockIndex: bi }); return; }
      for (var p = 0; p < n; p++) list.push({ blockId: b.id, part: p, label: partLabel_(bi, p), blockIndex: bi });
    });
    if (v.unmatched.length) list.push({ blockId: K.SECTION_NONE, part: -1, label: '見つからなかった語（' + v.unmatched.length + '）', blockIndex: -1 });
    return list;
  }
  function navIndex() {
    var st = ST(), nav = navList();
    for (var i = 0; i < nav.length; i++) if (nav[i].blockId === st.blockId && nav[i].part === st.partIndex) return i;
    for (i = 0; i < nav.length; i++) if (nav[i].blockId === st.blockId) return i;
    return 0;
  }

  // 記事に保存してある節の情報
  function sectionEntry(id) {
    var a = ST().article; if (!a) return null;
    for (var i = 0; i < a.sections.length; i++) if (a.sections[i].id === id) return a.sections[i];
    return null;
  }

  // 区間の範囲 {start, end}。再生できない（とばした節・B-NONE）は null（仕様 6.4.3）
  function sectionRange_(blockId, part) {
    var sec = sectionEntry(blockId);
    if (!sec || !sec.parts || part < 0 || part >= sec.parts.length) return null;
    var pt = sec.parts[part];
    if (!(pt.e > pt.s)) return null;
    return { start: pt.s, end: pt.e };
  }

  // いま繰り返す範囲 {s, e}（仕様 6.5.1）。区間が再生できなければ null
  function currentRange() {
    var st = ST(), sec = sectionRange_(st.blockId, st.partIndex);
    if (!sec) return null;
    var s = Math.min(Math.max(st.rangeStart, sec.start), sec.end - 1);
    var e = Math.min(Math.max(st.rangeEnd, s + 1), sec.end);
    return { s: s, e: e };
  }

  // 今の区間 {start, end}
  function partRange_() { return sectionRange_(ST().blockId, ST().partIndex); }

  // 範囲を変えてエンジンに渡す。restart が true なら、再生中は頭から再生し直す。play が true なら停止中でも頭から再生する
  function setRange_(s, e, restart, play) {
    var st = ST();
    st.rangeStart = s; st.rangeEnd = e;
    applyRange_(restart);
    if (play && RE.Engine.getState() !== S.PLAYING) RE.Engine.playFromStart();
    RE.UI.renderStudyTop();
  }

  // 範囲が長いのに倍速なら1.0に戻す
  function enforceRateLimit_() {
    var r = currentRange();
    if (r && ST().rate !== 1 && r.e - r.s > C.STRETCH_MAX_SECTION_SEC) {
      ST().rate = C.RATE_DEFAULT;
      RE.Engine.setRate(C.RATE_DEFAULT);
      RE.UI.showMessage('study', C.MSG.RATE_RESET_LONG);
      return true;
    }
    return false;
  }

  // 今のモード・節の範囲をエンジンに渡す。restart が true で再生中なら、範囲の頭から再生し直す
  function applyRange_(restart) {
    var r = currentRange();
    if (!r) { RE.Engine.stop(); return false; }
    enforceRateLimit_();
    var playing = RE.Engine.getState() === S.PLAYING;
    if (playing && restart) {
      RE.Engine.setSection(r.s, r.e, 'A', true);
      RE.Engine.playFromStart();
    } else {
      RE.Engine.setSection(r.s, r.e, 'A');
      if (!playing && RE.Engine.getState() === S.PAUSED && restart) RE.Engine.stop();
    }
    return true;
  }

  // 記事を保存
  function saveArticle_() {
    var a = ST().article; if (!a) return Promise.resolve(false);
    return RE.Db.saveArticle(a);
  }

  // ===== 端末どうしの受け渡し（仕様 6.7） =====
  var syncChain_ = Promise.resolve();

  // 受け渡しの対象か
  function canSync_(a) { return !!(a && a.driveFolderId && RE.Drive.isReady()); }
  // 区切り・完了がこの端末にあるか
  function hasLocalData_(a) { return !!a.marked || a.sections.some(function (s) { return !!s.done; }); }
  // v0.6 以前の記事に項目を足す。足したら true
  function migrateSync_(a) {
    if (typeof a.syncSavedAt === 'number') return false;
    a.syncSavedAt = 0; a.syncDirty = hasLocalData_(a);
    return true;
  }
  // 通信を順番に1つずつ行う
  function queueSync_(fn) { syncChain_ = syncChain_.then(fn).catch(function (e) { console.error(e); return 'pending'; }); return syncChain_; }
  // 失敗の理由の文（GASが返した記号と説明）
  function errText_(res) { return (res && res.code ? res.code : '?') + (res && res.message ? ' ' + res.message : ''); }
  // 状態を表示に反映
  function setSyncStatus_(a, status) {
    if (ST().article && ST().article.articleId === a.articleId) { ST().syncStatus = status; RE.UI.renderSyncStatus(); }
    return status;
  }
  // 区切り・完了を変えたあとに呼ぶ
  function markChanged_() {
    var a = ST().article;
    a.syncDirty = true;
    return saveArticle_().then(function () {
      if (!canSync_(a)) return setSyncStatus_(a, 'off');
      return queueSync_(function () { return pushSync_(a, false); });
    });
  }
  // 送る（6.7.6）
  function pushSync_(a, force) {
    return RE.Drive.putSync(a.driveFolderId, a.syncSavedAt, RE.Sync.makeData(a), force).then(function (res) {
      if (res.ok) { a.syncSavedAt = res.savedAt; a.syncDirty = false; ST().syncError = ''; return RE.Db.saveArticle(a).then(function () { return setSyncStatus_(a, 'same'); }); }
      if (res.code !== 'CONFLICT') { console.error('putSync', res); ST().syncError = errText_(res); return setSyncStatus_(a, 'pending'); }
      if (!res.sync) return pushSync_(a, true);
      if (!RE.Sync.isValidFor(res.sync, a)) return setSyncStatus_(a, 'mismatch');
      if (RE.Sync.sameContent(res.sync, a)) {
        a.syncSavedAt = Number(res.sync.savedAt); a.syncDirty = false;
        return RE.Db.saveArticle(a).then(function () { return setSyncStatus_(a, 'same'); });
      }
      return openConflict_(a, res.sync);
    });
  }
  // 読む（6.7.5）。結果は 'same' などの状態。自動で読み込んだときは 'applied'
  function pullSync_(a) {
    return RE.Drive.fetchSync(a.driveFolderId).then(function (res) {
      if (!res.ok) { console.error('fetchSync', res); ST().syncError = errText_(res); return setSyncStatus_(a, a.syncDirty ? 'pending' : 'offline'); }
      var r = res.sync;
      if (!r) return hasLocalData_(a) ? pushSync_(a, false) : setSyncStatus_(a, 'same');
      if (!RE.Sync.isValidFor(r, a)) return setSyncStatus_(a, 'mismatch');
      if (Number(r.savedAt) === a.syncSavedAt) return a.syncDirty ? pushSync_(a, false) : setSyncStatus_(a, 'same');
      if (RE.Sync.sameContent(r, a) || !a.syncDirty) {
        var changed = !RE.Sync.sameContent(r, a);
        RE.Sync.apply(a, r);
        return RE.Db.saveArticle(a).then(function () {
          setSyncStatus_(a, 'same');
          if (changed) ST().syncAppliedFrom = r.device || RE.Config.KX.SYNC_DEVICE_OTHER;
          return changed ? 'applied' : 'same';
        });
      }
      return openConflict_(a, r);
    });
  }
  // 確認画面を出す（8.8）
  function openConflict_(a, r) {
    if (!ST().article || ST().article.articleId !== a.articleId) return 'pending';   // 別の記事を開いていたら、次に開いたときに確認する
    ST().syncRemote = r;
    RE.UI.renderSyncSheet(true);
    return setSyncStatus_(a, 'conflict');
  }

  // 今の画面のメッセージ欄
  function showSyncMsg_(text) {
    var map = { 'screen-study': 'study', 'screen-words': 'study', 'screen-mark': 'mark', 'screen-library': 'library', 'screen-settings': 'settings' };
    var id = map[ST().screen]; if (id) RE.UI.showMessage(id, text);
  }
  // ドライブの中身に置き換えたあと、今の画面を開き直す（仕様 8.8）
  function reopenAfterSync_(text) {
    var st = ST(), scr = st.screen, a = st.article;
    if (scr === 'screen-mark') {
      leaveMark_();
      if (a.marked && st.markFromSaved) openMark_(true); else if (a.marked) openStudyLast_(); else openMark_(false);
    }
    else if (scr === 'screen-study' || scr === 'screen-words') {
      if (a.marked) { openStudyLast_(); if (scr === 'screen-study') RE.UI.showScreen('screen-study'); } else openMark_(false);
    }
    showSyncMsg_(text);
  }

  // 進捗の文（学習画面）
  function studyProgressText() {
    var a = ST().article; if (!a) return '';
    var p = RE.Progress.calc(a.sections, ST().deadlineWeekday);
    if (p.allDone) return M.ALL_DONE;
    return '残り' + p.remaining + '節／締切（' + K.WEEKDAY_LABELS[ST().deadlineWeekday] + '）まで' + p.days + '日／今日 ' + p.doneToday + '/' + p.target + '節';
  }

  // 進捗の文（記事一覧）
  function libraryProgressText(a) {
    if (!a.marked) return '節の位置が未記録';
    var p = RE.Progress.calc(a.sections, ST().deadlineWeekday);
    if (p.allDone) return M.ALL_DONE;
    return '残り' + p.remaining + '節／今日 ' + p.doneToday + '/' + p.target + '節';
  }

  // ドライブの1行で取り込めない理由（無ければ空）
  function driveProblemText(it) {
    var kinds = [['本文', it.articleCount], ['CSV', it.csvCount], ['音声', it.audioCount]];
    var missing = kinds.filter(function (k) { return k[1] === 0; }).map(function (k) { return k[0]; });
    var dup = kinds.filter(function (k) { return k[1] > 1; }).map(function (k) { return k[0]; });
    if (missing.length) return fill(M.DRIVE_MISSING, { list: missing.join('・') });
    if (dup.length) return fill(M.DRIVE_DUPLICATE, { list: dup.join('・') });
    return '';
  }

  // 音声ファイルの長さ（秒）を調べる。分からなければ 0
  function getDuration_(file) {
    return new Promise(function (resolve) {
      var url = URL.createObjectURL(file), a = new Audio(), done = false;
      var finish = function (d) { if (done) return; done = true; try { URL.revokeObjectURL(url); } catch (e) {} resolve(isFinite(d) && d > 0 ? d : 0); };
      a.preload = 'metadata';
      a.onloadedmetadata = function () { finish(a.duration); };
      a.onerror = function () { finish(0); };
      setTimeout(function () { finish(0); }, 15000);
      a.src = url;
    });
  }

  // 記事の節の情報を、今の節分けに合わせる
  // 以前の形（startSec）も、区間の形（parts）に変換する（仕様 6.4.4）
  function syncSections_(article, view) {
    var list = article.sections || [], old = {};
    list.forEach(function (s, i) {
      var parts = s.parts;
      if (!parts) {
        parts = [];
        if (typeof s.startSec === 'number') {
          var end = article.durationSec;
          for (var k = i + 1; k < list.length; k++) if (typeof list[k].startSec === 'number') { end = list[k].startSec; break; }
          if (end > s.startSec) parts.push({ s: s.startSec, e: end });
        }
      }
      old[s.id] = { parts: parts, done: s.done || null };
    });
    article.sections = view.blocks.map(function (b) {
      var o = old[b.id];
      return { id: b.id, parts: o ? o.parts : [], done: o ? o.done : null };
    });
  }

  // ===== 起動・一覧 =====

  function openLibrary() {
    RE.UI.showScreen('screen-library');
    return RE.Db.listArticles().then(function (list) {
      ST().articles = list;
      RE.UI.renderLibrary(list);
    });
  }

  // エンジンの状態が変わった
  function onEngineStateChange_(state) {
    ST().playerState = state;
    RE.UI.renderPlayButtons();
    if (state === S.PLAYING) RE.MediaSession.register();
    RE.MediaSession.setPlaybackState(state);
  }

  // エンジンからのエラー
  function onEngineError_(code) {
    var scr = ST().screen === 'screen-mark' ? 'mark' : 'study';
    if (code === C.ERR.PLAY_BLOCKED) RE.UI.showMessage(scr, C.MSG.PLAY_BLOCKED, true);
    else if (code === C.ERR.INTERRUPTED) RE.UI.showMessage(scr, C.MSG.INTERRUPTED);
    else if (code === C.ERR.TOO_LONG) RE.UI.showMessage(scr, C.MSG.DOUBLE_TOO_LONG, true);
  }

  // 位置の表示を更新
  function refreshPosition_() {
    if (document.hidden) return;
    var scr = ST().screen;
    if (scr !== 'screen-study' && scr !== 'screen-words' && scr !== 'screen-mark') return;
    if (!ST().loadedArticleId) return;
    RE.UI.updatePosition(RE.Engine.getPositionSec());
  }

  // サービスワーカーを登録（失敗しても続ける）
  // 更新のお知らせ（KEecoloopと同じ仕組み。仕様 8.11）
  // 起動したときにサービスワーカーが働いていた場合だけ、新しい版に切り替わったら帯を出す（初めて入れたときは出さない）
  function registerServiceWorker_() {
    if (!('serviceWorker' in navigator)) return;
    var hadController = !!navigator.serviceWorker.controller;
    navigator.serviceWorker.addEventListener('controllerchange', function () {
      if (hadController) RE.UI.showUpdateBanner();
    });
    navigator.serviceWorker.register('./sw.js').then(function (reg) {
      swReg_ = reg; lastUpdateCheck_ = Date.now();
    }).catch(function () { /* 無視 */ });
  }
  // 前面に戻ったとき、前回の確認から UPDATE_CHECK_MIN_MS（10分）以上なら新しい版を確かめる
  function checkUpdate_() {
    if (!swReg_ || Date.now() - lastUpdateCheck_ < C.UPDATE_CHECK_MIN_MS) return;
    lastUpdateCheck_ = Date.now();
    swReg_.update().catch(function () { /* 無視 */ });
  }

  // ロック画面・イヤホンの操作が連打されたら2回目を無視する
  function remoteAllowed_() {
    var now = Date.now();
    if (now - lastRemote_ < C.REMOTE_DEBOUNCE_MS) return false;
    lastRemote_ = now;
    return true;
  }
  // 再生／一時停止（命令の名前ではなく、今の状態で切り替える）
  function remoteToggle_() {
    if (!remoteAllowed_()) return;
    if (ST().screen === 'screen-mark') handlers.onMarkPlay(); else handlers.onPlayPause();
  }

  function start() {
    RE.State.init();
    RE.UI.init(handlers);
    RE.Engine.init({ onStateChange: onEngineStateChange_, onError: onEngineError_ });
    RE.Engine.setMode(C.MODE.SINGLE);
    RE.Engine.setGap(ST().gapSec);
    RE.MediaSession.init({
      onPlay: function () { remoteToggle_(); },
      onPause: function () { remoteToggle_(); },
      onStop: function () {
        if (!remoteAllowed_()) return;
        if (ST().playerState === S.PLAYING) RE.Engine.pause(); else RE.Engine.stop();
      },
      onNext: function () {
        if (!remoteAllowed_() || (ST().screen !== 'screen-study' && ST().screen !== 'screen-words')) return;
        handlers.onNextChunk();
      }
    });
    RE.UI.applyFontSize();
    RE.Db.requestPersist();
    registerServiceWorker_();
    openLibrary();
    setInterval(refreshPosition_, C.UI_REFRESH_MS);
    document.addEventListener('visibilitychange', function () {
      if (!document.hidden) { refreshPosition_(); RE.UI.renderPlayButtons(); checkUpdate_(); }
    });
  }

  // 記事を開く。mode: 'auto'（記録済みなら学習、未記録なら記録）／'mark'（必ず記録画面）
  function openArticle_(id, mode) {
    var st = ST();
    RE.UI.clearMessage('library');
    return RE.Db.getArticle(id).then(function (a) {
      if (!a) { RE.UI.showMessage('library', M.LOAD_ERROR, true); return; }
      var view = buildView_(a.articleText, a.csvText);
      syncSections_(a, view);
      migrateSync_(a);
      st.article = a; st.view = view;
      var pull = Promise.resolve('off');
      if (canSync_(a)) { st.syncStatus = 'checking'; pull = queueSync_(function () { return pullSync_(a); }); }
      else st.syncStatus = 'off';
      var load = Promise.resolve(true);
      if (st.loadedArticleId !== id) {
        RE.UI.showMessage('library', M.LOADING);
        load = RE.Db.getAudio(id).then(function (rec) {
          if (!rec) return false;
          var file = new File([rec.blob], rec.name || 'audio', { type: rec.type || rec.blob.type || '' });
          st.loadedArticleId = '';
          return RE.Engine.loadFile(file, 'A').then(function (res) {
            st.loadedArticleId = id;
            st.rate = C.RATE_DEFAULT;
            RE.Engine.setRate(C.RATE_DEFAULT);
            a.durationSec = res.durationSec;
            return true;
          });
        }).catch(function (e) { console.error(e); return false; });
      }
      return Promise.all([load, pull]).then(function (rs) {
        var ok = rs[0];
        if (!ok) { RE.UI.showMessage('library', M.LOAD_ERROR, true); return; }
        RE.UI.clearMessage('library');
        saveArticle_();
        RE.MediaSession.setMetadata(a.title);
        RE.MediaSession.register();
        if (mode === 'mark' || !a.marked) {
          openMark_(mode === 'mark' && a.marked);
          if (mode !== 'mark' && id !== newArticleId_) RE.UI.showMessage('mark', M.NEED_MARK);
          newArticleId_ = '';
        } else {
          openStudyLast_();
        }
        if (st.syncAppliedFrom) { showSyncMsg_(fill(M.SYNC_APPLIED, { device: st.syncAppliedFrom })); st.syncAppliedFrom = null; }
      });
    });
  }

  // ===== 学習 =====

  // 最後に開いた区間（無ければ最初の再生できる区間）で学習画面を開く
  function openStudyLast_() {
    var a = ST().article, nav;
    ST().blockId = ''; ST().partIndex = -1;
    nav = navList();
    var pick = null;
    nav.forEach(function (n) { if (!pick && n.blockId === a.lastBlockId && n.part === (a.lastPart || 0)) pick = n; });
    if (!pick) nav.forEach(function (n) { if (!pick && n.blockId === a.lastBlockId) pick = n; });
    if (!pick) nav.forEach(function (n) { if (!pick && n.part >= 0) pick = n; });
    if (!pick) pick = nav[0];
    openStudy_(pick.blockId, pick.part);
  }

  // 学習を開く（タブ「単語」。仕様 8.9）。記録画面のエンジンの設定が残っていれば元に戻す
  function openStudy_(blockId, part) {
    ST().sheetOpen = false;
    if (ST().engineMode === 'mark') leaveMark_();
    RE.UI.showScreen('screen-words');
    RE.UI.clearMessage('study');
    goSection_(blockId, part);
  }

  // 区間を切り替える（再生中なら新しい区間の頭から再生を続ける）
  function goSection_(blockId, part) {
    var st = ST(), a = st.article;
    var sameBlock = st.blockId === blockId;
    st.blockId = blockId;
    st.partIndex = typeof part === 'number' ? part : -1;
    var sec = sectionRange_(blockId, st.partIndex);
    st.rangeStart = sec ? sec.start : 0;
    st.rangeEnd = sec ? Math.min(sec.start + C.END_DEFAULT_SEC, sec.end) : 0;
    if (blockId !== K.SECTION_NONE && (a.lastBlockId !== blockId || a.lastPart !== st.partIndex)) {
      a.lastBlockId = blockId; a.lastPart = st.partIndex; saveArticle_();
    }
    if (sec) applyRange_(true);
    else {
      RE.Engine.stop();
      RE.UI.showMessage('study', blockId === K.SECTION_NONE ? '' : M.NO_AUDIO_SECTION);
    }
    RE.UI.renderStudyTop();
    if (!sameBlock) RE.UI.renderWordList();
    else { st.scrollPos['screen-words'] = 0; if (st.screen === 'screen-words') window.scrollTo(0, 0); }
  }

  // ===== 記録（仕様 8.4） =====

  // 記録画面を開く。fromSaved が true なら保存済みの区間を並べて始める
  function openMark_(fromSaved) {
    var st = ST(), a = st.article;
    enterMarkEngine_();
    st.markArticleId = a.articleId;
    st.markParts = a.sections.map(function (s) {
      return fromSaved ? s.parts.map(function (pt) { return { s: pt.s, e: pt.e }; }) : undefined;
    });
    st.markIndex = fromSaved ? a.sections.length : 0;
    st.markState = 'idle';
    st.markHistory = [];
    st.markFromSaved = !!fromSaved;
    st.markResetPending = false;
    RE.UI.showScreen('screen-mark');
    RE.UI.clearMessage('mark');
    RE.UI.renderMark();
    RE.UI.updatePosition(0);
  }

  // 記録画面のためにエンジンを設定する（倍速1・間0・音声全体。設定値は書き換えない）
  function enterMarkEngine_() {
    var a = ST().article;
    RE.Engine.stop();
    RE.Engine.setRate(1);
    RE.Engine.setGap(0);
    RE.Engine.setSection(0, a.durationSec, 'A');
    ST().engineMode = 'mark';
  }

  // 途中の記録のまま、記録画面に戻る（タブを移って戻ったとき。仕様 8.9）
  function resumeMark_() {
    enterMarkEngine_();
    RE.UI.showScreen('screen-mark');
    RE.UI.renderMark();
    RE.UI.updatePosition(0);
  }

  // 記録画面を出るとき、再生の設定を元に戻す
  function leaveMark_() {
    RE.Engine.stop();
    RE.Engine.setGap(ST().gapSec);
    RE.Engine.setRate(ST().rate);
    ST().engineMode = 'study';
  }

  // 記録画面の再生範囲を q 秒〜最後にする
  function markSeekTo_(q) {
    var a = ST().article, playing = RE.Engine.getState() === S.PLAYING;
    RE.Engine.setSection(q, a.durationSec, 'A', playing);
    if (playing) RE.Engine.playFromStart(); else RE.Engine.stop();
    RE.UI.updatePosition(q);
  }

  // 「1つ取り消す」用に、今の状態の控えを取る
  function markSnapshot_() {
    var st = ST();
    st.markHistory.push({
      parts: st.markParts.map(function (ps) { return ps === undefined ? undefined : ps.map(function (pt) { return { s: pt.s, e: pt.e }; }); }),
      index: st.markIndex, state: st.markState
    });
    if (st.markHistory.length > K.MARK_UNDO_MAX) st.markHistory.shift();
  }

  // 記録した区間を時間の順に並べた一覧 [{bi, pi, pt}]
  function markFlat_() {
    var out = [];
    ST().markParts.forEach(function (ps, bi) { (ps || []).forEach(function (pt, pi) { out.push({ bi: bi, pi: pi, pt: pt }); }); });
    return out;
  }

  // これまでに記録したすべての s・e の最大
  function markLast_() {
    var last = 0;
    markFlat_().forEach(function (x) { last = Math.max(last, x.pt.s, x.pt.e === null ? 0 : x.pt.e); });
    return last;
  }

  // 開いている区間（今の節の最後の区間で、終了が未定のもの）
  function markOpenPart_() {
    var st = ST(), bi = st.markIndex - 1;
    if (st.markState !== 'open' || bi < 0) return null;
    var ps = st.markParts[bi];
    return ps && ps.length ? ps[ps.length - 1] : null;
  }

  // ボタンを押した時刻（押す遅れを補う）
  function markTapTime_() {
    return Math.max(0, Math.floor(RE.Engine.getPositionSec()) - K.MARK_LEAD_SEC);
  }

  // 次の節に新しい区間を作って進む（ここから・次節START）
  function markStartNext_() {
    var st = ST();
    if (st.markIndex >= st.markParts.length) return;
    markSnapshot_();
    var t = Math.max(markTapTime_(), markLast_());
    var open = markOpenPart_();
    if (open) { if (t <= open.s) t = open.s + 1; open.e = t; }
    st.markParts[st.markIndex] = [{ s: t, e: null }];
    st.markIndex++;
    st.markState = 'open';
    RE.UI.clearMessage('mark');
    RE.UI.renderMark();
  }

  // 前後の区間（終了が未定ならその開始）を返す
  function markNeighbors_(bi, pi) {
    var flat = markFlat_(), k, idx = -1;
    for (k = 0; k < flat.length; k++) if (flat[k].bi === bi && flat[k].pi === pi) { idx = k; break; }
    return { prev: idx > 0 ? flat[idx - 1].pt : null, next: idx >= 0 && idx < flat.length - 1 ? flat[idx + 1].pt : null };
  }

    // ===== 取り込み（共通） =====

  // 本文・CSVを確かめる。問題なければ view、だめなら null（メッセージを出す）
  function checkDraft_(draft, screenId) {
    var view = buildView_(draft.text || '', draft.csvText || '');
    if (!parseOk_(view.parsed)) { RE.UI.showMessage(screenId, M.PARSE_ERROR, true); return null; }
    if (!view.itemCount) { RE.UI.showMessage(screenId, M.CSV_ERROR, true); return null; }
    return view;
  }

  // 追加画面とドライブ取り込みで共通の保存（記事と音声を保存して記録画面へ）
  function saveNewArticle_(draft, screenId) {
    var view = checkDraft_(draft, screenId);
    if (!view) return Promise.resolve(false);
    var id = 'a' + Date.now();
    var t1 = view.parsed.units.filter(function (u) { return u.kind === 'title'; })[0];
    var title = (draft.title || '').trim() || (t1 ? t1.text.slice(0, K.TITLE_MAX) : '記事');
    var now = Date.now();
    var article = {
      articleId: id, title: title, createdAt: now, updatedAt: now,
      articleText: draft.text, csvText: draft.csvText,
      audioName: draft.file.name || '', durationSec: draft.durationSec || 0,
      sections: view.blocks.map(function (b) { return { id: b.id, parts: [], done: null }; }),
      marked: false, lastBlockId: '', lastPart: 0, driveFolderId: draft.driveFolderId || '',
      syncSavedAt: 0, syncDirty: false
    };
    // ドライブに受け渡しファイルがあれば、区切り・完了も一緒に入れる（仕様 8.7-3）
    if (draft.sync && RE.Sync.isValidFor(draft.sync, article)) {
      RE.Sync.apply(article, draft.sync);
      if (article.marked) ST().syncAppliedFrom = draft.sync.device || K.SYNC_DEVICE_OTHER;
    }
    return RE.Db.saveAudio(id, draft.file).then(function (ok) {
      if (!ok) return false;
      return RE.Db.saveArticle(article);
    }).then(function (ok) {
      if (!ok) { RE.Db.deleteArticle(id); RE.UI.showMessage(screenId, M.SAVE_ERROR, true); return false; }
      ST().importDraft = RE.State.newDraft();
      ST().drivePending = null;
      newArticleId_ = id;
      RE.UI.showScreen('screen-library');
      return openArticle_(id, 'auto').then(function () { return true; });
    });
  }

  // 予備の追加画面：本文とCSVの結果表示を更新
  function analyzeDraft_() {
    var d = ST().importDraft;
    if (!d.text.trim()) { RE.UI.setImportSummary('txt-parse-summary', ''); return; }
    var view = buildView_(d.text, d.csvText || '');
    if (!parseOk_(view.parsed)) {
      RE.UI.setImportSummary('txt-parse-summary', M.PARSE_ERROR, true);
    } else {
      RE.UI.setImportSummary('txt-parse-summary', parseSummary_(view));
      if (!d.title.trim()) {
        var t1 = view.parsed.units.filter(function (u) { return u.kind === 'title'; })[0];
        if (t1) { d.title = t1.text.slice(0, K.TITLE_MAX); RE.UI.setImportTitle(d.title); }
      }
    }
    if (d.csvText) {
      if (!view.itemCount) RE.UI.setImportSummary('txt-csv-summary', M.CSV_ERROR, true);
      else if (parseOk_(view.parsed)) RE.UI.setImportSummary('txt-csv-summary', csvSummary_(view));
    }
  }

  // ドライブ：一覧を読む
  function loadDriveList_() {
    var st = ST();
    if (!RE.Drive.isReady()) { st.driveList = []; renderDrive_(); RE.UI.showMessage('drive', M.DRIVE_NEED_SETTINGS, true); return Promise.resolve(); }
    RE.UI.showMessage('drive', M.DRIVE_LOADING_LIST);
    return RE.Drive.listArticles().then(function (res) {
      if (!res.ok) { st.driveList = []; renderDrive_(); RE.UI.showMessage('drive', driveErrorText_(res), true); return; }
      st.driveList = res.articles || [];
      return renderDrive_().then(function () {
        if (!st.driveList.length) RE.UI.showMessage('drive', M.DRIVE_EMPTY);
        else if (st.driveLinkId) showLinkHint_();
        else RE.UI.clearMessage('drive');
      });
    });
  }

  // ドライブ一覧の描画（取り込み済みの印のため、端末の記事を読む）
  function renderDrive_() {
    return RE.Db.listArticles().then(function (list) {
      var ids = list.map(function (a) { return a.driveFolderId; }).filter(Boolean);
      RE.UI.renderDrive(ids);
    });
  }

  // GASのエラーの文
  function driveErrorText_(res) {
    var c = res && res.code;
    if (c === 'BAD_KEY') return M.DRIVE_ERR_BAD_KEY;
    if (c === 'NETWORK' || c === 'TIMEOUT') return M.DRIVE_ERR_NETWORK;
    if (c === 'NO_SETTINGS') return M.DRIVE_NEED_SETTINGS;
    if (c === 'MISSING_FILES') return fill(M.DRIVE_MISSING, { list: '本文・CSV・音声のどれか' });
    if (c === 'DUPLICATE_FILES') return fill(M.DRIVE_DUPLICATE, { list: '本文・CSV・音声のどれか' });
    return fill(M.DRIVE_ERR_OTHER, { code: c || '?' });
  }

  // 結び付けるときの案内
  function showLinkHint_() {
    var st = ST(), a = (st.articles || []).filter(function (x) { return x.articleId === st.driveLinkId; })[0];
    RE.UI.showMessage('drive', fill(M.DRIVE_LINK_HINT, { title: a ? a.title : '' }));
  }

  // 節の並び（id をつないだ文字）
  function blockIds_(view) { return view.blocks.map(function (b) { return b.id; }).join(','); }

  // 予備の方法で追加した記事を、ドライブの記事フォルダと結び付ける（仕様 8.7.1）
  function linkDrive_(folderId) {
    var st = ST(), id = st.driveLinkId;
    var it = st.driveList.filter(function (x) { return x.folderId === folderId; })[0];
    if (!it) return Promise.resolve();
    var problem = driveProblemText(it);
    if (problem) { RE.UI.showMessage('drive', problem, true); return Promise.resolve(); }
    st.driveBusy = true; renderDrive_();
    RE.UI.showMessage('drive', M.DRIVE_LINK_CHECKING);
    return Promise.all([RE.Db.getArticle(id), RE.Drive.fetchTexts(folderId)]).then(function (rs) {
      var a = rs[0], res = rs[1];
      st.driveBusy = false;
      if (!a) { renderDrive_(); RE.UI.showMessage('drive', M.LOAD_ERROR, true); return; }
      if (!res.ok) { renderDrive_(); RE.UI.showMessage('drive', driveErrorText_(res), true); return; }
      var dv = buildView_(res.article || '', res.csv || ''), lv = buildView_(a.articleText, a.csvText);
      if (!parseOk_(dv.parsed) || blockIds_(dv) !== blockIds_(lv)) {
        renderDrive_(); RE.UI.showMessage('drive', fill(M.DRIVE_LINK_MISMATCH, { title: a.title }), true); return;
      }
      syncSections_(a, lv);
      a.driveFolderId = folderId;
      a.syncSavedAt = 0;
      a.syncDirty = hasLocalData_(a);
      return RE.Db.saveArticle(a).then(function (ok) {
        if (!ok) { renderDrive_(); RE.UI.showMessage('drive', M.SAVE_ERROR, true); return; }
        st.driveLinkId = '';
        RE.UI.showScreen('screen-library');
        // 開く手順の中で、ドライブとそろえる（送る・読み込む・確認画面。仕様 6.7.5）
        return openArticle_(id, 'auto').then(function () {
          if (!st.syncRemote && !st.syncAppliedFrom) showSyncMsg_(M.DRIVE_LINKED);
        });
      });
    }).catch(function (e) {
      console.error(e);
      st.driveBusy = false; renderDrive_();
      RE.UI.showMessage('drive', fill(M.DRIVE_ERR_OTHER, { code: 'APP' }), true);
    });
  }

  // 音声が手に入ったあと、長さを調べて保存する
  function finishDriveImport_(draft, file) {
    var st = ST();
    draft.file = file;
    st.driveBusy = true; renderDrive_();
    return getDuration_(file).then(function (d) {
      draft.durationSec = d;
      return saveNewArticle_(draft, 'drive');
    }).then(function () {
      st.driveBusy = false;
      if (st.screen === 'screen-drive') renderDrive_();
    });
  }

  // ===== 操作 =====

  var handlers = {
    // --- 一覧 ---
    onOpenArticle: function (id) { openArticle_(id, 'auto'); },
    onRemark: function (id) { openArticle_(id, 'mark'); },
    onDeleteArticle: function (id) {
      var st = ST();
      if (st.pendingDeleteId === id) {
        clearTimeout(deleteTimer_);
        st.pendingDeleteId = '';
        if (st.loadedArticleId === id) { RE.Engine.stop(); st.loadedArticleId = ''; st.article = null; st.view = null; }
        RE.Db.deleteArticle(id).then(function () {
          openLibrary().then(function () { RE.UI.showMessage('library', M.DELETED); });
        });
        return;
      }
      st.pendingDeleteId = id;
      RE.UI.renderLibrary(st.articles);
      RE.UI.showMessage('library', M.DELETE_CONFIRM);
      clearTimeout(deleteTimer_);
      deleteTimer_ = setTimeout(function () {
        st.pendingDeleteId = '';
        RE.UI.renderLibrary(st.articles);
        RE.UI.clearMessage('library');
      }, 3000);
    },
    // 更新のお知らせ帯を押した：読み込み直して新しい版にする（自動では読み込み直さない）
    onUpdateTap: function () { RE.Engine.stop(); location.reload(); },
    // 下のタブ（仕様 8.9）
    onTab: function (name) {
      var st = ST(), a = st.article, from = st.screen;
      if (st.driveBusy) return;
      if ((name === 'play' || name === 'words' || name === 'mark') && !a) return;
      if (name === 'mark') {
        if (from === 'screen-mark') return;
        if (st.markArticleId === a.articleId) resumeMark_(); else openMark_(!!a.marked);
        return;
      }
      if (from === 'screen-mark') leaveMark_();
      if (name === 'library') { openLibrary(); return; }
      if (name === 'settings') { handlers.onOpenSettings(); return; }
      // 再生・単語
      if (!a.marked) {
        if (st.markArticleId === a.articleId) resumeMark_(); else openMark_(false);
        RE.UI.showMessage('mark', M.NEED_MARK);
        return;
      }
      var target = name === 'play' ? 'screen-study' : 'screen-words';
      if (!st.blockId) { openStudyLast_(); RE.UI.showScreen(target); return; }
      RE.UI.showScreen(target);
      if (from === 'screen-mark' && currentRange()) applyRange_(false);
      RE.UI.renderStudyTop();
    },
    onOpenSettings: function () {
      RE.UI.showScreen('screen-settings');
      RE.UI.clearMessage('settings');
      RE.UI.renderSettings();
    },
    onAddDrive: function () {
      ST().drivePending = null;
      ST().driveLinkId = '';
      RE.UI.showScreen('screen-drive');
      RE.UI.clearMessage('drive');
      loadDriveList_();
    },
    onAddArticle: function () {
      ST().importDraft = RE.State.newDraft();
      RE.UI.showScreen('screen-import');
      RE.UI.clearMessage('import');
      RE.UI.renderImport();
    },

    // --- ドライブ ---
    onDriveBack: function () { if (!ST().driveBusy) { ST().driveLinkId = ''; openLibrary(); } },
    onLinkDrive: function (id) {
      var st = ST();
      st.drivePending = null;
      st.driveLinkId = id;
      RE.UI.showScreen('screen-drive');
      showLinkHint_();
      loadDriveList_();
    },
    onDriveReload: function () { if (!ST().driveBusy) { ST().drivePending = null; loadDriveList_(); } },
    onDriveImport: function (folderId) {
      var st = ST();
      if (st.driveBusy) return;
      if (st.driveLinkId) { linkDrive_(folderId); return; }
      var it = st.driveList.filter(function (x) { return x.folderId === folderId; })[0];
      if (!it) return;
      var problem = driveProblemText(it);
      if (problem) { RE.UI.showMessage('drive', problem, true); return; }
      st.drivePending = null;
      st.driveBusy = true; renderDrive_();
      RE.UI.showMessage('drive', M.DRIVE_LOADING_TEXT);
      RE.Drive.fetchTexts(folderId).then(function (res) {
        if (!res.ok) { st.driveBusy = false; renderDrive_(); RE.UI.showMessage('drive', driveErrorText_(res), true); return; }
        var draft = { text: res.article || '', csvText: res.csv || '', file: null, durationSec: 0, title: it.name, driveFolderId: folderId, sync: res.sync || null };
        if (!checkDraft_(draft, 'drive')) { st.driveBusy = false; renderDrive_(); return; }
        RE.UI.showMessage('drive', fill(M.DRIVE_LOADING_AUDIO, { n: 0, m: '?' }));
        return RE.Drive.fetchAudio(folderId, function (n, m) {
          RE.UI.showMessage('drive', fill(M.DRIVE_LOADING_AUDIO, { n: n, m: m }));
        }).then(function (ar) {
          if (ar && ar.ok) { st.driveBusy = false; return finishDriveImport_(draft, ar.file); }
          st.driveBusy = false;
          st.drivePending = draft;
          renderDrive_();
          RE.UI.showMessage('drive', M.DRIVE_AUDIO_FAILED, true);
        });
      }).catch(function (e) {
        console.error(e);
        st.driveBusy = false; renderDrive_();
        RE.UI.showMessage('drive', fill(M.DRIVE_ERR_OTHER, { code: 'APP' }), true);
      });
    },
    onDriveAudioPicked: function (file) {
      var draft = ST().drivePending;
      if (!draft) return;
      finishDriveImport_(draft, file);
    },

    // --- 予備の追加 ---
    onImportBack: function () { openLibrary(); },
    onArticleInput: function (text) {
      ST().importDraft.text = text;
      clearTimeout(inputTimer_);
      inputTimer_ = setTimeout(analyzeDraft_, 500);
    },
    onTxtSelected: function (file) {
      file.text().then(function (t) {
        ST().importDraft.text = t;
        RE.UI.setArticleText(t);
        analyzeDraft_();
      });
    },
    onCsvSelected: function (file) {
      file.text().then(function (t) {
        ST().importDraft.csvText = t;
        if (!RE.Lexicon.itemsFromCsv(t).length) { RE.UI.setImportSummary('txt-csv-summary', M.CSV_ERROR, true); return; }
        if (!ST().importDraft.text.trim()) { RE.UI.setImportSummary('txt-csv-summary', file.name); return; }
        analyzeDraft_();
      });
    },
    onAudioSelected: function (file) {
      var d = ST().importDraft;
      d.file = file;
      RE.UI.setImportSummary('txt-audio-summary', fill(M.AUDIO_OK, { name: file.name, dur: '…' }));
      getDuration_(file).then(function (sec) {
        d.durationSec = sec;
        RE.UI.setImportSummary('txt-audio-summary', fill(M.AUDIO_OK, { name: file.name, dur: sec ? RE.Utils.formatTime(sec) : '--:--' }));
      });
    },
    onImportSave: function () {
      var d = ST().importDraft;
      if (!d.text.trim() || !d.csvText || !d.file) { RE.UI.showMessage('import', M.NEED_ALL, true); return; }
      saveNewArticle_(d, 'import');
    },

    // --- 記録 ---
    // やめる：途中の記録を捨てる。記録済みの記事なら単語タブ、まだなら記事一覧へ
    onMarkBack: function () {
      var a = ST().article;
      ST().markArticleId = '';
      leaveMark_();
      if (a && a.marked) openStudyLast_(); else openLibrary();
    },
    onMarkPlay: function () {
      if (RE.Engine.getState() === S.PLAYING) RE.Engine.pause(); else RE.Engine.play();
    },
    onMarkSeek: function (delta) {
      var a = ST().article;
      var q = Math.floor(RE.Engine.getPositionSec()) + delta;
      q = Math.min(Math.max(q, 0), Math.max(0, Math.floor(a.durationSec) - 1));
      markSeekTo_(q);
    },
    onMarkHere: function () { markStartNext_(); },
    onMarkBreak: function () {
      var st = ST(), bi = st.markIndex - 1;
      if (bi < 0) return;
      if (st.markState === 'open') {
        var open = markOpenPart_(); if (!open) return;
        if (st.markParts[bi].length >= K.PART_LETTERS.length) { RE.UI.showMessage('mark', M.MARK_PART_MAX, true); return; }
        markSnapshot_();
        open.e = Math.max(markTapTime_(), open.s + 1);
        st.markState = 'paused';
      } else if (st.markState === 'paused') {
        markSnapshot_();
        st.markParts[bi].push({ s: Math.max(markTapTime_(), markLast_()), e: null });
        st.markState = 'open';
      } else return;
      RE.UI.clearMessage('mark');
      RE.UI.renderMark();
    },
    onMarkEnd: function () {
      var st = ST();
      if (st.markState === 'idle') { markStartNext_(); return; }
      markSnapshot_();
      var open = markOpenPart_();
      if (open) open.e = Math.max(markTapTime_(), open.s + 1);
      st.markState = 'idle';
      RE.UI.clearMessage('mark');
      RE.UI.renderMark();
    },
    onMarkSkip: function () {
      var st = ST();
      if (st.markIndex >= st.markParts.length) return;
      markSnapshot_();
      st.markParts[st.markIndex] = [];
      st.markIndex++;
      RE.UI.renderMark();
    },
    onMarkUndo: function () {
      var st = ST(), h = st.markHistory.pop();
      if (!h) return;
      st.markParts = h.parts; st.markIndex = h.index; st.markState = h.state;
      RE.UI.clearMessage('mark');
      RE.UI.renderMark();
    },
    onMarkAdjust: function (bi, pi, which, delta) {
      var st = ST(), ps = st.markParts[bi], pt = ps && ps[pi];
      if (!pt) return;
      var nb = markNeighbors_(bi, pi), ns = pt.s, ne = pt.e;
      if (which === 'e') { if (ne === null) return; ne += delta; } else ns += delta;
      var prevEnd = nb.prev ? (nb.prev.e === null ? nb.prev.s + 1 : nb.prev.e) : 0;
      var bad = ns < 0 || ns < prevEnd || (ne !== null && (ns >= ne || ne > st.article.durationSec)) ||
                (ne !== null && nb.next && ne > nb.next.s) || (ne === null && nb.next && ns >= nb.next.s);
      if (bad) { RE.UI.showMessage('mark', M.MARK_ORDER, true); return; }
      markSnapshot_();
      pt.s = ns; pt.e = ne;
      RE.UI.clearMessage('mark');
      RE.UI.renderMark();
    },
    onMarkPreview: function (bi, pi) {
      var st = ST(), ps = st.markParts[bi], pt = ps && ps[pi];
      if (!pt) return;
      var nb = markNeighbors_(bi, pi);
      var end = pt.e !== null ? pt.e : (nb.next ? nb.next.s : st.article.durationSec);
      if (!(end > pt.s)) return;
      RE.Engine.setSection(pt.s, end, 'A', true);
      RE.Engine.playFromStart();
    },
    onMarkReset: function () {
      var st = ST();
      if (!st.markResetPending) {
        st.markResetPending = true;
        RE.UI.renderMark();
        RE.UI.showMessage('mark', M.MARK_RESET_CONFIRM);
        clearTimeout(deleteTimer_);
        deleteTimer_ = setTimeout(function () { st.markResetPending = false; RE.UI.renderMark(); RE.UI.clearMessage('mark'); }, 3000);
        return;
      }
      clearTimeout(deleteTimer_);
      st.markResetPending = false;
      st.markParts = st.markParts.map(function () { return undefined; });
      st.markIndex = 0; st.markState = 'idle'; st.markHistory = [];
      markSeekTo_(0);
      RE.UI.clearMessage('mark');
      RE.UI.renderMark();
    },
    onMarkSave: function () {
      var st = ST(), a = st.article;
      var flat = markFlat_();
      if (!flat.length) { RE.UI.showMessage('mark', M.NEED_MARK, true); return; }
      // 終了が未定の区間は、後ろの区間の開始（無ければ音声の終わり）まで
      flat.forEach(function (x, k) {
        if (x.pt.e === null) x.pt.e = k < flat.length - 1 ? flat[k + 1].pt.s : Math.floor(a.durationSec);
        if (!(x.pt.e > x.pt.s)) x.pt.e = x.pt.s + 1;
      });
      a.sections.forEach(function (sec, bi) {
        var ps = st.markParts[bi] || [];
        sec.parts = ps.filter(function (pt) { return pt.e > pt.s; }).map(function (pt) { return { s: pt.s, e: pt.e }; });
      });
      a.marked = true;
      st.markArticleId = '';
      markChanged_();
      leaveMark_();
      openStudyLast_();
    },

    // --- 学習 ---
    onSectionGo: function (blockId, part) { RE.UI.clearMessage('study'); goSection_(blockId, part); },
    onSectionPrev: function () {
      var nav = navList(), i = navIndex();
      if (i > 0) handlers.onSectionGo(nav[i - 1].blockId, nav[i - 1].part);
    },
    onSectionNext: function () {
      var nav = navList(), i = navIndex();
      if (i < nav.length - 1) handlers.onSectionGo(nav[i + 1].blockId, nav[i + 1].part);
    },
    onToggleRangeEdit: function () { ST().rangeEditOpen = !ST().rangeEditOpen; RE.UI.renderStudyTop(); },
    onStartStep: function (delta) {
      var st = ST(), sec = partRange_(), r = currentRange(); if (!sec || !r) return;
      var n = RE.Utils.clamp(r.s + delta, sec.start, Math.max(Math.ceil(r.e) - 1, sec.start));
      if (n === r.s) return;
      RE.UI.clearMessage('study');
      setRange_(n, r.e, true, false);
    },
    onEndStep: function (delta) {
      var st = ST(), sec = partRange_(), r = currentRange(); if (!sec || !r) return;
      var n = RE.Utils.clamp(Math.floor(r.e) + delta, r.s + 1, sec.end);
      if (n === r.e) return;
      RE.UI.clearMessage('study');
      setRange_(r.s, n, false, false);
    },
    onMarkRange: function (which) {
      var sec = partRange_(), r = currentRange(); if (!sec || !r) return;
      var stt = RE.Engine.getState();
      if (stt !== S.PLAYING && stt !== S.PAUSED) { RE.UI.showMessage('study', C.MSG.MARK_NEED_PLAY); return; }
      var pos = RE.Engine.getPositionSec();
      RE.UI.clearMessage('study');
      if (which === 'start') {
        var n = RE.Utils.clamp(Math.floor(pos), sec.start, Math.max(Math.ceil(r.e) - 1, sec.start));
        if (n !== r.s) setRange_(n, r.e, true, false);
      } else {
        var m = RE.Utils.clamp(Math.ceil(pos), r.s + 1, sec.end);
        if (m !== r.e) setRange_(r.s, m, false, false);
      }
    },
    onSelectAll: function () {
      var sec = partRange_(); if (!sec) return;
      RE.UI.clearMessage('study');
      setRange_(sec.start, sec.end, true, false);
    },
    onPlayPause: function () {
      if (!currentRange()) { RE.UI.showMessage('study', M.NO_AUDIO_SECTION); return; }
      if (RE.Engine.getState() === S.PLAYING) RE.Engine.pause();
      else { RE.UI.clearMessage('study'); RE.Engine.play(); }
    },
    onStop: function () { RE.Engine.stop(); },
    onNextChunk: function () {
      var sec = partRange_(), r = currentRange(); if (!sec || !r) return;
      var step = RE.Utils.calcStepSec(ST().moveSec);
      if (r.e >= sec.end || r.s + step >= sec.end) { RE.UI.showMessage('study', M.REACHED_PART_END); return; }
      RE.UI.clearMessage('study');
      setRange_(r.s + step, Math.min(r.e + step, sec.end), true, true);
    },
    onPrevChunk: function () {
      var sec = partRange_(), r = currentRange(); if (!sec || !r) return;
      var d = Math.min(RE.Utils.calcStepSec(ST().moveSec), r.s - sec.start);
      if (d <= 0) { RE.UI.showMessage('study', C.MSG.REACHED_START); return; }
      RE.UI.clearMessage('study');
      setRange_(r.s - d, r.e - d, true, true);
    },
    onComplete: function () {
      var st = ST(), a = st.article, s = sectionEntry(st.blockId);
      if (!s || !s.parts.length) return;
      if (s.done) {
        s.done = null;
        markChanged_();
        RE.UI.renderStudyTop();
        return;
      }
      s.done = RE.Progress.todayKey();
      markChanged_();
      var idx = a.sections.indexOf(s), next = null;
      for (var i = idx + 1; i < a.sections.length; i++) if (a.sections[i].parts.length) { next = a.sections[i]; break; }
      if (next) { RE.Engine.stop(); goSection_(next.id, 0); }
      else RE.UI.renderStudyTop();
      if (RE.Progress.calc(a.sections, st.deadlineWeekday).allDone) RE.UI.showMessage('study', M.ALL_DONE);
    },
    // --- 受け渡しの確認（仕様 8.8） ---
    onSyncUseRemote: function () {
      var st = ST(), a = st.article, r = st.syncRemote;
      st.syncRemote = null;
      RE.UI.renderSyncSheet(false);
      if (!a || !r) return;
      RE.Sync.apply(a, r);
      st.syncStatus = 'same';
      saveArticle_().then(function () {
        reopenAfterSync_(fill(M.SYNC_REPLACED, { device: r.device || K.SYNC_DEVICE_OTHER }));
      });
    },
    onSyncKeepLocal: function () {
      var st = ST(), a = st.article;
      st.syncRemote = null;
      RE.UI.renderSyncSheet(false);
      if (!a) return;
      queueSync_(function () { return pushSync_(a, true); }).then(function (status) {
        if (status === 'same') showSyncMsg_(M.SYNC_KEPT);
      });
    },
    onMoveStep: function (delta) {
      applyMove_(RE.Utils.clamp(ST().moveSec + delta, C.MOVE_SEC_MIN, C.MOVE_SEC_MAX));
    },
    onMoveCommitted: function (text) {
      var n = parseFloat(RE.Utils.toHalfWidth(text));
      if (!isFinite(n)) { RE.UI.showMessage('study', C.MSG.MOVE_SEC_INVALID, true); RE.UI.renderStudyTop(); return; }
      n = Math.round(n);
      var c = RE.Utils.clamp(n, C.MOVE_SEC_MIN, C.MOVE_SEC_MAX);
      if (c !== n) RE.UI.showMessage('study', C.MSG.MOVE_SEC_CLAMPED);
      applyMove_(c);
    },
    onGapSelect: function (g) {
      ST().gapSec = g;
      RE.Utils.saveGapSec(g);
      RE.Engine.setGap(g);
      RE.UI.renderStudyTop();
    },
    onRateSelect: function (rate) {
      var st = ST(), r = currentRange();
      if (!r) { RE.UI.showMessage('study', M.NO_AUDIO_SECTION); return; }
      if (rate !== 1 && r.e - r.s > C.STRETCH_MAX_SECTION_SEC) { RE.UI.showMessage('study', C.MSG.RATE_TOO_LONG, true); return; }
      st.rate = rate;
      RE.Engine.setRate(rate);
      RE.Engine.setSection(r.s, r.e, 'A', true);
      RE.UI.clearMessage('study');
      RE.Engine.playFromStart();
      RE.UI.renderStudyTop();
    },

    // --- 設定 ---
    onFontSelect: function (f) {
      ST().fontSize = f;
      try { localStorage.setItem(K.STORAGE_KEY_FONT, f); } catch (e) { /* 無視 */ }
      RE.UI.applyFontSize();
      RE.UI.renderSettings();
    },
    onDeadlineSelect: function (w) {
      ST().deadlineWeekday = w;
      try { localStorage.setItem(K.STORAGE_KEY_DEADLINE, String(w)); } catch (e) { /* 無視 */ }
      RE.UI.renderSettings();
    },
    // ☁ の行を押したとき：今すぐドライブとそろえ直す（仕様 6.7.9）
    onSyncRetry: function () {
      var st = ST(), a = st.article;
      if (!a || !canSync_(a)) return;
      st.syncError = ''; st.syncStatus = 'checking'; RE.UI.renderSyncStatus();
      queueSync_(function () { return pullSync_(a); }).then(function (status) {
        if (status === 'applied') {
          var dev = st.syncAppliedFrom || K.SYNC_DEVICE_OTHER; st.syncAppliedFrom = null;
          reopenAfterSync_(fill(M.SYNC_APPLIED, { device: dev }));
        }
      });
    },
    // 控えのファイルに書き出す（仕様 8.6.1）
    onBackupExport: function () {
      RE.Db.listArticles().then(function (list) {
        if (!list.length) { RE.UI.showMessage('settings', M.BACKUP_EMPTY, true); return; }
        var now = new Date(), p = function (n) { return (n < 10 ? '0' : '') + n; };
        var name = M.BACKUP_FILE_PREFIX + now.getFullYear() + p(now.getMonth() + 1) + p(now.getDate()) + '-' + p(now.getHours()) + p(now.getMinutes()) + '.json';
        var data = { app: K.SYNC_APP, kind: 'backup', format: K.SYNC_FORMAT, device: RE.Sync.deviceName(), savedAt: Date.now(),
          articles: list.map(function (a) {
            return { title: a.title, driveFolderId: a.driveFolderId || '', blockIds: (a.sections || []).map(function (s) { return s.id; }),
                     marked: !!a.marked, sections: RE.Sync.makeData(a).sections };
          }) };
        var blob = new Blob([JSON.stringify(data, null, 1)], { type: 'application/json' });
        var url = URL.createObjectURL(blob), link = document.createElement('a');
        link.href = url; link.download = name; document.body.appendChild(link); link.click();
        setTimeout(function () { URL.revokeObjectURL(url); link.remove(); }, 60000);
        RE.UI.showMessage('settings', fill(M.BACKUP_EXPORTED, { name: name, n: list.length }));
      });
    },
    // 控えのファイル（または keecolexico-sync.json）から読み込む（仕様 8.6.1）
    onBackupImport: function (file) {
      file.text().then(function (txt) {
        var d = null;
        try { d = JSON.parse(txt); } catch (e) { d = null; }
        var entries = null;
        if (d && d.app === K.SYNC_APP && d.kind === 'backup' && Array.isArray(d.articles)) entries = d.articles;
        else if (d && d.app === K.SYNC_APP && Array.isArray(d.sections)) entries = [{ blockIds: d.sections.map(function (s) { return s && s.id; }), marked: d.marked, sections: d.sections }];
        if (!entries) { RE.UI.showMessage('settings', M.BACKUP_BAD, true); return; }
        return RE.Db.listArticles().then(function (list) {
          var done = [], jobs = [];
          list.forEach(function (a) {
            var ids = (a.sections || []).map(function (s) { return s.id; }).join(',');
            var e = entries.filter(function (x) { return Array.isArray(x.blockIds) && x.blockIds.join(',') === ids; })[0];
            if (!e) return;
            var data = { app: K.SYNC_APP, format: K.SYNC_FORMAT, marked: !!e.marked, sections: e.sections, savedAt: a.syncSavedAt || 0 };
            if (!RE.Sync.isValidFor(data, a)) return;
            RE.Sync.apply(a, data);
            if (typeof a.syncSavedAt !== 'number') a.syncSavedAt = 0;
            a.syncDirty = true;   // 次に開いたとき、ドライブへも送る
            done.push(a.title);
            jobs.push(RE.Db.saveArticle(a));
          });
          if (!done.length) { RE.UI.showMessage('settings', M.BACKUP_NO_MATCH, true); return; }
          return Promise.all(jobs).then(function () {
            RE.UI.showMessage('settings', fill(M.BACKUP_IMPORTED, { titles: done.join('・') }));
          });
        });
      }).catch(function (e) { console.error(e); RE.UI.showMessage('settings', M.BACKUP_BAD, true); });
    },
    onGasSave: function (url, key) {
      RE.Drive.saveSettings(url, key);
      RE.UI.showMessage('settings', M.SETTINGS_SAVED);
    }
  };

  // 移動時間を変える（◯秒区切りなら今の区間の長さも変わる）
  function applyMove_(n) {
    var st = ST();
    st.moveSec = n;
    RE.Utils.saveMoveSec(n);
    RE.UI.renderStudyTop();
  }

  RE.Main = {
    start: start, handlers: handlers, buildView_: buildView_,
    navList: navList, navIndex: navIndex, partLabel: partLabel_, markNeighbors: markNeighbors_, sectionEntry: sectionEntry, currentRange: currentRange,
    studyProgressText: studyProgressText, libraryProgressText: libraryProgressText, driveProblemText: driveProblemText
  };

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start);
  else start();
})();
