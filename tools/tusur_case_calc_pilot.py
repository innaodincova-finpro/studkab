#!/usr/bin/env python3
"""Offline arithmetic pilot for fictional TUSUR variant 1, not a general quality pass.

Independent formulas below use the fixed educational inputs transcribed from
the TUSUR 2023 assignment. The tool compares labelled table cells in the exact
DOCX. It cannot prove the completeness of the assignment, source provenance,
prose, or the rendered layout and does not write application evidence.
"""

import argparse
import hashlib
import json
from decimal import Decimal as D, ROUND_HALF_UP
from math import ceil
from docx import Document

def r(x): return x.quantize(D('0.01'), rounding=ROUND_HALF_UP)
def n(s): return D(s.replace(' ', '').replace(',', '.'))
parser=argparse.ArgumentParser(description=__doc__)
parser.add_argument('docx',help='Fictional TUSUR variant 1 Word file')
args=parser.parse_args()
doc=Document(args.docx)
tables=[{row.cells[0].text: [c.text for c in row.cells[1:]] for row in t.rows[1:]} for t in doc.tables]
checks=[]
def check(table,label,expected,column=0):
 actual=n(tables[table][label][column]); expected=r(D(expected))
 checks.append((table,label,actual,expected,actual-expected))

qx,qy=D(42000),D(82000); tx,ty=D('.6'),D('.4'); repair=D('1.07');vat=D('1.2')
tpr=repair*(qx*tx+qy*ty);fe=D(249)*D('.88')*8*D('.92'); workers=ceil(tpr/fe)
workerpay=tpr*D(250)*D('1.10')/1000; managers=D(48)*12*5; pay=workerpay+managers
check(0,'Рабочие',workers); check(0,'Рабочие',workerpay,1);check(0,'Управленческий персонал',5);check(0,'Управленческий персонал',managers,1);check(0,'Итого',workers+5);check(0,'Итого',pay,1)
metal=qx*20+qy*15; powder=qx*D('.2')+qy*D('.1');power=qx*D('.09')+qy*D('.08')
metal_cost=metal*D(60)/vat/1000; powder_cost=powder*D(48)/vat/1000; power_cost=power*D(14)/vat/1000
for label,qty,unit,amount in [('Металл кг',metal,D(60)/vat,metal_cost),('Порошок кг',powder,D(48)/vat,powder_cost),('Энергия кВт',power,D(14)/vat,power_cost)]:
 check(1,label,qty); check(1,label,unit,1); check(1,label,amount,2)
mat=r(metal_cost+powder_cost+power_cost);check(1,'Итого',mat,2)
amort=[('Здание',D(40000),50),('Пресс',D(220),10),('Станки резки',D(360),8),('Напыление',D(1600),7),('Сушильная камера',D(1500),12),('Компьютеры',D(400),5),('Мебель',D(500),10),('Стеллажи',D(80),8)]
for label,asset,years in amort:
 check(2,label,asset);check(2,label,years,1);check(2,label,asset/years,2)
asset_sum=sum((asset for _,asset,_ in amort),D(0));deprec=r(sum((asset/years for _,asset,years in amort),D(0)))
check(2,'Итого',asset_sum);check(2,'Итого',deprec,2)
social=pay*D('.30');other=D(7880);cost=mat+pay+social+deprec+other
for label,amount in [('Материальные ресурсы',mat),('Оплата труда',pay),('Социальные отчисления',social),('Амортизация',deprec),('Прочие расходы',other),('Себестоимость',cost)]:check(3,label,amount)
unit_material=[(D(20)*D(60)/vat,D('.2')*D(48)/vat,D('.09')*D(14)/vat),(D(15)*D(60)/vat,D('.1')*D(48)/vat,D('.08')*D(14)/vat)]
base=[D(250)*tx*repair,D(250)*ty*repair]
direct=[]
for col,(m,p,e),wage in zip((0,1),unit_material,base):
 for label,value in [('Металл',m),('Порошок',p),('Электроэнергия',e),('Основная зарплата',wage),('Дополнительная зарплата',wage*D('.10')),('Социальные отчисления',wage*D('1.1')*D('.30'))]:check(4,label,value,col)
 direct.append(m+p+e+wage*D('1.1')*D('1.3'))
 check(4,'Прямые расходы',direct[-1],col)
allocated=sum((d*q for d,q in zip(direct,(qx,qy))),D(0))/1000
weights=[qx*tx/(qx*tx+qy*ty),qy*ty/(qx*tx+qy*ty)]
overhead=[(cost-allocated)*w*1000/q for w,q in zip(weights,(qx,qy))]
unit=[d+o for d,o in zip(direct,overhead)]
price=[unit[0]*D('1.30'),unit[1]*D('1.25')]
for col in (0,1):
 for label,value in [('Косвенные расходы',overhead[col]),('Себестоимость',unit[col]),('Цена без НДС',price[col]),('Отпускная цена с НДС',price[col]*vat)]:check(4,label,value,col)
