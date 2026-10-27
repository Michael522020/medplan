#!/usr/bin/env bash
# Phase 4 QA：多轮独立试验，评估「p99 差异 < 20%」指标的**可复现性**。
#
# 单次 p99 采样在 1-5ms 量级上噪声主导，必须多轮独立试验才能下结论。
# 输出：每轮 p99/p50 差异 + 汇总（max/中位/最小、PASS 轮次占比、可复现性判定）。
set -uo pipefail
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
TRIALS="${1:-10}"
SAMPLES="${2:-1000}"
export PATH="C:/Users/94765/.workbuddy/binaries/node/versions/22.22.2-6:$PATH"
export DATABASE_URL="${DATABASE_URL:-postgresql://postgres:medplan_ci_only@localhost:15433/medplan_qa}"

OUTDIR="$ROOT/.qa-timing-trials"
# 先清空 —— 绝不复用上一轮的 JSON。
# 教训：本轮曾因与其它任务并发、probe 失败而静默复用了陈旧结果，
# 导致「21 秒跑完 10 轮 × 1000 采样」这种不可能的数据被当成实测值。
rm -rf "$OUTDIR"
mkdir -p "$OUTDIR"

for i in $(seq 1 "$TRIALS"); do
  export QA_JSON_OUT="$OUTDIR/trial-$i.json"
  node "$ROOT/scripts/qa_timing_probe.mjs" "$SAMPLES" > "$OUTDIR/trial-$i.log" 2>&1
  if [ ! -s "$OUTDIR/trial-$i.json" ]; then
    echo "  trial $i: probe 失败，本轮结果无效" >&2
    tail -20 "$OUTDIR/trial-$i.log" >&2
    exit 1
  fi
done

node -e "
const fs=require('fs');
const dir=process.argv[1];
const n=Number(process.argv[2]);
const rows=[];
for(let i=1;i<=n;i++){
  const p=dir+'/trial-'+i+'.json';
  if(!fs.existsSync(p)){ console.log('  trial '+i+': MISSING'); continue; }
  const r=JSON.parse(fs.readFileSync(p,'utf8'));
  rows.push(r);
  console.log('  trial '+String(i).padStart(2)+': p99='+String(r.p99DiffPercent.toFixed(2)).padStart(8)+'%  p50='+String(r.p50DiffPercent.toFixed(2)).padStart(7)+'%  overlap='+(r.overlapRatio*100).toFixed(2).padStart(6)+'%  B_p99='+r.total.B.p99.toFixed(3)+'  C_p99='+r.total.C.p99.toFixed(3)+'  -> '+r.verdict);
}
const abs=a=>a.map(Math.abs).sort((x,y)=>x-y);
const p99=abs(rows.map(r=>r.p99DiffPercent));
const p50=abs(rows.map(r=>r.p50DiffPercent));
const ov=rows.map(r=>r.overlapRatio*100).sort((x,y)=>x-y);
const pass=rows.filter(r=>r.verdict==='PASS').length;
const med=a=>a[Math.floor(a.length/2)];
console.log('');
console.log('=== 汇总（'+rows.length+' 轮 x '+rows[0].samples+' 采样，warmup '+rows[0].warmup+'）===');
console.log('  p99 差异绝对值: min='+p99[0].toFixed(2)+'%  中位='+med(p99).toFixed(2)+'%  max='+p99[p99.length-1].toFixed(2)+'%');
console.log('  p50 差异绝对值: min='+p50[0].toFixed(2)+'%  中位='+med(p50).toFixed(2)+'%  max='+p50[p50.length-1].toFixed(2)+'%');
console.log('  分布重叠度    : min='+ov[0].toFixed(2)+'%  中位='+med(ov).toFixed(2)+'%  max='+ov[ov.length-1].toFixed(2)+'%');
console.log('  PASS 轮次     : '+pass+'/'+rows.length);
const repro = (pass===rows.length) ? '每轮均通过（稳定达标）' : (pass===0 ? '每轮均不通过（稳定不达标）' : '结果在轮次间翻转 -> 指标不可复现');
console.log('  指标可复现性  : '+repro);
" "$OUTDIR" "$TRIALS"
