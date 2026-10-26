/* js/utils.js / 時間の変換・計算・保存の補助（RE.Utils） / 仕様書 v2.10.1 9.1章 / 版 2.10.1 */
(function () {
  'use strict';
  var C = RE.Config;

  function pad2(n) {
    return (n < 10 ? '0' : '') + n;
  }

  /** 秒を "mm:ss" へ（小数切り捨て、負は0扱い）。分が100以上なら桁が増える。 */
  function formatTime(sec) {
    var s = Math.floor(Number(sec));
    if (!isFinite(s) || s < 0) s = 0;
    return pad2(Math.floor(s / 60)) + ':' + pad2(s % 60);
  }

  /** 全角数字・全角コロンを半角へ。 */
  function toHalfWidth(text) {
    return String(text)
      .replace(/[０-９]/g, function (ch) { return String.fromCharCode(ch.charCodeAt(0) - 65248); })
      .replace(/：/g, ':');
  }

  /** "mm:ss" を秒へ。不正なら null。 */
  function parseTime(text) {
    var m = /^(\d{1,3}):([0-5]?\d)$/.exec(toHalfWidth(text).trim());
    if (!m) return null;
    return parseInt(m[1], 10) * 60 + parseInt(m[2], 10);
  }

  /** 秒を4桁に分ける。分は99まで（超えたら99:59）。小数は切り捨て、負は0 */
  function splitDigits(sec) {
    var s = Math.floor(Number(sec));
    if (!isFinite(s) || s < 0) s = 0;
    if (s > 99 * 60 + 59) s = 99 * 60 + 59;
    var m = Math.floor(s / 60), r = s % 60;
    return { m10: Math.floor(m / 10), m1: m % 10, s10: Math.floor(r / 10), s1: r % 10 };
  }

  function clamp(value, min, max) {
    return Math.min(max, Math.max(min, value));
  }

  /** 区間移動の進み幅 = max(moveSec - OVERLAP_SEC, 1) */
  function calcStepSec(moveSec) {
    return Math.max(moveSec - C.OVERLAP_SEC, 1);
  }

  function loadMoveSec() {
    try {
      var raw = window.localStorage.getItem(C.STORAGE_KEY_MOVE);
      var n = parseInt(raw, 10);
      if (isFinite(n) && n >= C.MOVE_SEC_MIN && n <= C.MOVE_SEC_MAX) return n;
    } catch (e) { /* 保存領域が使えない場合は既定値 */ }
    return C.MOVE_SEC_DEFAULT;
  }

  function saveMoveSec(n) {
    try { window.localStorage.setItem(C.STORAGE_KEY_MOVE, String(n)); } catch (e) { /* 何もしない */ }
  }

  function loadGapSec() {
    try {
      var n = parseInt(window.localStorage.getItem(C.STORAGE_KEY_GAP), 10);
      if (C.GAP_OPTIONS.indexOf(n) >= 0) return n;
    } catch (e) { /* 既定値 */ }
    return C.GAP_DEFAULT;
  }

  function saveGapSec(n) {
    try { window.localStorage.setItem(C.STORAGE_KEY_GAP, String(n)); } catch (e) { /* 何もしない */ }
  }

  /** ファイルを区別する文字列（ファイル名＋バイト数） */
  function makeFileKey(file) {
    return String(file.name) + '|' + String(file.size || 0);
  }

  /** 区間メモの id */
  function makeMemoId() {
    return Date.now().toString(36) + Math.random().toString(36).slice(2, 4);
  }

  RE.Utils = {
    makeFileKey: makeFileKey,
    makeMemoId: makeMemoId,
    loadGapSec: loadGapSec,
    saveGapSec: saveGapSec,
    pad2: pad2,
    formatTime: formatTime,
    toHalfWidth: toHalfWidth,
    parseTime: parseTime,
    splitDigits: splitDigits,
    clamp: clamp,
    calcStepSec: calcStepSec,
    loadMoveSec: loadMoveSec,
    saveMoveSec: saveMoveSec
  };
})();
