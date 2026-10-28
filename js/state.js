/* js/state.js — アプリの状態をまとめて持つ（RE.State） */
/* 基づく仕様書：KEecolexico 仕様書 v1.0 */
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
    RE.State.memoSid = '';              // 区間保存で結び付ける文の番号（仕様 6.8.4）
    RE.State.gapSec = RE.Utils.loadGapSec();
    RE.State.rate = C.RATE_DEFAULT;
    RE.State.seekDragging = false;      // シークバーを指で動かしている最中か（仕様 6.5.2）
    RE.State.rateMenuOpen = false;      // 倍速の一覧が開いているか（仕様 8.10）
    RE.State.playerState = C.PLAYER_STATE.NO_FILE;
    RE.State.fontSize = K.FONT_SIZES[font] ? font : K.FONT_DEFAULT;
    RE.State.deadlineWeekday = K.DEADLINE_OPTIONS.indexOf(dl) >= 0 ? dl : K.DEADLINE_DEFAULT;
    RE.State.importDraft = newDraft();
    RE.State.driveList = [];
    RE.State.driveBusy = false;
    RE.State.drivePending = null;       // 音声だけ受け取れなかったときの途中の入力
    RE.State.driveLinkId = '';          // 結び付けるときの記事のID（空＝ふつうの取り込み。仕様 8.7.1）
    RE.State.partIndex = 0;             // 表示中の区間の番号（とばした節・見つからなかった語は -1）
    RE.State.markResetPending = false;  // 「最初から記録し直す」の1回目を押したか
    RE.State.markDeleteKey = '';        // 区間の × の1回目を押した区間（'節id|番号'）
    RE.State.articles = [];             // 記事一覧
    RE.State.loadedArticleId = '';      // エンジンに音声を読み込んである記事
    RE.State.pendingDeleteId = '';      // 削除の1回目を押した記事
    RE.State.engineMode = 'study';      // エンジンの使い方：'study'（今の区間）／'split'（本文分割。音声全体。仕様 6.5.1）
    var wt = read_(K.STORAGE_KEY_WORKTAB);
    RE.State.workTab = wt === 'section' ? 'section' : 'article';   // 作業場の小さなタブ（仕様 8.5.1）
    RE.State.splitBlockId = '';         // 本文分割で選んでいる節
    RE.State.splitStart = 0;            // 本文分割の範囲（音声全体の時刻）
    RE.State.splitEnd = 0;
    RE.State.openMarkBlockId = '';      // 区切りタブで開いている節（1つだけ。仕様 8.4）
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
