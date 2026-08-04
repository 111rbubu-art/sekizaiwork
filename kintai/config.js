/* ============================================================
   勤怠管理 — 設定
   会社の運用に合わせて変更するのは、原則このファイルだけです。
   ============================================================ */

var KINTAI_VERSION = 'v0.1.1';

/* ── Microsoft 365 / SharePoint ──────────────────────────── */
var KT_TENANT_ID = 'c78b3598-1933-4363-91f1-744a380bd9c9';
var KT_CLIENT_ID = 'f6d7ca4a-f786-4a91-bdb0-6d8e576e6aea';
var KT_SITE_ID   = 'shojisekizai.sharepoint.com,c99bde29-d526-4356-9835-91d935ef69dc,68843c66-a8c6-40d6-8ea5-02505dc86c03';

/* SharePoint リスト名（SETUP.md の手順で作成する） */
var KT_LIST = {
  employees: 'KintaiEmployees',
  punches:   'KintaiPunchLogs',
  sites:     'KintaiSites',
  grants:    'KintaiLeaveGrants',
  requests:  'KintaiLeaveRequests',
  holidays:  'KintaiHolidays'
};

/* ── 休日の定義 ──────────────────────────────────────────
   法定休日  … 労基法上の休日。出勤すると 35% の割増（週1日で足りる）
   所定休日  … 会社が定める休み。出勤しても、週40時間を超えた分だけ 25%

   当社の休日は「土日 ＋ 毎月14日・15日」。
   このうち法定休日を日曜、残りを所定休日として扱います。
   就業規則で日曜以外を法定休日と定めている場合は下の数字を変えてください。
   （0=日 1=月 2=火 3=水 4=木 5=金 6=土）
   ------------------------------------------------------------ */
var KT_HOLIDAY = {
  legalWeekday:     0,        // 法定休日の曜日 … 日曜
  companyWeekdays:  [6],      // 所定休日の曜日 … 土曜
  companyDays:      [14, 15]  // 所定休日の日付 … 毎月14日・15日
};

/* ── 労働時間 ────────────────────────────────────────────── */
var KT_WORK = {
  dailyLegalMin:  480,   // 法定労働時間（1日）= 8時間
  weeklyLegalMin: 2400,  // 法定労働時間（1週）= 40時間
  nightStartHour: 22,    // 深夜の開始 22:00
  nightEndHour:   5,     // 深夜の終了 翌5:00
  roundToMinute:  true,  // 1分単位で計算する（切り捨ては労基法違反）
  breakRule: [           // 労働時間に応じて必要な休憩（労基法34条）
    { overMin: 480, needMin: 60 },
    { overMin: 360, needMin: 45 }
  ]
};

/* 割増率（基礎賃金に対する倍率） */
var KT_RATE = {
  overtime:       1.25,  // 法定時間外
  overtime60:     1.50,  // 1か月60時間を超える法定時間外
  legalHoliday:   1.35,  // 法定休日労働
  nightAdd:       0.25   // 深夜は上記に加算
};

/* ── 位置情報 ────────────────────────────────────────────── */
var KT_GEO = {
  enableHighAccuracy: true,
  timeoutMs:      8000,   // 8秒で打ち切り、位置なしで打刻を通す
  maximumAgeMs:   30000,  // 30秒以内の測位結果は再利用する
  defaultRadiusM: 150,    // 現場マスタで半径未設定のときの既定値
  accuracyCapM:   200,    // 判定時に半径へ加算する測位誤差の上限
  poorAccuracyM:  500,    // これより粗い測位は「精度低」として要確認
  maxSpeedKmh:    150     // 前回打刻からこれを超える移動速度は「移動異常」
};

/* ── 打刻 ────────────────────────────────────────────────── */
var KT_PUNCH = {
  lockMs:        2000,   // 押下後の再押下ロック（二重打刻防止）
  dedupeMin:     5,      // 同種の打刻がこの分数以内なら重複とみなす
  driftAlertSec: 300,    // 端末時刻とサーバ時刻の差がこれ以上なら要確認
  dayStartHour:  4       // 勤務日の切り替わり時刻（深夜勤務は前日扱い）
};

/* ── 有給休暇 ────────────────────────────────────────────── */
var KT_LEAVE = {
  baseDateMode:   'hire',  // 'hire' = 入社日基準 ／ 'fixed' = 全社統一
  fixedBaseMonth: 4,       // baseDateMode='fixed' のときの基準月
  fixedBaseDay:   1,
  expireYears:    2,       // 時効（労基法115条）
  minAttendRate:  0.8,     // 出勤率がこれ未満なら付与なし
  consumeOrder:   'fifo',  // 古い付与分から消化する（就業規則に明記のこと）
  obligationDays: 5,       // 年5日の取得義務（労基法39条7項）
  obligationMinGrant: 10,  // 付与日数がこれ以上の場合に義務が発生
  alerts: [                // 未消化の警告（付与日からの経過月数）
    { afterMonth: 6,  underDays: 2, level: 'caution' },
    { afterMonth: 9,  underDays: 3, level: 'warn' },
    { afterMonth: 10, underDays: 5, level: 'urgent' }
  ]
};

/* 通常の付与日数（週5日以上、または週30時間以上）
   [6か月, 1.5年, 2.5年, 3.5年, 4.5年, 5.5年, 6.5年以降] */
var KT_GRANT_FULL = [10, 11, 12, 14, 16, 18, 20];

/* 比例付与（週4日以下 かつ 週30時間未満）
   現在は該当者なし。将来パート・アルバイトを雇う場合に自動で適用される。 */
var KT_GRANT_PRO = {
  4: [7, 8, 9, 10, 12, 13, 15],
  3: [5, 6, 6,  8,  9, 10, 11],
  2: [3, 4, 4,  5,  6,  6,  7],
  1: [1, 2, 2,  2,  3,  3,  3]
};
