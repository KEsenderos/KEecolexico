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
    RE.State.screen = 'screen-library';
    RE.State.article = null;
    RE.State.view = null;
    RE.State.blockId = '';
    RE.State.rangeStart = 0;            // 繰り返す範囲の開始（音声全体の時刻）
    RE.State.rangeEnd = 0;              // 繰り返す範囲の終了
    RE.State.rangeEditOpen = false;     // 時刻の▲▼の開閉
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
    RE.State.driveLinkId = '';          // 結び付けるときの記事のID（空＝ふつうの取り込み。仕様 8.7.1）
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
    RE.State.engineMode = 'study';      // エンジンの使い方：'study'（学習の範囲）／'mark'（記録画面。倍速1・間0・全体）
    RE.State.markArticleId = '';        // 記録画面の途中の記録がある記事（タブを移っても残す。仕様 8.9）
    RE.State.scrollPos = {};            // 画面ごとのスクロールの位置
    RE.State.sheetOpen = false;         // 節の一覧の開閉
    RE.State.syncStatus = 'off';        // 受け渡しの状態（仕様 6.7.4）
    RE.State.syncRemote = null;         // 確認画面に出しているドライブの中身
    RE.State.syncAppliedFrom = null;    // 自動で読み込んだ端末名（メッセージを出したら null）
    RE.State.syncError = '';            // 送れなかった・読めなかった理由（GASが返した記号など。仕様 6.7.9）
  }

  // 追加画面・ドライブ取り込みの途中の入力の初期値
  function newDraft() {
    return { text: '', csvText: '', file: null, durationSec: 0, title: '', driveFolderId: '', sync: null };
  }

  RE.State = { init: init, newDraft: newDraft };
})();
