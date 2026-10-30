/* js/main.js — 起動と各操作のまとめ役（RE.Main）。画面の描画は RE.UI、再生は RE.Engine、保存は RE.Db に任せる */
/* 基づく仕様書：KEecolexico 仕様書 v1.3 */
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

  // いま繰り返す範囲 {s, e}（仕様 6.5.1）。枠の中に収める。枠が無ければ null
  function currentRange() {
    var st = ST(), b = bounds_();
    if (!b) return null;
    var split = isSplit_();
    var s = Math.min(Math.max(split ? st.splitStart : st.rangeStart, b.start), b.end - 1);
    var e = Math.min(Math.max(split ? st.splitEnd : st.rangeEnd, s + 1), b.end);
    return { s: s, e: e };
  }

  // 今の区間 {start, end}
  function partRange_() { return sectionRange_(ST().blockId, ST().partIndex); }

  // 作業場の「本文分割」でエンジンを使っているか
  function isSplit_() { return ST().engineMode === 'split'; }

  // 音声の終わり（整数秒）
  function durEnd_() { var a = ST().article; return a ? Math.floor(a.durationSec || 0) : 0; }

  // 範囲の枠（仕様 6.5.1）。本文分割は音声全体、それ以外は今の区間
  function bounds_() {
    if (isSplit_()) { var d = durEnd_(); return d > 0 ? { start: 0, end: d } : null; }
    return partRange_();
  }

  // 範囲を変えてエンジンに渡す。restart が true なら、再生中は頭から再生し直す。play が true なら停止中でも頭から再生する
  function setRange_(s, e, restart, play) {
    var st = ST();
    if (isSplit_()) { st.splitStart = s; st.splitEnd = e; } else { st.rangeStart = s; st.rangeEnd = e; }
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
  function hasLocalData_(a) {
    return !!a.marked || a.sections.some(function (s) { return !!s.done; }) || Object.keys(a.memos || {}).length > 0;
  }
  // v0.6 以前の記事に項目を足す。足したら true
  function migrateSync_(a) {
    if (!a.memos || typeof a.memos !== 'object') a.memos = {};   // 区間メモ（仕様 6.8.2）
    if (typeof a.syncSavedAt === 'number') return false;
    a.syncSavedAt = 0; a.syncDirty = hasLocalData_(a);
    return true;
  }
  // 通信を順番に1つずつ行う
  function queueSync_(fn) { syncChain_ = syncChain_.then(fn).catch(function (e) { console.error(e); return 'pending'; }); return syncChain_; }
  // ===== 文ごとの区間メモ（仕様 6.8） =====
  var memoSeq_ = 0;

  // 区間メモの id（時刻＋連番＋乱数）
  function makeMemoId_() {
    memoSeq_ += 1;
    return 'm' + Date.now().toString(36) + memoSeq_.toString(36) + Math.random().toString(36).slice(2, 4);
  }
  // 節の文の一覧 [{sid, text}]
  function sectionSentences_(blockId) {
    var v = ST().view, b = v ? v.blocks.filter(function (x) { return x.id === blockId; })[0] : null;
    if (!b) return [];
    return b.units.filter(function (u) { return u.kind !== 'skipped'; }).map(function (u) { return { sid: u.sid, text: u.text }; });
  }
  // その節の区間メモ（無ければ空の配列）
  function memosOf_(blockId) { var a = ST().article; return (a && a.memos && a.memos[blockId]) || []; }
  // 区間メモを文の並びに並べ直す
  function sortMemos_(blockId, list) {
    var order = {}; sectionSentences_(blockId).forEach(function (x, i) { order[x.sid] = i; });
    return list.slice().sort(function (p, q) { return (order[p.sid] - order[q.sid]) || (p.s - q.s); });
  }
  // 「この文」の初期値：最後に保存した文の次から、区間メモが無い最初の文
  function defaultMemoSid_() {
    var st = ST(), list = sectionSentences_(st.blockId), memos = memosOf_(st.blockId);
    if (!list.length) return '';
    var has = {}; memos.forEach(function (m) { has[m.sid] = m; });
    var last = memos.slice().sort(function (p, q) { return q.savedAt - p.savedAt; })[0];
    var from = 0;
    if (last) list.forEach(function (x, i) { if (x.sid === last.sid) from = i + 1; });
    for (var k = 0; k < list.length; k++) {
      var x = list[(from + k) % list.length];
      if (!has[x.sid]) return x.sid;
    }
    var cur = memos.filter(function (m) { return isCurrentMemo_(m); })[0];
    return cur ? cur.sid : list[0].sid;
  }
  // 今の範囲と同じ区間メモか
  function isCurrentMemo_(m) {
    var st = ST();
    return m.part === st.partIndex && m.s === st.rangeStart && m.e === st.rangeEnd;
  }
  // 区間メモを変えたあと、画面を描き直す（単語一覧はスクロールの位置を保つ）
  function memoChanged_() {
    RE.UI.renderStudyTop();
    RE.UI.renderWordList(true);
    if (ST().screen === 'screen-mark') RE.UI.renderMarks();
  }

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
          var res = changed ? 'applied' : 'same';
          // 古い版のファイルで、端末の区間メモを残したとき（仕様 6.8.6）は、続けて送る
          return a.syncDirty ? pushSync_(a, false).then(function () { return res; }) : res;
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
    if (scr === 'screen-study') {
      if (st.workTab === 'section') { st.blockId = ''; st.partIndex = -1; }
      openWork_();
    } else if (scr === 'screen-words') {
      if (a.marked) openStudyLast_(); else openWork_();
    } else if (scr === 'screen-mark') {
      st.blockId = ''; st.partIndex = -1;
      ensureStudyBlock_();
      RE.UI.renderMarks();
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

  // ===== 起動時・前面に戻ったときの一括同期（仕様 6.7.10。v1.2） =====
  var syncAllBusy_ = false, lastSyncAll_ = 0;

  // 記事一覧のメッセージ（一覧を開いているときだけ見える）
  function libMsg_(text, isError) { RE.UI.showMessage('library', text, isError); }
  // 「22:15」
  function hhmm_() { var d = new Date(), p = function (n) { return (n < 10 ? '0' : '') + n; }; return p(d.getHours()) + ':' + p(d.getMinutes()); }

  // ドライブと結び付いたすべての記事を、1つずつドライブとそろえる（送れていない変更は送り、相手の新しい変更は読み込む）
  function syncAll_(force) {
    var st = ST();
    if (syncAllBusy_ || !RE.Drive.isReady()) return Promise.resolve();
    if (!force && Date.now() - lastSyncAll_ < K.SYNC_ALL_MIN_MS) return Promise.resolve();
    syncAllBusy_ = true; lastSyncAll_ = Date.now();
    var bad = 0, local = [];
    return RE.Db.listArticles().then(function (list) {
      local = list;
      var targets = list.filter(canSync_), done = 0, chain = Promise.resolve();
      if (targets.length) libMsg_(fill(M.SYNCALL_RUNNING, { n: 0, m: targets.length }));
      targets.forEach(function (a0) {
        chain = chain.then(function () {
          var a = st.article && st.article.articleId === a0.articleId ? st.article : a0;   // 開いている記事は、画面の記事そのものをそろえる
          if (migrateSync_(a) && a !== st.article) RE.Db.saveArticle(a);
          return queueSync_(function () { return pullSync_(a); }).then(function (status) {
            done++;
            if (status === 'applied' && a === st.article) {
              var dev = st.syncAppliedFrom || K.SYNC_DEVICE_OTHER; st.syncAppliedFrom = null;
              reopenAfterSync_(fill(M.SYNC_APPLIED, { device: dev }));
            } else if (status === 'applied') st.syncAppliedFrom = null;
            if (status !== 'same' && status !== 'applied' && status !== 'conflict') bad++;
            libMsg_(fill(M.SYNCALL_RUNNING, { n: done, m: targets.length }));
          });
        });
      });
      return chain.then(function () {
        if (targets.length) libMsg_(bad ? fill(M.SYNCALL_SOME, { k: bad }) : fill(M.SYNCALL_DONE, { time: hhmm_() }), bad > 0);
        return RE.Drive.listArticles();
      });
    }).then(function (res) {
      // ドライブにあって、この端末に無い記事
      if (!res || !res.ok) return;
      var have = local.map(function (a) { return a.driveFolderId; }).filter(Boolean);
      var n = (res.articles || []).filter(function (it) { return have.indexOf(it.folderId) < 0 && !driveProblemText(it); }).length;
      if (n) libMsg_((bad ? fill(M.SYNCALL_SOME, { k: bad }) : fill(M.SYNCALL_DONE, { time: hhmm_() })) + ' ' + fill(M.SYNCALL_NEW, { n: n }), bad > 0);
    }).catch(function (e) { console.error(e); }).then(function () {
      syncAllBusy_ = false;
      if (st.screen === 'screen-library') return RE.Db.listArticles().then(function (list) { st.articles = list; RE.UI.renderLibrary(list); });
    });
  }

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
    var scr = 'study';
    if (code === C.ERR.PLAY_BLOCKED) RE.UI.showMessage(scr, C.MSG.PLAY_BLOCKED, true);
    else if (code === C.ERR.INTERRUPTED) RE.UI.showMessage(scr, C.MSG.INTERRUPTED);
    else if (code === C.ERR.TOO_LONG) RE.UI.showMessage(scr, C.MSG.DOUBLE_TOO_LONG, true);
  }

  // 位置の表示を更新
  function refreshPosition_() {
    if (document.hidden) return;
    var scr = ST().screen;
    if (scr !== 'screen-study' && scr !== 'screen-words') return;
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
    handlers.onPlayPause();
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
        var scr = ST().screen;
        if (!remoteAllowed_() || (scr !== 'screen-study' && scr !== 'screen-words' && scr !== 'screen-mark')) return;
        handlers.onNextBreak();   // 「次へ」＝次の区切りへ（仕様 6.5.2）
      }
    });
    RE.UI.applyFontSize();
    RE.Db.requestPersist();
    registerServiceWorker_();
    openLibrary().then(function () { syncAll_(true); });
    setInterval(refreshPosition_, C.UI_REFRESH_MS);
    document.addEventListener('visibilitychange', function () {
      if (!document.hidden) { refreshPosition_(); RE.UI.renderPlayButtons(); checkUpdate_(); syncAll_(false); }
    });
  }

  // 記事を開く。mode: 'auto'（記録済みなら学習、未記録なら作業場の本文分割）／'mark'（区切りタブ）
  function openArticle_(id, mode) {
    var st = ST();
    RE.UI.clearMessage('library');
    return RE.Db.getArticle(id).then(function (a) {
      if (!a) { RE.UI.showMessage('library', M.LOAD_ERROR, true); return; }
      var view = buildView_(a.articleText, a.csvText);
      syncSections_(a, view);
      migrateSync_(a);
      if (st.engineMode === 'split') { RE.Engine.stop(); st.engineMode = 'study'; }
      st.article = a; st.view = view;
      st.blockId = ''; st.partIndex = -1; st.splitBlockId = ''; st.openMarkBlockId = ''; st.markDeleteKey = '';
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
        if (mode === 'mark') {
          ensureStudyBlock_();
          RE.UI.showScreen('screen-mark');
          RE.UI.clearMessage('mark');
          RE.UI.renderMarks();
        } else if (!a.marked) {
          openWork_();
          if (id !== newArticleId_) RE.UI.showMessage('study', M.NEED_MARK);
        } else {
          openStudyLast_();
        }
        newArticleId_ = '';
        if (st.syncAppliedFrom) { showSyncMsg_(fill(M.SYNC_APPLIED, { device: st.syncAppliedFrom })); st.syncAppliedFrom = null; }
      });
    });
  }

  // ===== 学習・作業場 =====

  // 最後に開いた区間（無ければ最初の再生できる区間）
  function pickLast_() {
    var a = ST().article, nav = navList(), pick = null;
    nav.forEach(function (n) { if (!pick && n.blockId === a.lastBlockId && n.part === (a.lastPart || 0)) pick = n; });
    if (!pick) nav.forEach(function (n) { if (!pick && n.blockId === a.lastBlockId) pick = n; });
    if (!pick) nav.forEach(function (n) { if (!pick && n.part >= 0) pick = n; });
    return pick || nav[0];
  }

  // 最後に開いた区間で学習タブを開く
  function openStudyLast_() {
    ST().blockId = ''; ST().partIndex = -1;
    var pick = pickLast_();
    openStudy_(pick.blockId, pick.part);
  }

  // 学習タブを開く（仕様 8.10）。本文分割のエンジンの設定が残っていれば元に戻す
  function openStudy_(blockId, part) {
    ST().sheetOpen = false;
    leaveSplit_();
    RE.UI.showScreen('screen-words');
    RE.UI.clearMessage('study');
    goSection_(blockId, part);
  }

  // 今の区間が並びに無ければ（まだ開いていない・区切りを直した）、最後に開いた区間を開く（画面は変えない）
  function ensureStudyBlock_() {
    var st = ST(), a = st.article;
    if (!a || !a.marked) return;
    var ok = navList().some(function (n) { return n.blockId === st.blockId && n.part === st.partIndex; });
    if (ok) return;
    st.blockId = ''; st.partIndex = -1;
    var pick = pickLast_();
    if (pick) goSection_(pick.blockId, pick.part);
  }

  // 区間を切り替える。範囲は区間全体（仕様 6.5.2）。再生中なら新しい区間の頭から再生を続ける
  function goSection_(blockId, part) {
    var st = ST(), a = st.article;
    var sameBlock = st.blockId === blockId;
    st.blockId = blockId;
    st.partIndex = typeof part === 'number' ? part : -1;
    var sec = sectionRange_(blockId, st.partIndex);
    st.rangeStart = sec ? sec.start : 0;
    st.rangeEnd = sec ? sec.end : 0;
    if (blockId !== K.SECTION_NONE && (a.lastBlockId !== blockId || a.lastPart !== st.partIndex)) {
      a.lastBlockId = blockId; a.lastPart = st.partIndex; saveArticle_();
    }
    if (isSplit_()) { /* 本文分割の範囲はそのまま */ }
    else if (sec) applyRange_(true);
    else {
      RE.Engine.stop();
      RE.UI.showMessage('study', blockId === K.SECTION_NONE ? '' : M.NO_AUDIO_SECTION);
    }
    st.memoSid = defaultMemoSid_();
    RE.UI.renderStudyTop();
    if (!sameBlock) RE.UI.renderWordList();
    else { st.scrollPos['screen-words'] = 0; if (st.screen === 'screen-words') window.scrollTo(0, 0); }
  }

  // 作業場の小さなタブを覚える（仕様 8.5.1）
  function setWorkTab_(name) {
    ST().workTab = name;
    try { localStorage.setItem(K.STORAGE_KEY_WORKTAB, name); } catch (e) { /* 無視 */ }
  }

  // 作業場タブを開く。まだ節が1つも無い記事は本文分割（覚えた値は変えない）
  function openWork_() {
    var st = ST(), a = st.article;
    var tab = a.marked ? st.workTab : 'article';
    ST().sheetOpen = false;
    RE.UI.showScreen('screen-study');
    if (tab === 'article') { st.workTab = 'article'; enterSplit_(); }
    else { leaveSplit_(); ensureStudyBlock_(); }
    RE.UI.renderStudyTop();
  }

  // 節の並びでの番号（無ければ -1）
  function blockIndex_(blockId) {
    var v = ST().view; if (!v) return -1;
    for (var i = 0; i < v.blocks.length; i++) if (v.blocks[i].id === blockId) return i;
    return -1;
  }

  // 本文分割で、最初に選ぶ節：区間が無い最初の節。全部あれば今の節（仕様 8.5.2）
  function defaultSplitBlock_() {
    var st = ST(), a = st.article, v = st.view;
    for (var i = 0; i < a.sections.length; i++) if (!a.sections[i].parts.length) return a.sections[i].id;
    if (blockIndex_(st.blockId) >= 0) return st.blockId;
    return v.blocks.length ? v.blocks[0].id : '';
  }

  // 本文分割の範囲の初期値：選んだ節より前で区間のある最後の節の終わり 〜 音声の終わり（仕様 8.5.2）
  function splitDefaults_() {
    var st = ST(), a = st.article, idx = blockIndex_(st.splitBlockId), s = 0;
    for (var i = idx - 1; i >= 0; i--) {
      var ps = a.sections[i].parts;
      if (ps.length) { s = ps[ps.length - 1].e; break; }
    }
    st.splitStart = s;
    st.splitEnd = durEnd_();
  }

  // 本文分割に入る（範囲の枠＝音声全体。仕様 8.5.2）
  function enterSplit_() {
    var st = ST();
    RE.Engine.stop();
    st.engineMode = 'split';
    st.splitBlockId = defaultSplitBlock_();
    splitDefaults_();
    applyRange_(false);
  }

  // 本文分割から出る（学習の範囲＝今の区間をエンジンに戻す）
  function leaveSplit_() {
    var st = ST();
    if (st.engineMode !== 'split') return;
    RE.Engine.stop();
    st.engineMode = 'study';
    if (partRange_()) applyRange_(false);
  }

  // 区間 [s, e] を、節 idx の区間として置けるか（前後の節の区間と重ならない・音声の中。仕様 8.5.2）
  // fromS が数なら、その節の区間もそこより後ろであること（区間を足すとき）
  function fitsOrder_(idx, s, e, fromS) {
    var a = ST().article, prevEnd = 0, nextStart = durEnd_(), i;
    for (i = idx - 1; i >= 0; i--) { var p = a.sections[i].parts; if (p.length) { prevEnd = p[p.length - 1].e; break; } }
    for (i = idx + 1; i < a.sections.length; i++) { var q = a.sections[i].parts; if (q.length) { nextStart = q[0].s; break; } }
    if (typeof fromS === 'number') prevEnd = Math.max(prevEnd, fromS);
    return s >= prevEnd && e <= nextStart && s < e && e <= durEnd_();
  }

  // 次の区切り・前の区切りの並び（仕様 6.9.1）
  function breakList_() {
    var v = ST().view, out = [];
    if (!v) return out;
    v.blocks.forEach(function (b, bi) {
      var sec = sectionEntry(b.id);
      if (!sec || !sec.parts.length) return;
      var memos = memosOf_(b.id).filter(function (m) {
        var r = sectionRange_(b.id, m.part);
        return r && m.s >= r.start && m.e <= r.end;
      });
      if (memos.length) {
        memos.forEach(function (m) {
          out.push({ blockId: b.id, bi: bi, part: m.part, s: m.s, e: m.e, memoId: m.id, sid: m.sid, label: partLabel_(bi, m.part) + ' ' + m.sid });
        });
      } else {
        sec.parts.forEach(function (pt, p) {
          out.push({ blockId: b.id, bi: bi, part: p, s: pt.s, e: pt.e, memoId: '', sid: '', label: partLabel_(bi, p) });
        });
      }
    });
    out.sort(function (x, y) { return (x.bi - y.bi) || (x.part - y.part) || (x.s - y.s); });
    return out;
  }

  // 今の位置と区切りを比べる（負＝区切りが前、正＝区切りが後ろ）
  function compareBreak_(b) {
    var st = ST(), v = st.view;
    var bi = st.blockId === K.SECTION_NONE ? v.blocks.length : blockIndex_(st.blockId);
    return (b.bi - bi) || (b.part - st.partIndex) || (b.s - st.rangeStart);
  }

  // 区切りへ移って、状態に関係なく頭から再生する（仕様 6.9.2）
  function goBreak_(b) {
    var st = ST();
    if (st.blockId !== b.blockId || st.partIndex !== b.part) goSection_(b.blockId, b.part);
    RE.UI.clearMessage('study');
    setRange_(b.s, b.e, false, false);
    RE.Engine.playFromStart();
    if (b.memoId) st.memoSid = b.sid;
    memoChanged_();
  }

  // 本文分割で区切りの移動・節の選択をしたときは、節分割に切り替える
  function toSectionWork_() {
    var st = ST();
    if (!isSplit_()) return;
    leaveSplit_();
    setWorkTab_('section');
  }

  // 区切りタブ：微調整・削除のあと、学習の範囲を合わせる
  function afterMarkEdit_(blockId) {
    var st = ST();
    markChanged_();
    if (st.blockId === blockId) {
      st.blockId = '__';   // 同じ節でも区間を開き直す
      ensureStudyBlock_();
      if (st.blockId === '__') { st.blockId = ''; st.partIndex = -1; RE.Engine.stop(); }
    }
    RE.UI.renderMarks();
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
      marked: false, lastBlockId: '', lastPart: 0, driveFolderId: draft.driveFolderId || '', memos: {},
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
      if (name === 'play') { if (from !== 'screen-study') openWork_(); return; }
      leaveSplit_();
      if (name === 'library') { openLibrary(); return; }
      if (name === 'settings') { handlers.onOpenSettings(); return; }
      if (name === 'mark') {
        if (from === 'screen-mark') return;
        ensureStudyBlock_();
        RE.UI.showScreen('screen-mark');
        RE.UI.clearMessage('mark');
        RE.UI.renderMarks();
        return;
      }
      // 学習
      if (!a.marked) { openWork_(); RE.UI.showMessage('study', M.NEED_MARK); return; }
      ensureStudyBlock_();
      RE.UI.showScreen('screen-words');
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

    // --- 区切りタブ（仕様 8.4） ---
    onMarkToggle: function (blockId) {
      var st = ST();
      st.openMarkBlockId = st.openMarkBlockId === blockId ? '' : blockId;
      st.markDeleteKey = '';
      RE.UI.clearMessage('mark');
      RE.UI.renderMarks(true);
    },
    // その区間を頭から再生（確認用。学習の範囲も区間全体になる）
    onMarkPartPlay: function (blockId, part) {
      var st = ST();
      if (!sectionRange_(blockId, part)) return;
      leaveSplit_();
      RE.UI.clearMessage('mark');
      if (st.blockId !== blockId || st.partIndex !== part) goSection_(blockId, part);
      else { var r = partRange_(); setRange_(r.start, r.end, false, false); }
      RE.Engine.playFromStart();
      RE.UI.renderMarks();
    },
    // 始−1／始＋1／終−1／終＋1（which は 's' か 'e'）
    onMarkAdjust: function (blockId, part, which, delta) {
      var st = ST(), a = st.article, idx = blockIndex_(blockId);
      var sec = idx >= 0 ? a.sections[idx] : null, pt = sec && sec.parts[part];
      if (!pt) return;
      var ns = pt.s, ne = pt.e;
      if (which === 'e') ne += delta; else ns += delta;
      // 前後の区間（同じ節の前後の区間、無ければ前後の節）
      var prevEnd = part > 0 ? sec.parts[part - 1].e : null, nextStart = part < sec.parts.length - 1 ? sec.parts[part + 1].s : null, i;
      if (prevEnd === null) { prevEnd = 0; for (i = idx - 1; i >= 0; i--) { var p = a.sections[i].parts; if (p.length) { prevEnd = p[p.length - 1].e; break; } } }
      if (nextStart === null) { nextStart = durEnd_(); for (i = idx + 1; i < a.sections.length; i++) { var q = a.sections[i].parts; if (q.length) { nextStart = q[0].s; break; } } }
      if (ns < 0 || ns < prevEnd || ns >= ne || ne > durEnd_() || ne > nextStart) { RE.UI.showMessage('mark', M.MARK_ORDER, true); return; }
      pt.s = ns; pt.e = ne;
      RE.UI.clearMessage('mark');
      afterMarkEdit_(blockId);
    },
    // × ：その区間を消す（2回押し）
    onMarkPartDelete: function (blockId, part) {
      var st = ST(), a = st.article, idx = blockIndex_(blockId), key = blockId + '|' + part;
      var sec = idx >= 0 ? a.sections[idx] : null;
      if (!sec || !sec.parts[part]) return;
      if (st.markDeleteKey !== key) {
        st.markDeleteKey = key;
        RE.UI.renderMarks();
        RE.UI.showMessage('mark', M.DELETE_CONFIRM);
        clearTimeout(deleteTimer_);
        deleteTimer_ = setTimeout(function () { st.markDeleteKey = ''; RE.UI.renderMarks(); RE.UI.clearMessage('mark'); }, 3000);
        return;
      }
      clearTimeout(deleteTimer_);
      st.markDeleteKey = '';
      sec.parts.splice(part, 1);
      // 後ろの区間の区間メモは、区間の番号を1つ詰める
      memosOf_(blockId).forEach(function (m) { if (m.part > part) m.part -= 1; });
      a.marked = a.sections.some(function (s) { return s.parts.length > 0; });
      RE.UI.showMessage('mark', M.DELETED);
      afterMarkEdit_(blockId);
    },
    // 最初から記録し直す（2回押し）。区間メモと完了の記録は残す
    onMarkReset: function () {
      var st = ST(), a = st.article;
      if (!st.markResetPending) {
        st.markResetPending = true;
        RE.UI.renderMarks();
        RE.UI.showMessage('mark', M.MARK_RESET_CONFIRM);
        clearTimeout(deleteTimer_);
        deleteTimer_ = setTimeout(function () { st.markResetPending = false; RE.UI.renderMarks(); RE.UI.clearMessage('mark'); }, 3000);
        return;
      }
      clearTimeout(deleteTimer_);
      st.markResetPending = false;
      a.sections.forEach(function (s) { s.parts = []; });
      a.marked = false;
      RE.Engine.stop();
      st.blockId = ''; st.partIndex = -1;
      markChanged_();
      RE.UI.clearMessage('mark');
      RE.UI.renderMarks();
    },

    // --- 作業場（仕様 8.5） ---
    onWorkTab: function (name) {
      var st = ST(), a = st.article;
      if (!a || (name === st.workTab && (name === 'section' || isSplit_()))) return;
      setWorkTab_(name);
      RE.UI.clearMessage('study');
      if (name === 'article') enterSplit_();
      else {
        leaveSplit_();
        if (!a.marked) RE.UI.showMessage('study', M.NEED_MARK);
        ensureStudyBlock_();
      }
      RE.UI.renderStudyTop();
    },
    // 本文分割で節を選ぶ（範囲は初期値に）
    onSplitBlock: function (blockId) {
      var st = ST();
      if (!isSplit_() || blockIndex_(blockId) < 0 || st.splitBlockId === blockId) return;
      st.splitBlockId = blockId;
      splitDefaults_();
      RE.UI.clearMessage('study');
      applyRange_(true);
      RE.UI.renderStudyTop();
    },
    // 節保存：選んだ節の区間を今の範囲の1つにする（仕様 8.5.2）
    onSectionSave: function () {
      var st = ST(), a = st.article, r = currentRange(), idx = blockIndex_(st.splitBlockId);
      if (!isSplit_() || !r || idx < 0) return;
      if (!fitsOrder_(idx, r.s, r.e)) { RE.UI.showMessage('study', M.MARK_ORDER, true); return; }
      var name = st.view.blocks[idx].label;
      a.sections[idx].parts = [{ s: r.s, e: r.e }];
      a.marked = true;
      markChanged_();
      // 次の節：選んだ節の後ろで区間が無い最初の節。無ければ次の節
      var next = -1, i;
      for (i = idx + 1; i < a.sections.length; i++) if (!a.sections[i].parts.length) { next = i; break; }
      if (next < 0 && idx + 1 < a.sections.length) next = idx + 1;
      if (next >= 0) st.splitBlockId = a.sections[next].id;
      st.splitStart = r.e; st.splitEnd = durEnd_();
      applyRange_(true);
      RE.UI.showMessage('study', fill(M.SECTION_SAVED, { name: name }));
      RE.UI.renderStudyTop();
    },
    // 区間を足す：選んだ節に、今の範囲を次の区間（B・C…）として足す（仕様 8.5.2）
    onSectionAddPart: function () {
      var st = ST(), a = st.article, r = currentRange(), idx = blockIndex_(st.splitBlockId);
      if (!isSplit_() || !r || idx < 0) return;
      var parts = a.sections[idx].parts;
      if (parts.length >= K.PART_LETTERS.length) { RE.UI.showMessage('study', M.MARK_PART_MAX, true); return; }
      var lastE = parts.length ? parts[parts.length - 1].e : undefined;
      if (!fitsOrder_(idx, r.s, r.e, lastE)) { RE.UI.showMessage('study', M.MARK_ORDER, true); return; }
      parts.push({ s: r.s, e: r.e });
      a.marked = true;
      markChanged_();
      var name = st.view.blocks[idx].label + (parts.length > 1 ? K.PART_LETTERS.charAt(parts.length - 1) : '');
      st.splitStart = r.e; st.splitEnd = durEnd_();
      applyRange_(true);
      RE.UI.showMessage('study', fill(M.PART_ADDED, { name: name }));
      RE.UI.renderStudyTop();
    },
    // 自動区切り（記事一覧の各記事のボタン。仕様 6.10）：すべての節の区間と区間メモを、自動の結果で置き換える
    onAutoSplit: function (id) {
      var st = ST();
      if (st.autoArticleId || st.driveBusy) return;
      if (RE.AutoSplit.isMobile()) { RE.UI.showMessage('library', M.AUTO_MAC_ONLY, true); return; }
      var relist = function () { RE.UI.renderLibrary(st.articles || []); };
      RE.Db.getArticle(id).then(function (a0) {
        if (!a0) return;
        var a = st.article && st.article.articleId === id ? st.article : a0;   // 開いている記事なら、画面の記事そのもの
        var has = a.marked || Object.keys(a.memos || {}).length > 0;
        if (has && st.autoConfirmId !== id) {   // 区切りがある記事は2回押し
          st.autoConfirmId = id; relist();
          RE.UI.showMessage('library', fill(M.AUTO_CONFIRM, { title: a.title }));
          clearTimeout(deleteTimer_);
          deleteTimer_ = setTimeout(function () { st.autoConfirmId = ''; relist(); RE.UI.clearMessage('library'); }, 3000);
          return;
        }
        clearTimeout(deleteTimer_);
        st.autoConfirmId = ''; st.autoArticleId = id; relist();
        if (st.article === a) RE.Engine.stop();
        var status = function (t) { RE.UI.showMessage('library', a.title + '：' + t); };
        return RE.Db.getAudio(id).then(function (rec) {
          if (!rec || !rec.blob) throw new Error('NO_AUDIO');
          return RE.AutoSplit.run(a, rec.blob, status);
        }).then(function (res) {
          a.sections.forEach(function (s) { s.parts = res.parts[s.id] || []; });
          a.memos = res.memos;
          a.marked = a.sections.some(function (s) { return s.parts.length > 0; });
          migrateSync_(a);
          a.syncDirty = true;
          return RE.Db.saveArticle(a).then(function (ok) {
            if (!ok) throw new Error('SAVE');
            if (canSync_(a)) queueSync_(function () { return pushSync_(a, false); });   // ドライブへ送る（iPhone に届く）
            if (st.article === a) { st.blockId = ''; st.partIndex = -1; st.openMarkBlockId = ''; if (st.screen !== 'screen-library') reopenAfterSync_(''); }
            st.autoArticleId = '';
            return RE.Db.listArticles().then(function (list) { st.articles = list; relist(); });
          }).then(function () { RE.UI.showMessage('library', a.title + '：' + fill(M.AUTO_DONE, res.stats)); });
        });
      }).catch(function (e) {
        console.error(e);
        RE.UI.showMessage('library', fill(M.AUTO_FAILED, { reason: (e && e.message) || String(e) }), true);   // 区切りは変わらない
      }).then(function () { if (st.autoArticleId === id) { st.autoArticleId = ''; relist(); } });
    },
    // 次の区切りへ・前の区切りへ（仕様 6.9）
    onNextBreak: function () {
      var a = ST().article;
      if (!a || !a.marked) return;
      toSectionWork_();
      var list = breakList_(), b = null;
      for (var i = 0; i < list.length; i++) if (compareBreak_(list[i]) > 0) { b = list[i]; break; }
      if (!b) { RE.UI.showMessage('study', M.BREAK_LAST); RE.UI.renderStudyTop(); return; }
      goBreak_(b);
    },
    onPrevBreak: function () {
      var a = ST().article;
      if (!a || !a.marked) return;
      toSectionWork_();
      var list = breakList_(), b = null;
      for (var i = list.length - 1; i >= 0; i--) if (compareBreak_(list[i]) < 0) { b = list[i]; break; }
      if (!b) { RE.UI.showMessage('study', M.BREAK_FIRST); RE.UI.renderStudyTop(); return; }
      goBreak_(b);
    },

    // --- 学習 ---
    onSectionGo: function (blockId, part) {
      toSectionWork_();   // 本文分割で節の一覧から選んだときは、節分割に切り替える
      RE.UI.clearMessage('study');
      goSection_(blockId, part);
    },
    onSectionPrev: function () {
      var nav = navList(), i = navIndex();
      if (i > 0) handlers.onSectionGo(nav[i - 1].blockId, nav[i - 1].part);
    },
    onSectionNext: function () {
      var nav = navList(), i = navIndex();
      if (i < nav.length - 1) handlers.onSectionGo(nav[i + 1].blockId, nav[i + 1].part);
    },
    // --- 区間メモ（仕様 6.8.5） ---
    onMemoSidChange: function (sid) { ST().memoSid = sid; RE.UI.renderStudyTop(); },
    onMemoSave: function () {
      var st = ST(), a = st.article, r = currentRange(), sec = partRange_();
      if (!a || !r || !sec || !st.memoSid) return;
      var sid = st.memoSid, list = memosOf_(st.blockId).slice();
      var old = list.filter(function (m) { return m.sid === sid; })[0], msg;
      if (old) {
        old.part = st.partIndex; old.s = r.s; old.e = r.e; old.savedAt = Date.now();
        msg = M.MEMO_REPLACED;
      } else {
        if (list.length >= K.MEMO_MAX_PER_SECTION) { RE.UI.showMessage('study', M.MEMO_FULL, true); return; }
        list.push({ id: makeMemoId_(), sid: sid, part: st.partIndex, s: r.s, e: r.e, savedAt: Date.now() });
        msg = M.MEMO_SAVED;
      }
      a.memos = a.memos || {};
      a.memos[st.blockId] = sortMemos_(st.blockId, list);
      markChanged_();
      // 次の範囲を、保存した文の終わりから始める（再生中なら続けて再生）
      if (r.e < sec.end) setRange_(r.e, Math.min(r.e + C.END_DEFAULT_SEC, sec.end), true, false);
      st.memoSid = defaultMemoSid_();
      RE.UI.showMessage('study', fill(msg, { sid: sid }));
      memoChanged_();
    },
    onMemoTap: function (blockId, id) {
      var st = ST(), m = memosOf_(blockId).filter(function (x) { return x.id === id; })[0];
      if (!m) return;
      var sec = sectionRange_(blockId, m.part);
      if (!sec || m.s < sec.start || m.e > sec.end) { RE.UI.showMessage(st.screen === 'screen-mark' ? 'mark' : 'study', M.MEMO_OUT_OF_RANGE, true); return; }
      if (st.blockId !== blockId || st.partIndex !== m.part) goSection_(blockId, m.part);
      RE.UI.clearMessage('study');
      setRange_(m.s, m.e, false, false);
      RE.Engine.playFromStart();   // 状態に関係なく、その文の頭から
      st.memoSid = m.sid;
      memoChanged_();
    },
    onMemoDelete: function (blockId, id) {
      var a = ST().article; if (!a || !a.memos || !a.memos[blockId]) return;
      a.memos[blockId] = a.memos[blockId].filter(function (m) { return m.id !== id; });
      if (!a.memos[blockId].length) delete a.memos[blockId];
      markChanged_();
      memoChanged_();
    },
    onStartStep: function (delta) {
      var b = bounds_(), r = currentRange(); if (!b || !r) return;
      var n = RE.Utils.clamp(r.s + delta, b.start, Math.max(Math.ceil(r.e) - 1, b.start));
      if (n === r.s) return;
      RE.UI.clearMessage('study');
      setRange_(n, r.e, true, false);
    },
    onEndStep: function (delta) {
      var b = bounds_(), r = currentRange(); if (!b || !r) return;
      var n = RE.Utils.clamp(Math.floor(r.e) + delta, r.s + 1, b.end);
      if (n === r.e) return;
      RE.UI.clearMessage('study');
      setRange_(r.s, n, false, false);
    },
    onMarkRange: function (which) {
      var b = bounds_(), r = currentRange(); if (!b || !r) return;
      var stt = RE.Engine.getState();
      if (stt !== S.PLAYING && stt !== S.PAUSED) { RE.UI.showMessage('study', C.MSG.MARK_NEED_PLAY); return; }
      var pos = RE.Engine.getPositionSec();
      RE.UI.clearMessage('study');
      if (which === 'start') {
        var n = RE.Utils.clamp(Math.floor(pos), b.start, Math.max(Math.ceil(r.e) - 1, b.start));
        if (n !== r.s) setRange_(n, r.e, true, false);
      } else {
        var m = RE.Utils.clamp(Math.ceil(pos), r.s + 1, b.end);
        if (m !== r.e) setRange_(r.s, m, false, false);
      }
    },
    onSelectAll: function () {
      var b = bounds_(); if (!b) return;
      RE.UI.clearMessage('study');
      setRange_(b.start, b.end, true, false);
    },
    onPlayPause: function () {
      if (!currentRange()) { RE.UI.showMessage('study', M.NO_AUDIO_SECTION); return; }
      if (RE.Engine.getState() === S.PLAYING) RE.Engine.pause();
      else { RE.UI.clearMessage('study'); RE.Engine.play(); }
    },
    onStop: function () { RE.Engine.stop(); },
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
    onGapSelect: function (g) {
      ST().gapSec = g;
      RE.Utils.saveGapSec(g);
      RE.Engine.setGap(g);
      RE.UI.renderSettings();
    },
    onRateSelect: function (rate) {
      var st = ST(), r = currentRange();
      if (!r) { RE.UI.showMessage('study', M.NO_AUDIO_SECTION); return; }
      if (rate !== 1 && r.e - r.s > C.STRETCH_MAX_SECTION_SEC) { RE.UI.showMessage('study', C.MSG.RATE_TOO_LONG, true); return; }
      st.rate = rate;
      RE.UI.clearMessage('study');
      // 頭に戻らない：再生中は今の位置から新しい倍速で続ける。止まっているときは再生を始めない（仕様 6.5.2）
      if (RE.Engine.getState() === S.PLAYING) {
        var pos = RE.Engine.getPositionSec();
        RE.Engine.setRate(rate);
        RE.Engine.seekTo(pos);
      } else {
        RE.Engine.setRate(rate);
      }
      RE.UI.renderStudyTop();
    },
    // シークバーを離したとき：その位置へ移る（仕様 6.5.2）
    onSeek: function (sec) {
      var r = currentRange(); if (!r) return;
      RE.Engine.seekTo(Math.min(Math.max(sec, r.s), r.e));
      RE.UI.updatePosition(RE.Engine.getPositionSec());
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
                     marked: !!a.marked, sections: RE.Sync.makeData(a).sections, memos: RE.Sync.copyMemos(a.memos) };
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
        else if (d && d.app === K.SYNC_APP && Array.isArray(d.sections)) entries = [{ blockIds: d.sections.map(function (s) { return s && s.id; }), marked: d.marked, sections: d.sections, memos: d.memos }];
        if (!entries) { RE.UI.showMessage('settings', M.BACKUP_BAD, true); return; }
        return RE.Db.listArticles().then(function (list) {
          var done = [], jobs = [];
          list.forEach(function (a) {
            var ids = (a.sections || []).map(function (s) { return s.id; }).join(',');
            var e = entries.filter(function (x) { return Array.isArray(x.blockIds) && x.blockIds.join(',') === ids; })[0];
            if (!e) return;
            var data = { app: K.SYNC_APP, format: K.SYNC_FORMAT, marked: !!e.marked, sections: e.sections, memos: e.memos, savedAt: a.syncSavedAt || 0 };
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

  RE.Main = {
    start: start, handlers: handlers, buildView_: buildView_,
    navList: navList, navIndex: navIndex, partLabel: partLabel_, sectionEntry: sectionEntry, currentRange: currentRange,
    studyProgressText: studyProgressText, libraryProgressText: libraryProgressText, driveProblemText: driveProblemText,
    memosOf: memosOf_, sectionSentences: sectionSentences_, isCurrentMemo: isCurrentMemo_,
    blockIndex: blockIndex_, durEnd: durEnd_
  };

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start);
  else start();
})();
