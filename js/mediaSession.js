/* js/mediaSession.js / ロック画面・コントロールセンター操作（RE.MediaSession） / 仕様書 v2.10.1 5.4・9.4章 / 版 2.10.1 */
(function () {
  'use strict';
  var C = RE.Config;
  var S = C.PLAYER_STATE;

  function supported_() { return 'mediaSession' in navigator; }

  var saved_ = null;

  /** handlers = { onPlay, onPause, onStop, onNext }。操作の一覧を覚えて、すぐ登録する */
  function init(handlers) {
    saved_ = handlers;
    register();
  }

  /**
   * 操作ボタン（再生・一時停止・停止・次へ）をiOSに登録する。
   * iOSは音声が読み込まれる前の登録を無視することがあるため、
   * ファイル読込後・再生開始時にも呼び直す（何度呼んでも安全）。
   */
  function register() {
    if (!supported_() || !saved_) return;
    var map = { play: saved_.onPlay, pause: saved_.onPause, stop: saved_.onStop, nexttrack: saved_.onNext };
    Object.keys(map).forEach(function (action) {
      try { navigator.mediaSession.setActionHandler(action, map[action]); } catch (e) { /* 未対応の操作は無視 */ }
    });
  }

  function setMetadata(fileName) {
    if (!supported_()) return;
    try { navigator.mediaSession.metadata = new MediaMetadata({ title: fileName, artist: C.APP_NAME }); } catch (e) { /* 無視 */ }
  }

  function setPlaybackState(state) {
    if (!supported_()) return;
    var v = state === S.PLAYING ? 'playing' : (state === S.NO_FILE ? 'none' : 'paused');
    try { navigator.mediaSession.playbackState = v; } catch (e) { /* 無視 */ }
  }

  RE.MediaSession = { init: init, register: register, setMetadata: setMetadata, setPlaybackState: setPlaybackState };
})();
