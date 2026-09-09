(function(global){
"use strict";
var CRC_TABLE = (function(){
  var c, t = [];
  for (var n=0; n<256; n++){
    c = n;
    for (var k=0; k<8; k++) c = (c & 1) ? (0xEDB88320 ^ (c >>> 1)) : (c >>> 1);
    t[n] = c >>> 0;
  }
  return t;
})();
function crc32(bytes){
  var c = 0xFFFFFFFF;
  for (var i=0; i<bytes.length; i++) c = CRC_TABLE[(c ^ bytes[i]) & 0xFF] ^ (c >>> 8);
  return (c ^ 0xFFFFFFFF) >>> 0;
}
function makeZip(files){
  var enc = new TextEncoder(), parts = [], central = [], offset = 0;
  files.forEach(function(f){
    var name = enc.encode(f.name), data = enc.encode(f.text);
    var crc = crc32(data), len = data.length;
    var lh = new Uint8Array(30 + name.length), dv = new DataView(lh.buffer);
    dv.setUint32(0, 0x04034b50, true);
    dv.setUint16(4, 20, true); dv.setUint16(6, 0x0800, true);
    dv.setUint16(8, 0, true); dv.setUint16(10, 0, true); dv.setUint16(12, 0, true);
    dv.setUint32(14, crc, true); dv.setUint32(18, len, true); dv.setUint32(22, len, true);
    dv.setUint16(26, name.length, true); dv.setUint16(28, 0, true);
    lh.set(name, 30);
    parts.push(lh, data);
    var ch = new Uint8Array(46 + name.length), cv = new DataView(ch.buffer);
    cv.setUint32(0, 0x02014b50, true);
    cv.setUint16(4, 20, true); cv.setUint16(6, 20, true); cv.setUint16(8, 0x0800, true);
    cv.setUint16(10, 0, true); cv.setUint16(12, 0, true); cv.setUint16(14, 0, true);
    cv.setUint32(16, crc, true); cv.setUint32(20, len, true); cv.setUint32(24, len, true);
    cv.setUint16(28, name.length, true); cv.setUint16(30, 0, true); cv.setUint16(32, 0, true);
    cv.setUint16(34, 0, true); cv.setUint16(36, 0, true); cv.setUint32(38, 0, true);
    cv.setUint32(42, offset, true);
    ch.set(name, 46);
    central.push(ch);
    offset += lh.length + len;
  });
  var cdSize = central.reduce(function(a,b){ return a + b.length }, 0);
  var end = new Uint8Array(22), ev = new DataView(end.buffer);
  ev.setUint32(0, 0x06054b50, true);
  ev.setUint16(4, 0, true); ev.setUint16(6, 0, true);
  ev.setUint16(8, files.length, true); ev.setUint16(10, files.length, true);
  ev.setUint32(12, cdSize, true); ev.setUint32(16, offset, true); ev.setUint16(20, 0, true);
  return new Blob(parts.concat(central).concat([end]),
    { type:"application/vnd.openxmlformats-officedocument.wordprocessingml.document" });
}

function xesc(s){
  return String(s==null?"":s)
    .replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;")
    .replace(/"/g,"&quot;").replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g,"");
}
function mm2tw(mm){ return Math.round(mm * 56.6929); }
function cm2tw(cm){ return Math.round(cm * 566.929); }

function buildDocx(w, chapters){
  var f = w.format;
  var line = Math.round((f.spacing || 1.5) * 240);
  var half = Math.round((f.size || 14) * 2);
  var ind = cm2tw(f.indent || 0);
  var author = (w.student || "").trim();
  var group = (w.group || "").trim();
  var year = f.year || String(new Date().getFullYear());

  function P(text, o){
    o = o || {};
    var pPr = '<w:pPr>'+
      (o.style ? '<w:pStyle w:val="'+o.style+'"/>' : '')+
      '<w:spacing w:before="'+(o.before||0)+'" w:after="'+(o.after||0)+'" w:line="'+line+'" w:lineRule="auto"/>'+
      '<w:ind w:firstLine="'+(o.ind||0)+'"/>'+
      '<w:jc w:val="'+(o.jc || "both")+'"/>'+
      '</w:pPr>';
    var rPr = '<w:rPr>'+(o.b?'<w:b/>':'')+'<w:sz w:val="'+half+'"/><w:szCs w:val="'+half+'"/></w:rPr>';
    var run = text === "" ? "" : '<w:r>'+rPr+'<w:t xml:space="preserve">'+xesc(text)+'</w:t></w:r>';
    return '<w:p>'+pPr+run+'</w:p>';
  }
  function pageBreak(){ return '<w:p><w:r><w:br w:type="page"/></w:r></w:p>'; }

  /* Титульный лист */
  var body = "";
  if (f.org) body += P(f.org, { jc:"center" });
  if (f.univ) body += P(f.univ, { jc:"center", b:true });
  if (f.faculty) body += P(f.faculty, { jc:"center" });
  if (f.kafedra) body += P(f.kafedra, { jc:"center" });
  if (f.program) body += P("Направление подготовки: " + f.program, { jc:"center" });
  body += P("", {}) + P("", {}) + P("", {}) + P("", {});
  body += P(String(f.workType || "Курсовая работа").toUpperCase(), { jc:"center", b:true, after:120 });
  if (f.discipline) body += P("по дисциплине «" + f.discipline + "»", { jc:"center" });
  body += P("на тему: «" + (w.topic || "") + "»", { jc:"center", b:true, before:120 });
  body += P("", {}) + P("", {}) + P("", {});
  if (author) body += P("Выполнил(а): " + author, { jc:"right" });
  var who = [];
  if (f.course) who.push("студент " + f.course + " курса");
  if (group) who.push("группа " + group);
  if (f.form) who.push(f.form + " форма обучения");
  if (who.length) body += P(who.join(", "), { jc:"right" });
  if (f.supervisor) body += P("Руководитель: " + f.supervisor, { jc:"right", before:120 });
  body += P("", {}) + P("", {}) + P("", {}) + P("", {});
  body += P(((f.city ? f.city + ", " : "") + year), { jc:"center" });
  body += pageBreak();

  /* Содержание */
  if (f.toc){
    body += P("СОДЕРЖАНИЕ", { jc:"center", b:true, after:240 });
    body += '<w:p><w:pPr><w:spacing w:line="'+line+'" w:lineRule="auto"/></w:pPr>'+
      '<w:r><w:fldChar w:fldCharType="begin" w:dirty="true"/></w:r>'+
      '<w:r><w:instrText xml:space="preserve"> TOC \\o "1-1" \\h \\z \\u </w:instrText></w:r>'+
      '<w:r><w:fldChar w:fldCharType="separate"/></w:r>'+
      '<w:r><w:rPr><w:sz w:val="'+half+'"/></w:rPr>'+
      '<w:t xml:space="preserve">'+chapters.filter(function(c){return ((w.structure||{})[c.id]||{}).text;}).map(function(c){return xesc(c.name);}).join('</w:t><w:br/><w:t xml:space="preserve">')+'</w:t></w:r>'+
      '<w:r><w:fldChar w:fldCharType="end"/></w:r></w:p>';
    body += pageBreak();
  }

  /* Разделы */
  var written = 0;
  chapters.forEach(function(c, i){
    var ch = (w.structure || {})[c.id] || { text:"" };
    var text = (ch.text || "").trim();
    if (!text) return;
    if (written > 0) body += pageBreak();
    written++;
    body += P(c.name.toUpperCase(), { style:"Heading1", jc:"center", b:true, after:240 });
    var lines=text.split(/\n+/),row=0;
    // The section title is already emitted above. Remove only an exact leading
    // duplicate, preserving subsection headings and the author's body text.
    var normalizedTitle=function(v){return String(v).trim().replace(/^#{1,6}\s+/, '').replace(/^\*\*(.*)\*\*$/, '$1').trim().toLowerCase();};
    if(lines.length && normalizedTitle(lines[0])===normalizedTitle(c.name))row=1;
    while(row<lines.length){
      var par=lines[row].trim();
      if(/^\|.*\|$/.test(par)){
        var grid=[];
        while(row<lines.length && /^\s*\|.*\|\s*$/.test(lines[row])){
          var cells=lines[row++].trim().slice(1,-1).split('|').map(function(v){return v.trim();});
          if(!cells.every(function(v){return /^:?-+:?$/.test(v);}))grid.push(cells);
        }
        var cols=Math.max.apply(null,grid.map(function(r){return r.length;}));
        if(cols>8)throw Error('В таблице слишком много столбцов для страницы');
        var tableWidth=11906-mm2tw(f.mLeft)-mm2tw(f.mRight),cw=Math.floor(tableWidth/cols);
        body+='<w:tbl><w:tblPr><w:tblW w:w="'+tableWidth+'" w:type="dxa"/><w:tblBorders>'+['top','left','bottom','right','insideH','insideV'].map(function(k){return '<w:'+k+' w:val="single" w:sz="4" w:color="D9D9D9"/>';}).join('')+'</w:tblBorders><w:tblCellMar><w:top w:w="80" w:type="dxa"/><w:bottom w:w="80" w:type="dxa"/><w:left w:w="80" w:type="dxa"/><w:right w:w="80" w:type="dxa"/></w:tblCellMar></w:tblPr><w:tblGrid>'+Array(cols).fill('<w:gridCol w:w="'+cw+'"/>').join('')+'</w:tblGrid>';
        grid.forEach(function(cells,ri){body+='<w:tr><w:trPr><w:cantSplit/>'+(ri===0?'<w:tblHeader/>':'')+'</w:trPr>';for(var ci=0;ci<cols;ci++)body+='<w:tc><w:tcPr><w:tcW w:w="'+cw+'" w:type="dxa"/>'+(ri===0?'<w:shd w:fill="E8EEF4"/>':'')+'</w:tcPr>'+P(cells[ci]||'',{jc:ci?'center':'left',b:ri===0})+'</w:tc>';body+='</w:tr>';});body+='</w:tbl>'+P('');
      }else{
        if(par)body+=P(par,{ind:/^\d+\.\d+/.test(par)?0:ind,jc:/^\d+\.\d+/.test(par)?'left':'both',b:/^\d+\.\d+/.test(par),style:/^\d+\.\d+/.test(par)?'Heading2':undefined});
        row++;
      }
    }
  });
  if (!written) body += P("Разделы пока не написаны.", { ind:ind });

  var sectPr = '<w:sectPr>'+
    '<w:footerReference w:type="default" r:id="rId2"/>'+
    '<w:pgSz w:w="11906" w:h="16838"/>'+
    '<w:pgMar w:top="'+mm2tw(f.mTop)+'" w:right="'+mm2tw(f.mRight)+'" w:bottom="'+mm2tw(f.mBottom)+
      '" w:left="'+mm2tw(f.mLeft)+'" w:header="708" w:footer="708" w:gutter="0"/>'+
    '<w:titlePg/></w:sectPr>';

  var document_xml = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'+
    '<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main" '+
    'xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">'+
    '<w:body>'+body+sectPr+'</w:body></w:document>';

  var fontName = xesc(f.font || "Times New Roman");
  var styles_xml = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'+
    '<w:styles xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">'+
    '<w:docDefaults><w:rPrDefault><w:rPr>'+
      '<w:rFonts w:ascii="'+fontName+'" w:hAnsi="'+fontName+'" w:cs="'+fontName+'" w:eastAsia="'+fontName+'"/>'+
      '<w:sz w:val="'+half+'"/><w:szCs w:val="'+half+'"/><w:lang w:val="ru-RU"/>'+
    '</w:rPr></w:rPrDefault>'+
    '<w:pPrDefault><w:pPr><w:spacing w:after="0" w:line="'+line+'" w:lineRule="auto"/></w:pPr></w:pPrDefault>'+
    '</w:docDefaults>'+
    '<w:style w:type="paragraph" w:default="1" w:styleId="Normal"><w:name w:val="Normal"/><w:qFormat/></w:style>'+
    '<w:style w:type="paragraph" w:styleId="Heading1"><w:name w:val="heading 1"/><w:basedOn w:val="Normal"/><w:qFormat/>'+
      '<w:pPr><w:keepNext/><w:outlineLvl w:val="0"/><w:jc w:val="center"/>'+
      '<w:spacing w:before="240" w:after="240" w:line="'+line+'" w:lineRule="auto"/></w:pPr>'+
      '<w:rPr><w:b/><w:sz w:val="'+half+'"/></w:rPr></w:style>'+
    '</w:styles>';

  var footer_xml = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'+
    '<w:ftr xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">'+
    '<w:p><w:pPr><w:jc w:val="center"/></w:pPr>'+
    '<w:r><w:fldChar w:fldCharType="begin"/></w:r>'+
    '<w:r><w:instrText xml:space="preserve"> PAGE </w:instrText></w:r>'+
    '<w:r><w:fldChar w:fldCharType="separate"/></w:r>'+
    '<w:r><w:rPr><w:sz w:val="'+half+'"/></w:rPr><w:t>2</w:t></w:r>'+
    '<w:r><w:fldChar w:fldCharType="end"/></w:r></w:p></w:ftr>';

  var content_types = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'+
    '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">'+
    '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>'+
    '<Default Extension="xml" ContentType="application/xml"/>'+
    '<Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>'+
    '<Override PartName="/word/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.styles+xml"/>'+
    '<Override PartName="/word/footer1.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.footer+xml"/>'+
    '</Types>';

  var rels = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'+
    '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">'+
    '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/>'+
    '</Relationships>';

  var docRels = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'+
    '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">'+
    '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/>'+
    '<Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/footer" Target="footer1.xml"/>'+
    '</Relationships>';

  return makeZip([
    { name:"[Content_Types].xml", text:content_types },
    { name:"_rels/.rels", text:rels },
    { name:"word/document.xml", text:document_xml },
    { name:"word/_rels/document.xml.rels", text:docRels },
    { name:"word/styles.xml", text:styles_xml },
    { name:"word/footer1.xml", text:footer_xml }
  ]);
}


global.ResultDocx=buildDocx;
})(window);
