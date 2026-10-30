/* js/config.js / KEecolexico の定数（RE.Config）。KEecoloop v2.10.1 の config.js を元に、名前・版・保存キーを変え、KX・KXMSG を追加 */
/* 基づく仕様書：KEecolexico 仕様書 v1.3 */
(function () {
  'use strict';
  window.RE = window.RE || {};

  RE.Config = Object.freeze({
    APP_NAME: 'KEecolexico',
    APP_VERSION: '1.3',
    ENGINE_TYPE: 'WEB_AUDIO',
    MOVE_SEC_MIN: 1,
    MOVE_SEC_MAX: 60,
    MOVE_SEC_DEFAULT: 5,
    START_DEFAULT_SEC: 0,
    END_DEFAULT_SEC: 5,
    TIME_UNITS_SEC: Object.freeze([600, 60, 10, 1]),
    OVERLAP_SEC: 1,
    REMOTE_DEBOUNCE_MS: 300,
    PRESS_MIN_MS: 150,
    RATE_OPTIONS: Object.freeze([1.2, 1.1, 1.0, 0.9, 0.8]),
    RATE_DEFAULT: 1.0,
    STRETCH_FRAME_MS: 40,
    STRETCH_SEARCH_MS: 15,
    STRETCH_DECIMATE: 4,
    STRETCH_MAX_SECTION_SEC: 180,
    UPDATE_CHECK_MIN_MS: 600000,
    MODE: Object.freeze({ SINGLE: 'SINGLE', DOUBLE: 'DOUBLE', TRIPLE: 'TRIPLE' }),
    DOUBLE_MAX_SECTION_SEC: 2400,
    TRIPLE_MAX_SECTION_SEC: 3600,   // 3区間モードの区間合計の上限（秒＝60分）
    TRIPLE_STEREO_MAX_MB: 450,      // 3区間モードで、展開後サイズの合計がこれ以下ならステレオのまま、超えたらモノラル
    // 読み込み時の軽量化。ステレオは維持し、24kHzで展開（話し声ではほぼ差が出ない）。0にすると端末標準（最高音質・メモリ大）
    AUDIO_SAMPLE_RATE: 24000,
    AUDIO_MONO: false,
    // ファイル選択欄の accept 属性。音声だけに絞り、iPhoneで「写真ライブラリ」「写真またはビデオを撮る」を出さない。
    // 空文字 '' にすると accept 属性を付けない（iPhoneで音声が灰色になって選べない場合の戻し先）。
    ACCEPT_AUDIO: '.mp3,.m4a,.wav,.aac,.flac,.ogg,audio/mpeg,audio/mp4,audio/x-m4a,audio/wav,audio/x-wav,audio/aac,audio/flac,audio/ogg',
    GAP_OPTIONS: Object.freeze([0, 1, 2, 3, 5]),
    GAP_DEFAULT: 0,
    STORAGE_KEY_GAP: 'kx.gapSec',
    STORAGE_KEY_RESTORING: 'kx.restoring',
    DB_NAME: 'keecolexico-db',
    DB_VERSION: 1,
    // 区間メモ（v2.9）
    MEMO_MAX_PER_FILE: 10,
    MEMO_MAX_FILES: 50,
    SAVE_MAX_BYTES: 41943040,
    RESTORE_TIMEOUT_MS: 4000,
    // 説明文（画面の各所の小さい文字）。印を変えるときは PREFIX だけ直す
    HINT: Object.freeze({
      PREFIX: '※ ',
      NEXT: '指定した時間を移動させます',
      MOVE_NOTE_N: '区間移動: 開始・終了を1秒戻してから、{n}秒進めます（実質＋{step}秒）',
      MOVE_NOTE_1: '区間移動: 開始・終了をそのまま1秒進めます（移動時間が1秒のときだけの決まり）',
      GAP: '区間を1回聞くごとに、この秒数の無音を入れます',
      RATE: '声の高さはそのままで、速さだけ変えます。押すとすぐ再生（区間の合計3分まで）',
      MEMO: '「区間保存」で今の開始・終了を最上部に残します（10件まで。10件のとき、赤字の最下部は次の保存で消えます）。タップでその区間を再生、≡を押しながら動かして並べ替え、×で削除'
    }),
    UI_REFRESH_MS: 250,
    MINUTES_MAX_DIGITS: 2,
    BAR_MARKER_MIN_PX: 8,
    KEEPALIVE_SILENT_AUDIO: true,
    STORAGE_KEY_MOVE: 'kx.moveSec',
    PLAYER_STATE: Object.freeze({ NO_FILE: 'NO_FILE', STOPPED: 'STOPPED', PLAYING: 'PLAYING', PAUSED: 'PAUSED' }),
    ERR: Object.freeze({ DECODE: 'DECODE', PLAY_BLOCKED: 'PLAY_BLOCKED', INTERRUPTED: 'INTERRUPTED', TOO_LONG: 'TOO_LONG' }),
    MSG: Object.freeze({
      FILE_LOADING: 'ファイルを読み込み中…',
      FILE_ERROR: '読み込めませんでした。mp3・m4a・wav形式か確認してください',
      NO_FILE_SELECTED: 'まず ⏏ でファイルを選んでください',
      MOVE_SEC_INVALID: '移動時間は1〜60の数字で入力してください',
      MOVE_SEC_CLAMPED: '1〜60の範囲に直しました',
      REACHED_END: 'ファイルの終わりに達しました',
      PLAY_BLOCKED: '再生できませんでした。もう一度再生ボタンを押してください',
      INTERRUPTED: '再生が中断されました。再生ボタンで再開できます',
      RATE_TOO_LONG: '区間が長すぎるため、この倍速は使えません（3分以内にしてください）',
      RATE_RESET_LONG: '区間が長いため、倍速を1.0に戻しました',
      UPDATE_AVAILABLE: '新しい版があります。ここをタップして更新',
      UPDATE_NOTE: '選んだファイルは選び直しになります',
      DOUBLE_TOO_LONG: '区間の合計が長すぎます（40分以内にしてください）',
      TRIPLE_TOO_LONG: '区間の合計が長すぎます（60分以内にしてください）',
      TRIPLE_MONO_NOTICE: '長いファイルのため、メモリ節約でモノラルにしました',
      REACHED_START: '最初の区間です',
      MARK_NEED_PLAY: '再生中に押してください',
      MARK_OTHER_SLOT: '今鳴っている側の「ここを」ボタンを押してください',
      RESTORE_FAILED: '前回のファイルを読み込めませんでした。⏏ で選んでください',
      RESTORE_SKIPPED: '前回の読み込みが途中で止まったため、自動再開をやめました。⏏ で選んでください',
      NO_B_FILE_SELECTED: '2つ目の音声を選ぶには、2つ目の ⏏ を押してください',
      MEMO_SAVED: '区間を保存しました',
      MEMO_DUP: '同じ区間がすでに保存されています',
      MEMO_REPLACED: '10件までのため、いちばん下の区間を消して保存しました',
      MEMO_OUT_OF_RANGE: 'この区間は、このファイルの長さを超えています'
    }),
    KX: Object.freeze({
      STORE_ARTICLES: 'articles',
      STORE_AUDIOS: 'audios',
      STORAGE_KEY_FONT: 'kx.fontSize',          // "L" | "M" | "S"
      STORAGE_KEY_DEADLINE: 'kx.deadlineWeekday', // 5=金 / 6=土
      FONT_DEFAULT: 'M',
      FONT_SIZES: { L: 20, M: 17, S: 14 },      // 意味の文字(px)。スペイン語は +2px
      DEADLINE_OPTIONS: [5, 6],
      DEADLINE_DEFAULT: 6,
      WEEKDAY_LABELS: ['日', '月', '火', '水', '木', '金', '土'],
      DAY_START_HOUR: 4,                        // 1日の区切り（午前4時）
      // v0.10 で MARK_LEAD_SEC・MARK_UNDO_MAX・MARK_LABELS・SEEK_SEC は廃止（記録画面の操作をやめたため）
      PART_LETTERS: 'ABCDEFGHIJ',               // 区間の呼び名。1つの節の区間は最大この文字数（10）
      ADJUST_SEC: 1,                            // 微調整ボタン1回の秒数
      SECTION_NONE: 'B-NONE',
      CSV_ACCEPT: '.csv,text/csv,text/comma-separated-values',
      TITLE_MAX: 40,                            // 記事名の初期値の最大文字数
      CACHE_PREFIX: 'kx-cache-',
      STORAGE_KEY_GAS_URL: 'kx.gasUrl',         // GASのウェブアプリのURL
      STORAGE_KEY_GAS_KEY: 'kx.gasKey',         // 合言葉
      DRIVE_TIMEOUT_MS: 60000,                  // GAS1回の呼び出しを待つ最大時間
      SYNC_TIMEOUT_MS: 30000,                   // 受け渡しファイルの読み書きを待つ最大時間
      SYNC_APP: 'KEecolexico',                  // 受け渡しファイルの app の値
      SYNC_FORMAT: 1,                           // 受け渡しファイルの形の版
      SYNC_DEVICE_OTHER: '別の端末',             // iPhone・iPad・Mac のどれでもないときの呼び名
      MEMO_MAX_PER_SECTION: 30,                 // 1つの節に保存できる区間メモの数
      STORAGE_KEY_WORKTAB: 'kx.workTab',        // 作業場の小さなタブ（'article'｜'section'）
      RATE_CHOICES: [1.6, 1.4, 1.2, 1.0, 0.8, 0.6], // 倍速の一覧（上から並べる順。v1.0）
      SEEK_STEP_SEC: 0.1,                       // シークバーの細かさ（秒。v1.0）
      // 自動区切り（v1.1。仕様 6.10）
      AUTO_MODEL: 'onnx-community/whisper-base_timestamped',
      AUTO_WORKER_URL: 'js/align-worker.js',
      AUTO_SAMPLE_RATE: 16000,
      AUTO_FRAME_SEC: 0.02,
      AUTO_SEG_TARGET_SEC: 25,
      AUTO_SEG_SEARCH_SEC: 5,
      AUTO_SNAP_PAD_SEC: 0.3,
      AUTO_MIN_RATIO: 0.3,
      AUTO_INSERT_MIN_SEC: 3,
      AUTO_LANGUAGE: 'spanish',
      SYNC_ALL_MIN_MS: 30000,                   // 前面に戻ったとき、前回の一括同期からこの時間たっていれば、また同期する（v1.2）
      TXT_ACCEPT: '.txt,text/plain'
    }),

    KXMSG: Object.freeze({
      PARSE_OK: '認識：{blocks}節（本文{body}文・質問{q}・復習質問{r}）',
      PARSE_ERROR: '記事の形式として認識できませんでした（質問番号「1.」と「Respuesta」が必要です）',
      CSV_OK: '照合：{total}語のうち{found}語が本文で見つかりました（見つからない語 {none}）',
      CSV_ERROR: 'CSVを読み込めませんでした。KElupalabrasで保存したCSVか確認してください',
      AUDIO_OK: '音声：{name}（{dur}）',
      NEED_ALL: '本文・CSV・音声の3つをそろえてください',
      SAVED: '保存しました',
      SAVE_ERROR: '保存できませんでした。iPhoneの空き容量を確認してください',
      LOADING: '音声を読み込み中…',
      LOAD_ERROR: '音声を読み込めませんでした。記事を削除して、もう一度追加してください',
      NEED_MARK: '先に、作業場の「本文分割」で節の範囲を保存してください',
      NO_AUDIO_SECTION: 'この節は音声と結び付いていません（とばした節）',
      MARK_ORDER: '前後の区間と重ならない位置にしてください',
      MARK_PART_MAX: '1つの節の区間は10までです',
      MARK_RESET_CONFIRM: 'もう一度押すと、すべての記録を消して最初からになります',
      ALL_DONE: 'この記事はすべて完了しました',
      DELETE_CONFIRM: 'もう一度押すと削除します',
      DELETED: '削除しました',
      DRIVE_NEED_SETTINGS: '設定画面で、GASのURLと合言葉を入れてください',
      DRIVE_LOADING_LIST: 'ドライブの一覧を読み込み中…',
      DRIVE_EMPTY: 'KEecolexicoフォルダに記事のフォルダがありません',
      DRIVE_LOADING_TEXT: '本文とCSVを取得中…',
      DRIVE_LOADING_AUDIO: '音声を取得中…（{n}/{m}）',
      DRIVE_MISSING: '足りないファイルがあります：{list}',
      DRIVE_DUPLICATE: '同じ種類のファイルが2つ以上あります：{list}（いらない方をフォルダから出してください）',
      DRIVE_IMPORTED: '取り込み済み',
      DRIVE_ADD_TITLE: 'ドライブから追加',
      DRIVE_LINK_BUTTON: '☁ ドライブと結び付ける',
      DRIVE_LINK_TITLE: '結び付けるフォルダを選ぶ',
      DRIVE_LINK_HINT: '「{title}」と同じ記事のフォルダを選んでください',
      DRIVE_LINK_CHECKING: '本文を確認中…',
      DRIVE_LINK_MISMATCH: 'このフォルダの本文は、節の並びが「{title}」と違うため結び付けられません',
      DRIVE_LINKED: 'ドライブのフォルダと結び付けました',
      DRIVE_AUDIO_FAILED: '音声を受け取れませんでした。「音声だけiPhoneから選ぶ」で続けられます',
      DRIVE_ERR_BAD_KEY: '合言葉が違います。設定画面を確認してください',
      DRIVE_ERR_NETWORK: 'つながりませんでした。電波の良い所でもう一度押してください',
      DRIVE_ERR_OTHER: 'ドライブから取り込めませんでした（{code}）',
      SETTINGS_SAVED: '設定を保存しました',
      SYNC_STATUS_SAME: '☁ ドライブと同じ',
      SYNC_STATUS_CHECKING: '☁ ドライブを確認中…',
      SYNC_STATUS_PENDING: '☁ まだドライブへ送れていません（次に開いたときに送ります）',
      SYNC_STATUS_OFFLINE: '☁ ドライブを確認できませんでした',
      SYNC_STATUS_MISMATCH: '☁ ドライブの区切りがこの記事と合わないため、受け渡ししていません',
      SYNC_APPLIED: '{device}で保存した区切り・完了を読み込みました',
      SYNC_CONFLICT_TITLE: 'ドライブの区切り・完了が、この端末のものと違います',
      SYNC_CONFLICT_REMOTE: 'ドライブ：{device}で{date}に保存（区間{parts}・完了{done}節・区間メモ{memos}）',
      SYNC_CONFLICT_LOCAL: 'この端末：区間{parts}・完了{done}節・区間メモ{memos}',
      SYNC_USE_REMOTE: '{device}のものに置き換える',
      SYNC_KEEP_LOCAL: 'この端末のものを残す（ドライブを上書き）',
      SYNC_REPLACED: '{device}のものに置き換えました',
      SYNC_KEPT: 'この端末のものでドライブを上書きしました',
      SYNC_REASON: '理由：{reason}',
      SYNC_RETRY_HINT: '（ここを押すと、もう一度試します）',
      UPDATE_NOTE: '記事・区切り・完了・区間メモは消えません（再生は止まります）',
      MEMO_SID_LABEL: 'この文',
      SPLIT_BLOCK_LABEL: 'この節',
      MEMO_SAVE: '文保存（{sid}）',
      SECTION_SAVE: '節保存',
      SECTION_ADD: '区間を足す',
      SECTION_SAVED: '{name}の範囲を保存しました',
      PART_ADDED: '{name}を足しました',
      BREAK_LAST: '最後の区切りです',
      BREAK_FIRST: '最初の区切りです',
      WORK_ARTICLE: '本文分割',
      WORK_SECTION: '節分割',
      MARKS_SUMMARY: '保存した節 {done}／{total}・文 {memos}',
      MARKS_NO_MEMO: '文の区切りはまだありません（作業場の「節分割」で作れます）',
      MARK_NOT_YET: '—（まだ）',
      HINT_SECTION: '※ 文を押して選び、開始・終了をその文に合わせて「文保存」。保存すると次の文が選ばれ、範囲も続きから始まります',
      HINT_ARTICLE: '※ 節を選び、再生しながら節の終わりで「ここを終了」→「節保存」。保存すると次の節が選ばれ、範囲も続きから始まります',
      MEMO_SAVED: '「{sid}」を保存しました',
      MEMO_REPLACED: '「{sid}」を今の範囲に置き換えました',
      MEMO_FULL: 'この節の区間メモは30件までです。いらないものを×で消してください',
      MEMO_OUT_OF_RANGE: 'この区間メモは、今の区切りの範囲の外にあります（区切りを直したため）。×で消して、保存し直してください',
      AUTO_BUTTON: '自動区切り（Mac）',
      AUTO_BUTTON_CONFIRM: '本当に置き換える',
      AUTO_BUTTON_BUSY: '自動区切り中…',
      AUTO_CONFIRM: '「{title}」：もう一度押すと、すべての節の区切りと区間メモを、自動の結果で置き換えます（完了の記録は残ります）',
      AUTO_MAC_ONLY: '自動区切りは Mac で行ってください（できた区切りは iPhone に受け渡されます）',
      AUTO_PREPARING: '自動区切り：音声を準備中…',
      AUTO_DOWNLOAD: '自動区切り：AIのモデルを取得中 {n}%（初回だけ。Wi-Fiで）',
      AUTO_RECOG: '自動区切り：音声を認識中 {done}/{total}',
      AUTO_ALIGN: '自動区切り：本文と突き合わせ中…',
      AUTO_DONE: '自動区切りが終わりました：{blocks}節・区間メモ{memos}文（見つからなかった文 {miss}）。節分割・区切りタブで確かめ、ずれは▲▼で直してください',
      AUTO_FAILED: '自動区切りできませんでした（{reason}）。もう一度押してください',
      SYNCALL_RUNNING: '☁ すべての記事をドライブとそろえています… {n}/{m}',
      SYNCALL_DONE: '☁ すべての記事がドライブと同じです（{time}）',
      SYNCALL_SOME: '☁ {k}件の記事はドライブとそろえられませんでした。電波の良い所で開き直すと、もう一度そろえます',
      SYNCALL_NEW: 'ドライブに、この端末に無い記事が{n}件あります。「＋ ドライブから追加」で取り込むと、区切りと完了の記録も一緒に入ります',
      RATE_LABEL: '{rate}×',                     // 倍速の枠と一覧の文字（例「1.0×」。v1.0）
      BACKUP_FILE_PREFIX: 'keecolexico-backup-',
      BACKUP_EXPORTED: '書き出しました：{name}（{n}件の記事）',
      BACKUP_EMPTY: '書き出す記事がありません',
      BACKUP_BAD: 'KEecolexicoの控えのファイルではありません',
      BACKUP_IMPORTED: '区切り・完了を読み込みました：{titles}',
      BACKUP_NO_MATCH: 'この端末に、同じ本文の記事がありません。先に記事を取り込んでから読み込んでください'
    })
  });
})();
