// Private input/reference paths are arguments; never copy their contents to the repo.
const fs=require('node:fs'),assert=require('node:assert/strict'),f=require('../../financial-analysis.js');
const [input,metricsPath,scenarioPath]=process.argv.slice(2);
if(!input||!metricsPath||!scenarioPath)throw Error('Usage: node verify-financial-reference.cjs INPUT METRICS SCENARIO');
const report=f.fromMaterials(fs.readFileSync(input,'utf8')),reference=JSON.parse(fs.readFileSync(metricsPath,'utf8'));
assert.deepEqual(reference.years,report.years);let metrics=0,scenarios=0;
for(const m of report.metrics)for(let i=0;i<3;i++){
 const v=Number(reference.metrics[i][m.name]);assert(Number.isFinite(v)&&Math.abs(m.values[i]-v)<1e-9,m.name+' '+report.years[i]);metrics++;
}
const expectedRows=fs.readFileSync(scenarioPath,'utf8').split('\n').filter(l=>/^\d+\s*\|/.test(l)).map(l=>l.split('|').map(Number));
assert.equal(expectedRows.length,3);
for(const row of expectedRows){const s=report.scenarios.find(s=>s.days===row[0]);assert(s&&!s.error);const values=[s.days,s.release,s.interestSaving,s.assets,s.shortLiabilities,s.currentRatio,s.autonomy];values.forEach((v,i)=>{assert(Math.abs(v-row[i])<=0.005, 'scenario '+row[0]+' column '+i);scenarios++;});}
console.log(JSON.stringify({metrics_checked:metrics,scenario_fields_checked:scenarios,status:'PASS',scope:'arithmetic only; not document acceptance'}));
