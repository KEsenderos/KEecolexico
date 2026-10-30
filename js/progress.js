// progress.js — 「今日」と締切までの日数、今日の目安を計算する
// 基づく仕様書：KEecolexico 仕様書 v1.3
(function () {
  'use strict';
  var K = function () { return RE.Config.KX; };
  // 午前4時区切りの「今日」の Date（時刻は0時）
  function getToday_() {
    var d = new Date(Date.now() - K().DAY_START_HOUR * 3600000);
    return new Date(d.getFullYear(), d.getMonth(), d.getDate());
  }
  // "2026-10-26" の形
  function todayKey() {
    var d = getToday_(), p = function (n) { return (n < 10 ? '0' : '') + n; };
    return d.getFullYear() + '-' + p(d.getMonth() + 1) + '-' + p(d.getDate());
  }
  // 締切まで日数（今日を含む。今日が締切曜日なら1）
  function daysUntilDeadline(weekday) {
    return ((weekday - getToday_().getDay() + 7) % 7) + 1;
  }
  // sections から { remaining, days, doneToday, target, allDone }
  function calc(sections, weekday) {
    var key = todayKey();
    var targets = sections.filter(function (s) { return s.parts && s.parts.length > 0; });
    var remaining = targets.filter(function (s) { return !s.done; }).length;
    var doneToday = targets.filter(function (s) { return s.done === key; }).length;
    var days = daysUntilDeadline(weekday);
    var target = Math.ceil((remaining + doneToday) / days);
    return { remaining: remaining, days: days, doneToday: doneToday, target: target,
             allDone: targets.length > 0 && remaining === 0 };
  }
  window.RE = window.RE || {};
  RE.Progress = { todayKey: todayKey, daysUntilDeadline: daysUntilDeadline, calc: calc };
})();
