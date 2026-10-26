/* js/state.js — アプリの状態をまとめて持つ（RE.State） */
(function () {
  'use strict';
  var C = RE.Config;

  // localStorage から1つ読む（使えなければ null）
  function read_(key) {
    try { return window.localStorage.getItem(key); } catch (e) { return null; }
  }

  // 全部を初期値にする
  function init() {
    var K = C.KX;
    var font = read_(K.STORAGE_KEY_FONT);
    var dl = parseInt(read_(K.STORAGE_KEY_DEADLINE), 10);
    var rp = read_(K.STORAGE_KEY_REPEAT);
    RE.State.screen = 'screen-library';
    RE.State.prevScreen = 'screen-library';
    RE.State.article = null;
    RE.State.view = null;
    RE.State.blockId = '';
    RE.State.repeatMode = (rp === K.REPEAT.SECTION || rp === K.REPEAT.CHUNK) ? rp : K.REPEAT_DEFAULT;
    RE.State.chunkStart = 0;
    RE.State.moveSec = RE.Utils.loadMoveSec();
    RE.State.gapSec = RE.Utils.loadGapSec();
    RE.State.rate = C.RATE_DEFAULT;
    RE.State.playerState = C.PLAYER_STATE.NO_FILE;
    RE.State.fontSize = K.FONT_SIZES[font] ? font : K.FONT_DEFAULT;
    RE.State.deadlineWeekday = K.DEADLINE_OPTIONS.indexOf(dl) >= 0 ? dl : K.DEADLINE_DEFAULT;
    RE.State.importDraft = newDraft();
    RE.State.driveList = [];
    RE.State.driveBusy = false;
    RE.State.drivePending = null;       // 音声だけ受け取れなかったときの途中の入力
    RE.State.partIndex = 0;             // 表示中の区間の番号（とばした節・見つからなかった語は -1）
    RE.State.markIndex = 0;             // 記録画面で次に記録する節の番号
    RE.State.markParts = [];            // 記録画面の各節の区間（undefined=未記録、[]=とばした、[{s,e}]。e は未定なら null）
    RE.State.markState = 'idle';        // 記録の状態 'idle' / 'open' / 'paused'
    RE.State.markHistory = [];          // 「1つ取り消す」用の控え
    RE.State.markFromSaved = false;     // 「節の位置を直す」から開いたか
    RE.State.markResetPending = false;  // 「最初から記録し直す」の1回目を押したか
    RE.State.articles = [];             // 記事一覧
    RE.State.loadedArticleId = '';      // エンジンに音声を読み込んである記事
    RE.State.pendingDeleteId = '';      // 削除の1回目を押した記事
    RE.State.toolsOpen = false;         // 再生の設定の開閉
    RE.State.sheetOpen = false;         // 節の一覧の開閉
  }

  // 追加画面・ドライブ取り込みの途中の入力の初期値
  function newDraft() {
    return { text: '', csvText: '', file: null, durationSec: 0, title: '', driveFolderId: '' };
  }

  RE.State = { init: init, newDraft: newDraft };
})();
