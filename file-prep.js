// ROUTE-03, R3-A: подготовка файла к отправке в кабинете студента.
// Принимаются Word, PDF, Excel и фото (JPEG, PNG, WebP). Крупное фото уменьшается в браузере
// до 2400 точек по большей стороне и сохраняется как JPEG, чтобы уложиться в 5 МБ.
(function(global){
 'use strict';
 var TYPES={docx:'application/vnd.openxmlformats-officedocument.wordprocessingml.document',pdf:'application/pdf',xlsx:'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',jpg:'image/jpeg',jpeg:'image/jpeg',png:'image/png',webp:'image/webp'};
 var ACCEPT='.docx,.pdf,.xlsx,.jpg,.jpeg,.png,.webp,image/jpeg,image/png,image/webp';
 var MAX=5242880,EDGE=2400,SHRINK_FROM=1572864;
 function extension(name){return String(name||'').toLowerCase().split('.').pop();}
 function ascii(view,a,b){return String.fromCharCode.apply(null,view.slice(a,b));}
 function signature(type,view){
  if(type==='application/pdf')return ascii(view,0,5)==='%PDF-';
  if(type==='image/jpeg')return view[0]===0xff&&view[1]===0xd8&&view[2]===0xff;
  if(type==='image/png')return view[0]===0x89&&ascii(view,1,4)==='PNG';
  if(type==='image/webp')return ascii(view,0,4)==='RIFF'&&ascii(view,8,12)==='WEBP';
  return view[0]===80&&view[1]===75&&view[2]===3&&view[3]===4;
 }
 async function shrink(file){
  var bitmap;
  try{bitmap=await createImageBitmap(file);}catch(e){throw Error(file.name+': не удалось открыть фото');}
  var k=Math.min(1,EDGE/Math.max(bitmap.width,bitmap.height)),w=Math.max(1,Math.round(bitmap.width*k)),h=Math.max(1,Math.round(bitmap.height*k));
  var canvas=document.createElement('canvas');canvas.width=w;canvas.height=h;
  var ctx=canvas.getContext('2d');ctx.fillStyle='#fff';ctx.fillRect(0,0,w,h);ctx.drawImage(bitmap,0,0,w,h);
  if(bitmap.close)bitmap.close();
  for(var q of [0.85,0.72,0.6]){
   var blob=await new Promise(function(resolve){canvas.toBlob(resolve,'image/jpeg',q);});
   if(blob&&blob.size<=MAX)return blob;
  }
  throw Error(file.name+': фото слишком большое, сфотографируйте страницу заново');
 }
 // Возвращает {name,type,size,bytes} или бросает понятную ошибку.
 async function prepare(file){
  var type=TYPES[extension(file&&file.name)];
  if(!file||!type||!file.size||String(file.name).length>180)throw Error((file&&file.name||'Файл')+': выберите Word, PDF, Excel или фото (JPEG, PNG, WebP)');
  var name=file.name,blob=file;
  if(type.indexOf('image/')===0&&file.size>SHRINK_FROM){blob=await shrink(file);type='image/jpeg';name=name.replace(/\.[^.]+$/,'')+'.jpg';}
  if(blob.size>MAX)throw Error(file.name+': файл больше 5 МБ');
  var bytes=await blob.arrayBuffer(),view=new Uint8Array(bytes);
  if(!signature(type,view))throw Error(file.name+': содержимое не соответствует формату файла');
  return {name:name,type:type,size:bytes.byteLength,bytes:bytes};
 }
 global.StudFilePrep={TYPES:TYPES,ACCEPT:ACCEPT,MAX:MAX,prepare:prepare,signature:signature};
})(window);
