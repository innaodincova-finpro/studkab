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
    var name = enc.encode(f.name), data = f.bytes instanceof Uint8Array ? f.bytes : enc.encode(f.text);
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
function base64Bytes(value){
  var raw=String(value||'').replace(/^data:[^,]+,/,'').replace(/\s+/g,''),bin;
  if(!raw||!/^[A-Za-z0-9+/]+={0,2}$/.test(raw))throw Error('Повреждено изображение в документе');
  if(typeof atob==='function')bin=atob(raw);
  else if(typeof Buffer==='function')return new Uint8Array(Buffer.from(raw,'base64'));
  else throw Error('Не удалось прочитать изображение');
  var out=new Uint8Array(bin.length);for(var i=0;i<bin.length;i++)out[i]=bin.charCodeAt(i);return out;
}

function buildDocx(w, chapters){
  var f = Object.assign({font:"Times New Roman",size:14,spacing:1.5,indent:1.25,mTop:20,mBottom:20,mLeft:30,mRight:15},w.format||{});
  // Historical records may contain absent or nonnumeric formatting.
  var limits={size:[8,24,14],spacing:[1,3,1.5],indent:[0,5,1.25],mTop:[0,100,20],mBottom:[0,100,20],mLeft:[0,100,30],mRight:[0,100,15]};
  Object.keys(limits).forEach(function(k){var a=limits[k],n=Number(f[k]);f[k]=f[k]!==null&&f[k]!==""&&Number.isFinite(n)&&n>=a[0]&&n<=a[1]?n:a[2];});
  var line = Math.round((f.spacing || 1.5) * 240);
  var half = Math.round((f.size || 14) * 2);
  var ind = cm2tw(f.indent || 0);
  var author = (w.student || "").trim();
  var group = (w.group || "").trim();
  var year = f.year || String(new Date().getFullYear());
  var media=[],imageRels=[],imageId=0,tableNumber=0;

  function P(text, o){
    o = o || {};
    var pPr = '<w:pPr>'+
      (o.style ? '<w:pStyle w:val="'+o.style+'"/>' : '')+
      (o.keepNext ? '<w:keepNext/>' : '')+
      (o.pageBreakBefore ? '<w:pageBreakBefore/>' : '')+
      '<w:spacing w:before="'+(o.before||0)+'" w:after="'+(o.after||0)+'" w:line="'+(o.line||line)+'" w:lineRule="auto"/>'+
      '<w:ind w:firstLine="'+(o.ind||0)+'"/>'+
      '<w:jc w:val="'+(o.jc || "both")+'"/>'+
      '</w:pPr>';
    var rPr = '<w:rPr>'+(o.b?'<w:b/>':'')+'<w:color w:val="000000"/><w:sz w:val="'+(o.half||half)+'"/><w:szCs w:val="'+(o.half||half)+'"/></w:rPr>';
    var run = text === "" ? "" : '<w:r>'+rPr+'<w:t xml:space="preserve">'+xesc(text)+'</w:t></w:r>';
    return '<w:p>'+pPr+run+'</w:p>';
  }
  function pageBreak(){ return '<w:p><w:r><w:br w:type="page"/></w:r></w:p>'; }
  function image(figure){
    var mime=String(figure.mimeType||'').toLowerCase(),ext=mime==='image/jpeg'?'jpg':mime==='image/png'?'png':'';
    if(!ext)throw Error('Word поддерживает изображения PNG и JPEG');
    var bytes=base64Bytes(figure.dataBase64||figure.data||'');
    if(bytes.length>1048576)throw Error('Одно изображение не должно превышать 1 МБ');
    imageId++;var rid='rIdImage'+imageId,name='image'+imageId+'.'+ext;
    media.push({name:'word/media/'+name,bytes:bytes});
    imageRels.push('<Relationship Id="'+rid+'" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/image" Target="media/'+name+'"/>');
    var width=Math.max(30,Math.min(160,Number(figure.widthMm)||150)),height=Math.max(20,Math.min(220,Number(figure.heightMm)||90));
    var cx=Math.round(width*36000),cy=Math.round(height*36000),caption=String(figure.caption||('Рисунок '+imageId)).trim();
    return '<w:p><w:pPr><w:jc w:val="center"/><w:keepNext/></w:pPr><w:r><w:drawing><wp:inline xmlns:wp="http://schemas.openxmlformats.org/drawingml/2006/wordprocessingDrawing" distT="0" distB="0" distL="0" distR="0"><wp:extent cx="'+cx+'" cy="'+cy+'"/><wp:docPr id="'+imageId+'" name="'+xesc(caption)+'"/><a:graphic xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main"><a:graphicData uri="http://schemas.openxmlformats.org/drawingml/2006/picture"><pic:pic xmlns:pic="http://schemas.openxmlformats.org/drawingml/2006/picture"><pic:nvPicPr><pic:cNvPr id="'+imageId+'" name="'+xesc(name)+'"/><pic:cNvPicPr/></pic:nvPicPr><pic:blipFill><a:blip r:embed="'+rid+'"/><a:stretch><a:fillRect/></a:stretch></pic:blipFill><pic:spPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="'+cx+'" cy="'+cy+'"/></a:xfrm><a:prstGeom prst="rect"><a:avLst/></a:prstGeom></pic:spPr></pic:pic></a:graphicData></a:graphic></wp:inline></w:drawing></w:r></w:p>'+P(caption,{jc:'center',ind:0,after:240});
  }

  /* Титульный лист */
  var body = "";
  if(w.draftNotice && w.draftNotice!==f.workType)body+=P(w.draftNotice,{jc:"center",b:true,after:240});
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

  /* Entries follow the saved structure; PAGEREF calculates real pages.
     An outer cached TOC field prevents LibreOffice from refreshing these references. */
  if (f.toc){
    body += P("СОДЕРЖАНИЕ", { jc:"center", b:true, after:240 });
    var entries=chapters.map(function(c,i){return {chapter:c,index:i};}).filter(function(e){var ch=((w.structure||{})[e.chapter.id]||{});return ch.text||(Array.isArray(ch.figures)&&ch.figures.length);});
    entries.forEach(function(e,i){
      var anchor='section_'+e.index;
      body+='<w:p><w:pPr><w:tabs><w:tab w:val="right" w:leader="dot" w:pos="'+(11906-mm2tw(f.mLeft)-mm2tw(f.mRight))+'"/></w:tabs><w:spacing w:line="'+line+'" w:lineRule="auto"/></w:pPr>';
      body+='<w:hyperlink w:anchor="'+anchor+'"><w:r><w:t>'+xesc(e.chapter.name)+'</w:t></w:r><w:r><w:tab/></w:r><w:r><w:fldChar w:fldCharType="begin" w:dirty="true"/></w:r><w:r><w:instrText xml:space="preserve"> PAGEREF '+anchor+' \\h </w:instrText></w:r><w:r><w:fldChar w:fldCharType="separate"/></w:r><w:r><w:t> </w:t></w:r><w:r><w:fldChar w:fldCharType="end"/></w:r></w:hyperlink>';
      body+='</w:p>';
    });
    body += pageBreak();
  }

  /* Разделы */
  var written = 0;
  chapters.forEach(function(c, i){
    var ch = (w.structure || {})[c.id] || { text:"" };
    var text = (ch.text || "").trim();
    var figures=Array.isArray(ch.figures)?ch.figures:[];
    if (!text && !figures.length) return;
    var newPage=written > 0 && f.sectionPageBreaks!==false;
    written++;
    body += P(c.name.toUpperCase(), { style:"Heading1", jc:"center", b:true, after:240, pageBreakBefore:newPage }).replace('</w:pPr>','</w:pPr><w:bookmarkStart w:id="'+i+'" w:name="section_'+i+'"/>').replace('</w:p>','<w:bookmarkEnd w:id="'+i+'"/></w:p>');
    var lines=text.split(/\n+/),row=0;
    // The section title is already emitted above. Remove only an exact leading
    // duplicate, preserving subsection headings and the author's body text.
    var normalizedTitle=function(v){return String(v).trim().replace(/^#{1,6}\s+/, '').replace(/^\*\*(.*)\*\*$/, '$1').trim().toLowerCase();};
    if(lines.length && normalizedTitle(lines[0])===normalizedTitle(c.name))row=1;
    while(row<lines.length){
      var par=lines[row].trim();
      if(/^#{1,6}\s+/.test(par))par=par.replace(/^#{1,6}\s+/,'');
      if(/^Таблица\s+(?:[А-ЯA-Z]\.)?\d{1,3}\s*[—–-]/i.test(par)){
        if(/^Таблица\s+\d/i.test(par)){tableNumber++;par=par.replace(/^(Таблица\s+)\d{1,3}/i,'$1'+tableNumber);}
        body+=P(par,{ind:0,jc:'left',b:true,after:120,keepNext:true});row++;continue;
      }
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
        grid.forEach(function(cells,ri){body+='<w:tr><w:trPr><w:cantSplit/>'+(ri===0?'<w:tblHeader/>':'')+'</w:trPr>';for(var ci=0;ci<cols;ci++)body+='<w:tc><w:tcPr><w:tcW w:w="'+cw+'" w:type="dxa"/>'+(ri===0?'<w:shd w:fill="E8EEF4"/>':'')+'</w:tcPr>'+P(cells[ci]||'',{jc:ci?'center':'left',b:ri===0,half:24,line:240,keepNext:ri===0})+'</w:tc>';body+='</w:tr>';});body+='</w:tbl>'+P('');
      }else{
        if(par)body+=P(par,{ind:/^\d+\.\d+/.test(par)?0:ind,jc:/^\d+\.\d+/.test(par)?'left':'both',b:/^\d+\.\d+/.test(par),style:/^\d+\.\d+/.test(par)?'Heading2':undefined});
        row++;
      }
    }
    figures.forEach(function(figure){body+=image(figure);});
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
    '<w:style w:type="paragraph" w:styleId="Heading2"><w:name w:val="heading 2"/><w:basedOn w:val="Normal"/><w:qFormat/><w:pPr><w:keepNext/><w:outlineLvl w:val="1"/></w:pPr><w:rPr><w:b/><w:color w:val="000000"/></w:rPr></w:style>'+
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
    '<Default Extension="png" ContentType="image/png"/>'+
    '<Default Extension="jpg" ContentType="image/jpeg"/>'+
    '<Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>'+
    '<Override PartName="/word/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.styles+xml"/>'+
    '<Override PartName="/word/settings.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.settings+xml"/>'+
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
    '<Relationship Id="rId3" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/settings" Target="settings.xml"/>'+
    imageRels.join('')+
    '</Relationships>';

  return makeZip([
    { name:"[Content_Types].xml", text:content_types },
    { name:"_rels/.rels", text:rels },
    { name:"word/document.xml", text:document_xml },
    { name:"word/_rels/document.xml.rels", text:docRels },
    { name:"word/styles.xml", text:styles_xml },
    { name:"word/settings.xml", text:'<?xml version="1.0" encoding="UTF-8" standalone="yes"?><w:settings xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:updateFields w:val="true"/></w:settings>' },
    { name:"word/footer1.xml", text:footer_xml }
  ].concat(media));
}


global.ResultDocx=buildDocx;
})(window);
