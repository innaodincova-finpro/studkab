import {DOMParser} from 'npm:@xmldom/xmldom@0.9.12';
import {getDocumentProxy,getResolvedPDFJS} from 'npm:unpdf@1.8.1';
import {readDocument} from './structured-reader.mjs';
export const readIntake=(bytes:Uint8Array,type:string)=>readDocument(bytes,type,{DOMParser,loadPDF:async(bytes:Uint8Array)=>({document:await getDocumentProxy(bytes,{isEvalSupported:false} as any),OPS:(await getResolvedPDFJS()).OPS})});
