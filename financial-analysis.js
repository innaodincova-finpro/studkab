/* Deterministic FIN-UAT profile arithmetic. No network, secrets or reference answers. */
(function(root){
'use strict';
const definitions={
 balance:{noncurrent:'Внеоборотные активы',inventory:'Запасы',receivables:'Дебиторская задолженность покупателей',cash:'Денежные средства',current:'Оборотные активы',assets:'Активы всего',equity:'Собственный капитал',longLoan:'Долгосрочные кредиты',shortLoan:'Краткосрочные кредиты',payables:'Кредиторская задолженность поставщикам',shortLiabilities:'Краткосрочные обязательства',liabilities:'Пассивы всего'},
 income:{revenue:'Выручка',cost:'Себестоимость продаж',gross:'Валовая прибыль',selling:'Коммерческие расходы',admin:'Управленческие расходы',operatingProfit:'Прибыль от продаж',interest:'Проценты к уплате',pretax:'Прибыль до налогообложения',tax:'Расход по налогу на прибыль',net:'Чистая прибыль'},
 cashflow:{depreciation:'Амортизация',capex:'Капитальные вложения',borrowing:'Чистое привлечение кредитов',dividends:'Выплаченные дивиденды',operating:'Операционный денежный поток',investing:'Инвестиционный денежный поток',financing:'Финансовый денежный поток',change:'Изменение денежных средств'}
};
const years=[2023,2024,2025];
function money(v){
 const s=String(v).trim().replace(/\s/g,'').replace(',','.');
 if(!/^-?\d+(?:\.\d{1,2})?$/.test(s)||Math.abs(Number(s))>1e12)throw Error('Пустое или недопустимое денежное значение');
 return Number(s);
}
function parse(text){
 const data={balance:{},income:{},cashflow:{}},lookup=new Map();
 for(const [block,fields] of Object.entries(definitions))for(const [key,label] of Object.entries(fields))lookup.set(label,{block,key});
 let header=[];
 for(const line of String(text||'').split(/\r?\n/)){
  const cells=line.trim().replace(/^\|/,'').replace(/\|$/,'').split('|').map(s=>s.trim());
  if(cells[0]==='Показатель'){header=cells.slice(1).map(Number);continue;}
  const match=lookup.get(cells[0]);if(!match)continue;
  const needed=match.block==='balance'?[2022,...years]:years;
  if(header.length!==needed.length||header.some((n,i)=>n!==needed[i])||cells.length!==needed.length+1)throw Error('Неверные годы или столбцы: '+cells[0]);
  if(data[match.block][match.key])throw Error('Повторная строка: '+cells[0]);
  data[match.block][match.key]=cells.slice(1).map(money);
 }
 return data;
}
const div=(a,b)=>b>0?a/b:null;
function calculate(data){
 // Validate the complete shape, including zero values, before any formula.
 for(const [block,fields] of Object.entries(definitions))for(const [key,label] of Object.entries(fields)){
  const values=data?.[block]?.[key],count=block==='balance'?4:3;
  if(!Array.isArray(values)||values.length!==count||values.some(v=>typeof v!=='number'||!Number.isFinite(v)||Math.abs(v)>1e12||money(v)!==v))throw Error('Нет корректных данных: '+label);
 }
 const b=data.balance,p=data.income,c=data.cashflow;
 const cents=v=>Math.round(v*100);
 function equal(left,right,label){if(cents(left)!==right.reduce((n,v)=>n+cents(v),0))throw Error('Не сходится '+label);}
 for(let i=0;i<4;i++){
  for(const key of ['noncurrent','inventory','receivables','cash','current','assets','longLoan','shortLoan','payables','shortLiabilities'])if(b[key][i]<0)throw Error('Отрицательное значение: '+definitions.balance[key]);
  equal(b.current[i],[b.inventory[i],b.receivables[i],b.cash[i]],'состав оборотных активов '+(2022+i));
  equal(b.assets[i],[b.current[i],b.noncurrent[i]],'состав активов '+(2022+i));
  equal(b.shortLiabilities[i],[b.shortLoan[i],b.payables[i]],'состав краткосрочных обязательств '+(2022+i));
  equal(b.assets[i],[b.equity[i],b.longLoan[i],b.shortLiabilities[i]],'баланс '+(2022+i));
  equal(b.liabilities[i],[b.assets[i]],'итог пассивов '+(2022+i));
 }
 for(let i=0;i<3;i++){
  for(const key of ['revenue','cost','selling','admin','interest','tax'])if(p[key][i]<0)throw Error('Отрицательный доход/расход: '+definitions.income[key]);
  for(const key of ['capex','depreciation','dividends'])if(c[key][i]<0)throw Error('Отрицательное значение: '+definitions.cashflow[key]);
  equal(p.gross[i],[p.revenue[i],-p.cost[i]],'валовая прибыль '+years[i]);
  equal(p.operatingProfit[i],[p.gross[i],-p.selling[i],-p.admin[i]],'прибыль от продаж '+years[i]);
  equal(p.pretax[i],[p.operatingProfit[i],-p.interest[i]],'прибыль до налога '+years[i]);
  equal(p.net[i],[p.pretax[i],-p.tax[i]],'чистая прибыль '+years[i]);
  equal(c.operating[i],[p.net[i],c.depreciation[i],b.inventory[i],-b.inventory[i+1],b.receivables[i],-b.receivables[i+1],b.payables[i+1],-b.payables[i]],'косвенный операционный поток '+years[i]);
  equal(c.investing[i],[-c.capex[i]],'инвестиционный поток '+years[i]);
  equal(c.financing[i],[c.borrowing[i],-c.dividends[i]],'финансовый поток '+years[i]);
  equal(c.change[i],[c.operating[i],c.investing[i],c.financing[i]],'денежный поток '+years[i]);
  equal(b.cash[i+1],[b.cash[i],c.change[i]],'остаток денег '+years[i]);
  equal(b.noncurrent[i+1],[b.noncurrent[i],c.capex[i],-c.depreciation[i]],'внеоборотные активы '+years[i]);
  equal(b.equity[i+1],[b.equity[i],p.net[i],-c.dividends[i]],'капитал '+years[i]);
  equal(b.longLoan[i+1]+b.shortLoan[i+1],[b.longLoan[i],b.shortLoan[i],c.borrowing[i]],'движение кредитов '+years[i]);
 }
 const metrics=[];
 const end=(key,i)=>b[key][i+1],avg=(key,i)=>(b[key][i]+b[key][i+1])/2;
 function ratio(name,unit,formula,args,scale=1){metrics.push({name,unit,formula,values:years.map((_,i)=>{const [n,d]=args(i),v=div(n,d);return v===null?null:v*scale;}),substitution:(()=>{const [n,d]=args(2);return n+' / '+d+(scale===1?'':' × '+scale);})()});}
 function difference(name,unit,formula,args){metrics.push({name,unit,formula,values:years.map((_,i)=>{const [a,b]=args(i);return a-b;}),substitution:args(2).join(' − ')});}
 ratio('Текущая ликвидность','коэф.','Оборотные активы / краткосрочные обязательства',i=>[end('current',i),end('shortLiabilities',i)]);
 ratio('Быстрая ликвидность','коэф.','(Деньги + дебиторская задолженность) / краткосрочные обязательства',i=>[end('cash',i)+end('receivables',i),end('shortLiabilities',i)]);
 ratio('Абсолютная ликвидность','коэф.','Деньги / краткосрочные обязательства',i=>[end('cash',i),end('shortLiabilities',i)]);
 difference('Чистый оборотный капитал, тыс. руб.','тыс. руб.','Оборотные активы − краткосрочные обязательства',i=>[end('current',i),end('shortLiabilities',i)]);
 ratio('Автономия, %','%','Капитал / активы × 100',i=>[end('equity',i),end('assets',i)],100);
 ratio('Все обязательства / капитал','коэф.','(Долгосрочные кредиты + краткосрочные обязательства) / капитал',i=>[end('longLoan',i)+end('shortLiabilities',i),end('equity',i)]);
 ratio('Процентные кредиты / капитал','коэф.','(Долгосрочные + краткосрочные кредиты) / капитал',i=>[end('longLoan',i)+end('shortLoan',i),end('equity',i)]);
 ratio('Покрытие процентов','коэф.','(Прибыль до налога + проценты) / проценты',i=>[p.pretax[i]+p.interest[i],p.interest[i]]);
 ratio('Оборачиваемость активов','обороты','Выручка / средние активы',i=>[p.revenue[i],avg('assets',i)]);
 ratio('Оборачиваемость запасов','обороты','Себестоимость / средние запасы',i=>[p.cost[i],avg('inventory',i)]);
 ratio('Хранение запасов, дни','дни','Средние запасы × 365 / себестоимость',i=>[avg('inventory',i)*365,p.cost[i]]);
 ratio('Оборачиваемость дебиторской задолженности','обороты','Продажи с отсрочкой / средняя задолженность',i=>[p.revenue[i],avg('receivables',i)]);
 ratio('Инкассация, дни','дни','Средняя задолженность × 365 / продажи с отсрочкой',i=>[avg('receivables',i)*365,p.revenue[i]]);
 ratio('Валовая рентабельность, %','%','Валовая прибыль / выручка × 100',i=>[p.gross[i],p.revenue[i]],100);
 ratio('Рентабельность по прибыли от продаж, %','%','Прибыль от продаж / выручка × 100',i=>[p.operatingProfit[i],p.revenue[i]],100);
 ratio('Чистая рентабельность, %','%','Чистая прибыль / выручка × 100',i=>[p.net[i],p.revenue[i]],100);
 ratio('ROA, %','%','Чистая прибыль / средние активы × 100',i=>[p.net[i],avg('assets',i)],100);
 ratio('ROE, %','%','Чистая прибыль / средний капитал × 100',i=>[p.net[i],avg('equity',i)],100);
 ratio('Операционный поток / чистая прибыль','коэф.','Операционный поток / чистая прибыль',i=>[c.operating[i],p.net[i]]);
 difference('Свободный поток, тыс. руб.','тыс. руб.','Операционный поток − капитальные вложения',i=>[c.operating[i],c.capex[i]]);
 const bridge=['revenue','cost','selling','admin','interest','tax'].map(key=>({name:definitions.income[key],value:(p[key][2]-p[key][0])*(key==='revenue'?1:-1)}));
 equal(p.net[2]-p.net[0],bridge.map(x=>x.value),'факторное разложение прибыли');
 const scenarios=[5,10,15].map(days=>{
  const release=p.revenue[2]/365*days;
  if(p.revenue[2]<=0||release>Math.min(end('receivables',2),end('shortLoan',2))||days>metrics.find(m=>m.name==='Инкассация, дни').values[2])return {days,error:'Недостаточно задолженности/кредита или периода для сценария'};
  return {days,release,interestSaving:release*0.12,assets:end('assets',2)-release,current:end('current',2)-release,shortLiabilities:end('shortLiabilities',2)-release,cash:end('cash',2),equity:end('equity',2),workingCapital:end('current',2)-end('shortLiabilities',2),currentRatio:div(end('current',2)-release,end('shortLiabilities',2)-release),autonomy:div(end('equity',2)*100,end('assets',2)-release)};
 });
 const dynamics=[];
 for(const block of ['balance','income'])for(const [key,label] of Object.entries(definitions[block])){
  const values=block==='balance'?data[block][key].slice(1):data[block][key];
  dynamics.push({name:label,block,changes:[[0,1],[1,2],[0,2]].map(([a,z])=>({absolute:values[z]-values[a],growth:values[a]===0?null:(values[z]/values[a]-1)*100})),shares:values.map((v,i)=>div(v*100,block==='balance'?end('assets',i):p.revenue[i]))});
 }
 return {years:years.slice(),metrics,scenarios,bridge,dynamics};
}
function format(v){return v===null?'не рассчитывается':v.toLocaleString('ru-RU',{minimumFractionDigits:2,maximumFractionDigits:2,useGrouping:false});}
function text(result){
 const table=(head,rows)=>'| '+head.join(' | ')+' |\n| '+head.map(()=>'---').join(' | ')+' |\n'+rows.map(row=>'| '+row.join(' | ')+' |').join('\n');
 return 'РАСЧЁТЫ ПО УЧЕБНОМУ ПРОФИЛЮ FIN-UAT-01\nСуммы в тыс. руб. Для средних остатков использован 2022 год; 365 дней во всех годах. Все продажи считаются продажами с отсрочкой. Это условия профиля, не универсальные правила.\n\n'+table(['Показатель','Единицы',...result.years],result.metrics.map(m=>[m.name,m.unit,...m.values.map(format)]))+'\n\nФормулы и подстановка за 2025 год (промежуточные величины не округлены):\n'+result.metrics.map(m=>m.name+': '+m.formula+'; '+m.substitution+' = '+format(m.values[2])+'.').join('\n')+'\n\nФакторное разложение изменения чистой прибыли 2025/2023:\n'+table(['Фактор','Вклад, тыс. руб.'],result.bridge.map(r=>[r.name,format(r.value)]))+'\n\nСценарий: сокращение инкассации и погашение краткосрочного кредита. Перенос высвобождения на баланс — отдельное допущение; ставка12%, экономия за полный будущий год до налогов и затрат. Высвобождение не является прибылью.\n'+table(['Дни','Высвобождение','Экономия процентов','Ликвидность','Автономия, %'],result.scenarios.map(s=>s.error?[s.days,s.error,'—','—','—']:[s.days,...[s.release,s.interestSaving,s.currentRatio,s.autonomy].map(format)]));
}
function details(result){
 const table=(head,rows)=>'| '+head.join(' | ')+' |\n| '+head.map(()=>'---').join(' | ')+' |\n'+rows.map(row=>'| '+row.join(' | ')+' |').join('\n');
 return '\n\nГоризонтальный анализ (изменения сумм в тыс. руб.; прирост в %):\n'+table(['Статья','Δ24/23','%24/23','Δ25/24','%25/24','Δ25/23','%25/23'],result.dynamics.map(r=>[r.name,...r.changes.flatMap(v=>[format(v.absolute),format(v.growth)])]))+
 '\n\nВертикальный анализ (баланс к активам; результаты к выручке), %:\n'+table(['Статья',...result.years],result.dynamics.map(r=>[r.name,...r.shares.map(format)]))+
 '\n\nСценарный баланс, тыс. руб. (будущая экономия процентов здесь не добавлена):\n'+table(['Дни','Активы','Оборотные активы','Краткосрочные обязательства','Деньги','Капитал','ЧОК'],result.scenarios.map(s=>s.error?[s.days,s.error,'—','—','—','—','—']:[s.days,...[s.assets,s.current,s.shortLiabilities,s.cash,s.equity,s.workingCapital].map(format)]));
}
function fromMaterials(value){const report=calculate(parse(value));return {...report,text:text(report)+details(report)};}
const api={definitions,parse,calculate,fromMaterials,format,text};
if(typeof module==='object'&&module.exports)module.exports=api;else root.FinancialAnalysis=api;
})(typeof window==='object'?window:globalThis);
