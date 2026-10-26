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

  // 節の表示順（最後に「見つからなかった語」）
  function navList() {
    var v = ST().view; if (!v) return [];
    var list = v.blocks.map(function (b) { return { id: b.id, label: b.label }; });
    if (v.unmatched.length) list.push({ id: K.SECTION_NONE, label: '見つからなかった語（' + v.unmatched.length + '）' });
    return list;
  }
  function navIndex() {
    var id = ST().blockId, nav = navList();
    for (var i = 0; i < nav.length; i++) if (nav[i].id === id) return i;
    return 0;
  }

  // 記事に保存してある節の情報
  function sectionEntry(id) {
    var a = ST().article; if (!a) return null;
    for (var i = 0; i < a.sections.length; i++) if (a.sections[i].id === id) return a.sections[i];
    return null;
  }

  // 節の範囲 {start, end}。再生できない節は null（仕様 6.4）
  function sectionRange_(blockId) {
    var a = ST().article; if (!a) return null;
    var list = a.sections, i, idx = -1;
    for (i = 0; i < list.length; i++) if (list[i].id === blockId) { idx = i; break; }
    if (idx < 0 || list[idx].startSec === null || list[idx].startSec === undefined) return null;
    var end = a.durationSec;
    for (i = idx + 1; i < list.length; i++) if (list[i].startSec !== null && list[i].startSec !== undefined) { end = list[i].startSec; break; }
    if (!(end > list[idx].startSec)) return null;
    return { start: list[idx].startSec, end: end };
  }

  // いま再生する範囲 {s, e}（節全体／◯秒区切り）
  function currentRange() {
    var st = ST(), sec = sectionRange_(st.blockId);
    if (!sec) return null;
    if (st.repeatMode !== K.REPEAT.CHUNK) return { s: sec.start, e: sec.end };
    var s = Math.min(Math.max(st.chunkStart, sec.start), sec.end - 1);
    return { s: s, e: Math.max(s + 1, Math.min(s + st.moveSec, sec.end)) };
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
  function syncSections_(article, view) {
    var old = {}; (article.sections || []).forEach(function (s) { old[s.id] = s; });
    article.sections = view.blocks.map(function (b) {
      var o = old[b.id];
      return o ? { id: b.id, startSec: o.startSec === undefined ? null : o.startSec, done: o.done || null } : { id: b.id, startSec: null, done: null };
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
    if (scr !== 'screen-study' && scr !== 'screen-mark') return;
    if (!ST().loadedArticleId) return;
    RE.UI.updatePosition(RE.Engine.getPositionSec());
  }

  // サービスワーカーを登録（失敗しても続ける）
  function registerServiceWorker_() {
    if (!('serviceWorker' in navigator)) return;
    navigator.serviceWorker.register('./sw.js').catch(function () { /* 無視 */ });
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
        if (!remoteAllowed_() || ST().screen !== 'screen-study') return;
        if (ST().repeatMode === K.REPEAT.CHUNK) handlers.onNextChunk(); else handlers.onSectionNext();
      }
    });
    RE.UI.applyFontSize();
    RE.Db.requestPersist();
    registerServiceWorker_();
    openLibrary();
    setInterval(refreshPosition_, C.UI_REFRESH_MS);
    document.addEventListener('visibilitychange', function () {
      if (!document.hidden) { refreshPosition_(); RE.UI.renderPlayButtons(); }
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
      st.article = a; st.view = view;
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
      return load.then(function (ok) {
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
          openStudy_(a.lastBlockId && sectionEntry(a.lastBlockId) ? a.lastBlockId : view.blocks[0].id);
        }
      });
    });
  }

  // ===== 学習 =====

  function openStudy_(blockId) {
    ST().sheetOpen = false;
    RE.UI.showScreen('screen-study');
    RE.UI.clearMessage('study');
    goSection_(blockId);
  }

  // 節を切り替える（再生中なら新しい節の頭から再生を続ける）
  function goSection_(blockId) {
    var st = ST();
    st.blockId = blockId;
    var sec = sectionRange_(blockId);
    st.chunkStart = sec ? sec.start : 0;
    if (blockId !== K.SECTION_NONE && st.article.lastBlockId !== blockId) { st.article.lastBlockId = blockId; saveArticle_(); }
    if (sec) applyRange_(true);
    else {
      RE.Engine.stop();
      RE.UI.showMessage('study', blockId === K.SECTION_NONE ? '' : M.NO_AUDIO_SECTION);
    }
    RE.UI.renderStudyTop();
    RE.UI.renderWordList();
  }

  // ===== 記録 =====

  // 記録画面を開く。fromSaved が true なら保存済みの位置を並べて始める
  function openMark_(fromSaved) {
    var st = ST(), a = st.article;
    RE.Engine.stop();
    RE.Engine.setRate(1);
    RE.Engine.setGap(0);
    RE.Engine.setSection(0, a.durationSec, 'A');
    st.markTimes = a.sections.map(function (s) { return fromSaved ? s.startSec : undefined; });
    st.markIndex = fromSaved ? a.sections.length : 0;
    RE.UI.showScreen('screen-mark');
    RE.UI.clearMessage('mark');
    RE.UI.renderMark();
    RE.UI.updatePosition(0);
  }

  // 記録画面を出るとき、再生の設定を元に戻す
  function leaveMark_() {
    RE.Engine.stop();
    RE.Engine.setGap(ST().gapSec);
    RE.Engine.setRate(ST().rate);
  }

  // i より前／後の、記録した（数の）位置
  function prevMark_(i) { var t = ST().markTimes; for (var k = i - 1; k >= 0; k--) if (typeof t[k] === 'number') return t[k]; return null; }
  function nextMark_(i) { var t = ST().markTimes; for (var k = i + 1; k < t.length; k++) if (typeof t[k] === 'number') return t[k]; return null; }

  // 記録画面の再生範囲を q 秒〜最後にする
  function markSeekTo_(q) {
    var a = ST().article, playing = RE.Engine.getState() === S.PLAYING;
    RE.Engine.setSection(q, a.durationSec, 'A', playing);
    if (playing) RE.Engine.playFromStart(); else RE.Engine.stop();
    RE.UI.updatePosition(q);
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
      sections: view.blocks.map(function (b) { return { id: b.id, startSec: null, done: null }; }),
      marked: false, lastBlockId: '', driveFolderId: draft.driveFolderId || ''
    };
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
        if (!st.driveList.length) RE.UI.showMessage('drive', M.DRIVE_EMPTY); else RE.UI.clearMessage('drive');
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
    if (c === 'NETWORK') return M.DRIVE_ERR_NETWORK;
    if (c === 'NO_SETTINGS') return M.DRIVE_NEED_SETTINGS;
    if (c === 'MISSING_FILES') return fill(M.DRIVE_MISSING, { list: '本文・CSV・音声のどれか' });
    if (c === 'DUPLICATE_FILES') return fill(M.DRIVE_DUPLICATE, { list: '本文・CSV・音声のどれか' });
    return fill(M.DRIVE_ERR_OTHER, { code: c || '?' });
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
    onOpenSettings: function () {
      var st = ST();
      if (st.screen !== 'screen-settings') st.prevScreen = st.screen;
      RE.UI.showScreen('screen-settings');
      RE.UI.clearMessage('settings');
      RE.UI.renderSettings();
    },
    onAddDrive: function () {
      ST().drivePending = null;
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
    onDriveBack: function () { if (!ST().driveBusy) openLibrary(); },
    onDriveReload: function () { if (!ST().driveBusy) { ST().drivePending = null; loadDriveList_(); } },
    onDriveImport: function (folderId) {
      var st = ST();
      if (st.driveBusy) return;
      var it = st.driveList.filter(function (x) { return x.folderId === folderId; })[0];
      if (!it) return;
      var problem = driveProblemText(it);
      if (problem) { RE.UI.showMessage('drive', problem, true); return; }
      st.drivePending = null;
      st.driveBusy = true; renderDrive_();
      RE.UI.showMessage('drive', M.DRIVE_LOADING_TEXT);
      RE.Drive.fetchTexts(folderId).then(function (res) {
        if (!res.ok) { st.driveBusy = false; renderDrive_(); RE.UI.showMessage('drive', driveErrorText_(res), true); return; }
        var draft = { text: res.article || '', csvText: res.csv || '', file: null, durationSec: 0, title: it.name, driveFolderId: folderId };
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
    onMarkBack: function () { leaveMark_(); openLibrary(); },
    onMarkPlay: function () {
      if (RE.Engine.getState() === S.PLAYING) RE.Engine.pause(); else RE.Engine.play();
    },
    onMarkSeek: function (delta) {
      var a = ST().article;
      var q = Math.floor(RE.Engine.getPositionSec()) + delta;
      q = Math.min(Math.max(q, 0), Math.max(0, Math.floor(a.durationSec) - 1));
      markSeekTo_(q);
    },
    onMarkHere: function () {
      var st = ST(), i = st.markIndex;
      if (i >= st.markTimes.length) return;
      var t = Math.max(0, Math.floor(RE.Engine.getPositionSec()) - K.MARK_LEAD_SEC);
      var prev = prevMark_(i);
      if (prev !== null && t <= prev) t = prev + 1;
      st.markTimes[i] = t;
      st.markIndex++;
      RE.UI.clearMessage('mark');
      RE.UI.renderMark();
    },
    onMarkSkip: function () {
      var st = ST();
      if (st.markIndex >= st.markTimes.length) return;
      st.markTimes[st.markIndex] = null;
      st.markIndex++;
      RE.UI.renderMark();
    },
    onMarkUndo: function () {
      var st = ST();
      if (st.markIndex <= 0) return;
      st.markIndex--;
      st.markTimes[st.markIndex] = undefined;
      RE.UI.renderMark();
    },
    onMarkAdjust: function (i, delta) {
      var st = ST(), t = st.markTimes[i];
      if (typeof t !== 'number') return;
      var nt = t + delta, prev = prevMark_(i), next = nextMark_(i);
      if (nt < 0 || nt >= st.article.durationSec || (prev !== null && nt <= prev) || (next !== null && nt >= next)) {
        RE.UI.showMessage('mark', M.MARK_ORDER, true); return;
      }
      st.markTimes[i] = nt;
      RE.UI.clearMessage('mark');
      RE.UI.renderMark();
    },
    onMarkPreview: function (i) {
      var st = ST(), t = st.markTimes[i];
      if (typeof t !== 'number') return;
      var next = nextMark_(i), end = next !== null ? next : st.article.durationSec;
      RE.Engine.setSection(t, end, 'A', true);
      RE.Engine.playFromStart();
    },
    onMarkSave: function () {
      var st = ST(), a = st.article;
      var any = st.markTimes.some(function (t) { return typeof t === 'number'; });
      if (!any) { RE.UI.showMessage('mark', M.NEED_MARK, true); return; }
      a.sections.forEach(function (s, i) { var t = st.markTimes[i]; s.startSec = typeof t === 'number' ? t : null; });
      a.marked = true;
      saveArticle_().then(function () {
        leaveMark_();
        var first = a.sections.filter(function (s) { return s.startSec !== null; })[0];
        openStudy_(a.lastBlockId && sectionRange_(a.lastBlockId) ? a.lastBlockId : first.id);
      });
    },

    // --- 学習 ---
    onStudyBack: function () { RE.Engine.stop(); openLibrary(); },
    onToggleTools: function () { ST().toolsOpen = !ST().toolsOpen; RE.UI.renderStudyTop(); },
    onSectionGo: function (blockId) { RE.UI.clearMessage('study'); goSection_(blockId); },
    onSectionPrev: function () {
      var nav = navList(), i = navIndex();
      if (i > 0) handlers.onSectionGo(nav[i - 1].id);
    },
    onSectionNext: function () {
      var nav = navList(), i = navIndex();
      if (i < nav.length - 1) handlers.onSectionGo(nav[i + 1].id);
    },
    onRepeatMode: function (mode) {
      var st = ST();
      st.repeatMode = mode;
      try { localStorage.setItem(K.STORAGE_KEY_REPEAT, mode); } catch (e) { /* 無視 */ }
      var sec = sectionRange_(st.blockId);
      st.chunkStart = sec ? sec.start : 0;
      if (sec) applyRange_(true);
      RE.UI.renderStudyTop();
    },
    onPlayPause: function () {
      if (!currentRange()) { RE.UI.showMessage('study', M.NO_AUDIO_SECTION); return; }
      if (RE.Engine.getState() === S.PLAYING) RE.Engine.pause();
      else { RE.UI.clearMessage('study'); RE.Engine.play(); }
    },
    onStop: function () { RE.Engine.stop(); },
    onNextChunk: function () {
      var st = ST(), sec = sectionRange_(st.blockId);
      if (!sec || st.repeatMode !== K.REPEAT.CHUNK) return;
      var n = st.chunkStart + RE.Utils.calcStepSec(st.moveSec);
      st.chunkStart = n >= sec.end ? sec.start : n;
      RE.UI.clearMessage('study');
      applyRange_(true);
      RE.UI.renderStudyTop();
    },
    onPrevChunk: function () {
      var st = ST(), sec = sectionRange_(st.blockId);
      if (!sec || st.repeatMode !== K.REPEAT.CHUNK) return;
      if (st.chunkStart <= sec.start) { RE.UI.showMessage('study', M.FIRST_CHUNK); return; }
      st.chunkStart = Math.max(st.chunkStart - RE.Utils.calcStepSec(st.moveSec), sec.start);
      RE.UI.clearMessage('study');
      applyRange_(true);
      RE.UI.renderStudyTop();
    },
    onComplete: function () {
      var st = ST(), a = st.article, s = sectionEntry(st.blockId);
      if (!s || s.startSec === null) return;
      if (s.done) {
        s.done = null;
        saveArticle_();
        RE.UI.renderStudyTop();
        return;
      }
      s.done = RE.Progress.todayKey();
      saveArticle_();
      var idx = a.sections.indexOf(s), next = null;
      for (var i = idx + 1; i < a.sections.length; i++) if (a.sections[i].startSec !== null) { next = a.sections[i]; break; }
      if (next) { RE.Engine.stop(); goSection_(next.id); }
      else RE.UI.renderStudyTop();
      if (RE.Progress.calc(a.sections, st.deadlineWeekday).allDone) RE.UI.showMessage('study', M.ALL_DONE);
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
    onSettingsBack: function () {
      var prev = ST().prevScreen;
      if (prev === 'screen-study' && ST().article) { RE.UI.showScreen('screen-study'); RE.UI.renderStudyTop(); }
      else if (prev === 'screen-drive') { RE.UI.showScreen('screen-drive'); loadDriveList_(); }
      else openLibrary();
    },
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
    if (st.repeatMode === K.REPEAT.CHUNK && sectionRange_(st.blockId)) applyRange_(false);
    RE.UI.renderStudyTop();
  }

  RE.Main = {
    start: start, handlers: handlers, buildView_: buildView_,
    navList: navList, navIndex: navIndex, sectionEntry: sectionEntry, currentRange: currentRange,
    studyProgressText: studyProgressText, libraryProgressText: libraryProgressText, driveProblemText: driveProblemText
  };

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start);
  else start();
})();
