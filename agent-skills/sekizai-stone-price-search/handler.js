'use strict';

const fs   = require('fs');
const path = require('path');

const CUSTOM_DOCS = path.join(__dirname, '..', '..', '..', 'custom-documents');
const DATA_PREFIX  = 'sekizai-stone-price-data';

function loadStoneData() {
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

function formatStone(it) {
  const lines = [];
  lines.push('【石材】' + (it.Title || '名称未設定') + '（ID:' + it.id + '）');
  if (it.made)    lines.push('  産地: ' + it.made);
  if (it.country) lines.push('  国: '   + it.country);
  if (it.color)   lines.push('  色: '   + it.color);
  const price = (it.cost != null && it.cost !== '') ? it.cost + '円' : '未設定';
  lines.push('  単価: ' + price);
  if (it.name != null && it.name !== '') lines.push('  係数/規格: ' + it.name);
  if (it.Supplier1) {
    let s = '  仕入先①: ' + it.Supplier1;
    if (it.price1 != null && it.price1 !== '') {
      s += '（仕入価格 ' + Number(it.price1).toLocaleString('ja-JP') + '円';
      if (it.MachiningCostsIncluded1) s += '・加工費込';
      s += '）';
    }
    lines.push(s);
  }
  if (it.Supplier2) {
    let s = '  仕入先②: ' + it.Supplier2;
    if (it.price2 != null && it.price2 !== '') {
      s += '（仕入価格 ' + Number(it.price2).toLocaleString('ja-JP') + '円';
      if (it.MachiningCostsIncluded2) s += '・加工費込';
      s += '）';
    }
    lines.push(s);
  }
  if (it.EstimateDay) lines.push('  見積日: ' + String(it.EstimateDay).slice(0, 10));
  if (it.Features)    lines.push('  特徴: '   + it.Features);
  if (it.comment)     lines.push('  備考: '   + it.comment);
  if (it.editUrl)     lines.push('  編集URL: ' + it.editUrl);
  return lines.join('\n');
}

module.exports = {
  name: 'sekizai-stone-price-search',
  setup(aibitat) {
    aibitat.function({
      super: aibitat,
      name: this.name,
      description: '石材価格表を検索します。石材名・産地・国・色・仕入先で検索でき、単価・仕入価格・編集URLを返します。石材の価格・仕入先に関する質問には必ずこのツールを使ってください。',
      parameters: {
        $schema: 'http://json-schema.org/draft-07/schema#',
        type: 'object',
        properties: {
          query: {
            type: 'string',
            description: '検索する石材名・産地・国・色・仕入先名'
          }
        },
        required: ['query']
      },
      handler: async function ({ query }) {
        try {
          const items = loadStoneData();
          if (!items) {
            return 'エラー: 石材価格データが見つかりません。アプリの「🔄 AI同期」ボタンを押してデータを更新してください。';
          }

          const q = query.toLowerCase();
          const hits = items.filter(it =>
            String(it.Title    || '').toLowerCase().includes(q) ||
            String(it.made     || '').toLowerCase().includes(q) ||
            String(it.country  || '').toLowerCase().includes(q) ||
            String(it.color    || '').toLowerCase().includes(q) ||
            String(it.Supplier1|| '').toLowerCase().includes(q) ||
            String(it.Supplier2|| '').toLowerCase().includes(q) ||
            String(it.comment  || '').toLowerCase().includes(q)
          );

          if (!hits.length) {
            return '「' + query + '」に該当する石材が見つかりませんでした。別のキーワードでお試しください。';
          }

          const MAX = 10;
          let result = hits.length + '件見つかりました:\n\n';
          result += hits.slice(0, MAX).map(formatStone).join('\n\n');
          if (hits.length > MAX) result += '\n\n（他 ' + (hits.length - MAX) + '件）';
          return result;
        } catch (e) {
          return 'エラー: ' + e.message;
        }
      }
    });
  }
};
