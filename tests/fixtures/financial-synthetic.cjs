// Independent synthetic arithmetic fixture; no Library source data.
const f=require('../../financial-analysis.js');
function fixture(){
 const four=n=>[n,n,n,n],three=n=>[n,n,n];
 return {balance:{noncurrent:four(50),inventory:four(20),receivables:four(20),cash:four(10),current:four(50),assets:four(100),equity:four(40),longLoan:four(20),shortLoan:four(20),payables:four(20),shortLiabilities:four(40),liabilities:four(100)},income:{revenue:three(100),cost:three(60),gross:three(40),selling:three(20),admin:three(5),operatingProfit:three(15),interest:three(5),pretax:three(10),tax:three(0),net:three(10)},cashflow:{depreciation:three(5),capex:three(5),borrowing:three(0),dividends:three(10),operating:three(15),investing:three(-5),financing:three(-10),change:three(0)}};
}
function material(data){return Object.entries(f.definitions).map(([block,keys])=>'Показатель | '+(block==='balance'?'2022 | ':'')+'2023 | 2024 | 2025\n'+Object.entries(keys).map(([key,name])=>name+' | '+data[block][key].join(' | ')).join('\n')).join('\n\n');}
module.exports={fixture,material};
