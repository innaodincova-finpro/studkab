// Synthetic XLSX fixture for browser acceptance; contains no student data.
const {deflateRawSync}=require('node:zlib');
function zip(files,{compressed=false}={}){
 const crc=data=>{let c=-1;for(const b of data){c^=b;for(let i=0;i<8;i++)c=(c>>>1)^((c&1)?0xedb88320:0);}return(c^-1)>>>0;};
 const local=[],central=[];let offset=0;
 for(const [name,xml] of Object.entries(files)){const n=Buffer.from(name),data=Buffer.from(xml),packed=compressed?deflateRawSync(data):data,header=Buffer.alloc(30);header.writeUInt32LE(0x04034b50);header.writeUInt16LE(compressed?8:0,8);header.writeUInt32LE(crc(data),14);header.writeUInt32LE(packed.length,18);header.writeUInt32LE(data.length,22);header.writeUInt16LE(n.length,26);
  local.push(header,n,packed);const entry=Buffer.alloc(46);entry.writeUInt32LE(0x02014b50);entry.writeUInt16LE(compressed?8:0,10);entry.writeUInt32LE(crc(data),16);entry.writeUInt32LE(packed.length,20);entry.writeUInt32LE(data.length,24);entry.writeUInt16LE(n.length,28);entry.writeUInt32LE(offset,42);central.push(entry,n);offset+=header.length+n.length+packed.length;
 }const directory=Buffer.concat(central),end=Buffer.alloc(22);end.writeUInt32LE(0x06054b50);end.writeUInt16LE(Object.keys(files).length,8);end.writeUInt16LE(Object.keys(files).length,10);end.writeUInt32LE(directory.length,12);end.writeUInt32LE(offset,16);return new Uint8Array(Buffer.concat([...local,directory,end]));
}
const xmlFiles={
 '[Content_Types].xml':'<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/></Types>',
 'xl/workbook.xml':'<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets><sheet name="Занятия" sheetId="1" r:id="r1"/></sheets></workbook>',
 'xl/_rels/workbook.xml.rels':'<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="r1" Target="worksheets/sheet1.xml"/></Relationships>',
 'xl/worksheets/sheet1.xml':'<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetData><row r="1"><c r="A1" t="inlineStr"><is><t>№</t></is></c><c r="B1" t="inlineStr"><is><t>Дата</t></is></c><c r="C1" t="inlineStr"><is><t>Начало</t></is></c><c r="D1" t="inlineStr"><is><t>Конец</t></is></c><c r="E1" t="inlineStr"><is><t>Дисциплина</t></is></c><c r="F1" t="inlineStr"><is><t>Вид занятия</t></is></c></row><row r="2"><c r="A2"><v>1</v></c><c r="B2"><v>46303</v></c><c r="C2"><v>0.5</v></c><c r="D2" t="inlineStr"><is><t>13:20</t></is></c><c r="E2" t="inlineStr"><is><t>Предмет проверки</t></is></c><c r="F2" t="inlineStr"><is><t>Лекция</t></is></c></row></sheetData></worksheet>'};

module.exports=()=>Buffer.from(zip(xmlFiles,{compressed:true}));