revenue=r(sum((q*p for q,p in zip((qx,qy),price)),D(0))/1000)
excess_metal=D(3000000)-metal;excess_powder=D(30000)-powder
other_income=r(((excess_metal*D('62.5')+excess_powder*D(52))/1000-(excess_metal*D(60)+excess_powder*D(48))/1000)/vat)
sales_profit=revenue-cost; interest=D(1500)*D('.20');pretax=sales_profit+D(1800)-interest+other_income-D(1480);tax=r(pretax*D('.20'));net=pretax-tax;reserve=r(net*D('.15'))
for label,value in [('Выручка без НДС',revenue),('Себестоимость производства',cost),('Прибыль от продаж',sales_profit),('Проценты к получению',1800),('Проценты к уплате',interest),('Прочие доходы',other_income),('Штрафы и неустойки',1480),('Прибыль до налогообложения',pretax),('Налог на прибыль 20%',tax),('Чистая прибыль',net),('Резервный фонд, 15% чистой прибыли',reserve),('Фонд накопления, погашение долга',D(1500)/3),('Остаток до решения собственника',net-reserve-D(500))]:check(5,label,value)
program_cost=[d*q/1000+(cost-allocated)*w for d,q,w in zip(direct,(qx,qy),weights)]
material_x=(unit_material[0][0]+unit_material[0][1])*qx/1000
material_y=(unit_material[1][0]+unit_material[1][1])*qy/1000
inv_metal=metal_cost*D(36)/360;inv_powder=powder_cost*D(36)/360
work=[c*cycle*(1+material/c)/2/360 for c,cycle,material in zip(program_cost,(D('1.5'),D(1)),(material_x,material_y))]
finished=[c*15/360 for c in program_cost]
norm=r(inv_metal)+r(inv_powder)+r(work[0])+r(work[1])+r(finished[0])+r(finished[1])
ar=r(revenue*25/360);working=norm+ar+D(1800)
for label,value in [('Запас металла',inv_metal),('Запас порошка',inv_powder),('Материалы всего',r(inv_metal)+r(inv_powder)),('Незавершённое производство X',work[0]),('Незавершённое производство Y',work[1]),('Незавершённое производство всего',r(work[0])+r(work[1])),('Готовая продукция X',finished[0]),('Готовая продукция Y',finished[1]),('Готовая продукция всего',r(finished[0])+r(finished[1])),('Нормируемые средства',norm),('Дебиторская задолженность',ar),('Денежные средства по условию',1800),('Среднегодовой остаток',working)]:check(6,label,value)
turnover=revenue/working
metrics=[('Выручка тыс. руб.',revenue),('Себестоимость тыс. руб.',cost),('Прибыль от продаж тыс. руб.',sales_profit),('Прибыль до налога тыс. руб.',pretax),('Чистая прибыль тыс. руб.',net),('Производительность рабочего тыс. руб./чел.',revenue/workers),('Производительность работающего тыс. руб./чел.',revenue/(workers+5)),('Выработка в день тыс. руб.',revenue/249),('Выработка в час тыс. руб.',revenue/(249*8)),('Фондоотдача руб./руб.',revenue/asset_sum),('Фондоёмкость руб./руб.',asset_sum/revenue),('Фондовооружённость тыс. руб./чел.',asset_sum/(workers+5)),('Оборотов в год',turnover),('Длительность оборота дней',360/turnover),('Коэффициент загрузки руб./руб.',1/turnover),('Затраты на рубль продаж',cost/revenue),('Рентабельность продукции %',sales_profit/cost*100),('Рентабельность продаж %',net/revenue*100),('Общая рентабельность производства %',pretax/(asset_sum+norm)*100),('Расчётная рентабельность производства %',net/(asset_sum+norm)*100)]
for label,value in metrics: check(7,label,value)
errors=[c for c in checks if abs(c[-1])>D('.01')]
print(json.dumps({
 'scope':'fictional TUSUR variant 1; fixed source inputs; labelled Word table cells only',
 'word_sha256':hashlib.sha256(open(args.docx,'rb').read()).hexdigest(),
 'checked_cells':len(checks),
 'mismatches':[{'table':t+1,'label':label,'word':str(actual),'calculated':str(expected),'difference':str(delta)}
               for t,label,actual,expected,delta in errors],
 'revenue_from_printed_prices':str(r((qx*n(tables[4]['Цена без НДС'][0])+qy*n(tables[4]['Цена без НДС'][1]))/1000)),
 'revenue_from_unrounded_prices':str(revenue),
},ensure_ascii=False))
if errors:raise SystemExit(1)
