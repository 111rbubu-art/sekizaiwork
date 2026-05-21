'use strict';

const fs   = require('fs');
const path = require('path');

// STORAGE_DIR 環境変数（Docker本番）またはファイル相対パスでcustom-documentsを解決
const STORAGE_DIR = process.env.STORAGE_DIR || path.join(__dirname, '..', '..', '..');
const CUSTOM_DOCS = path.join(STORAGE_DIR, 'custom-documents');
const DATA_PREFIX  = 'sekizai-price-data';

function loadPriceData() {
  if (!fs.existsSync(CUSTOM_DOCS)) return null;
  const files = fs.readdirSync(CUSTOM_DOCS);
  for (const f of files) {
    if (!f.endsWith('.json')) continue;
    try {
      const doc = JSON.parse(fs.readFileSync(path.join(CUSTOM_DOCS, f), 'utf8'));
      if (doc.title && doc.title.startsWith(DATA_PREFIX)) {
        return JSON.parse(doc.pageContent);
      }
    } catch (_) {}
  }
  return null;
}

function formatItem(it) {
  const lines = [];
  lines.push('【商品】' + (it.Title || '名称未設定') + '（ID:' + it.id + '）');
  if (it.choice)         lines.push('  カテゴリ: ' + it.choice);
  if (it.choice_x2461_)  lines.push('  選択②: '   + it.choice_x2461_);
  if (it.choice3)        lines.push('  選択③: '   + it.choice3);
  const price = (it.cost != null && it.cost !== '')
    ? Number(it.cost).toLocaleString('ja-JP') + '円'
    : '未設定';
  lines.push('  販売価格（税抜）: ' + price);
  if (it.supplier) {
    let s = '  仕入先①: ' + it.supplier;
    if (it.PurchasePrice != null && it.PurchasePrice !== '')
      s += '（仕入価格 ' + Number(it.PurchasePrice).toLocaleString('ja-JP') + '円）';
    lines.push(s);
  }
  if (it.supplier2) {
    let s = '  仕入先②: ' + it.supplier2;
    if (it.PurchasePrice2 != null && it.PurchasePrice2 !== '')
      s += '（仕入価格 ' + Number(it.PurchasePrice2).toLocaleString('ja-JP') + '円）';
    lines.push(s);
  }
  if (it.note)    lines.push('  備考: ' + it.note);
  if (it.note0)   lines.push('  備考（仕入外注用）: ' + it.note0);
  if (it.editUrl) lines.push('  編集URL: ' + it.editUrl);
  return lines.join('\n');
}

module.exports.runtime = {
  handler: async function({ query }) {
    try {
      const items = loadPriceData();
      if (!items) {
        return 'エラー: 価格データが見つかりません。アプリの「🔄 AI同期」ボタンを押してデータを更新してください。';
      }

      const q = String(query || '').toLowerCase();
      const hits = items.filter(it =>
        String(it.Title         || '').toLowerCase().includes(q) ||
        String(it.choice        || '').toLowerCase().includes(q) ||
        String(it.choice_x2461_ || '').toLowerCase().includes(q) ||
        String(it.choice3       || '').toLowerCase().includes(q) ||
        String(it.supplier      || '').toLowerCase().includes(q) ||
        String(it.supplier2     || '').toLowerCase().includes(q) ||
        String(it.note          || '').toLowerCase().includes(q)
      );

      if (!hits.length) {
        return '「' + query + '」に該当する商品が見つかりませんでした。別のキーワードでお試しください。';
      }

      const MAX = 10;
      let result = hits.length + '件見つかりました:\n\n';
      result += hits.slice(0, MAX).map(formatItem).join('\n\n');
      if (hits.length > MAX) result += '\n\n（他 ' + (hits.length - MAX) + '件）';
      return result;
    } catch (e) {
      return 'エラー: ' + e.message;
    }
  }
};
