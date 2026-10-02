import type {PoliceEvent} from './model';
import type {Manifest,DataClient} from './data';
import type {Locale} from './i18n';
export interface DynamicTextPack {schema_version:1;locale:Locale;source_generation:string;texts:Record<string,string>}
export function publicTextFields(rows:readonly PoliceEvent[]):string[] {
 return [...new Set(rows.flatMap(e=>[e.title,e.location_label,...(e.scene_locations??[]).flatMap(s=>[s.label,s.details??'',...(s.incidents??[]).map(i=>i.details??'')])]).filter(Boolean))];
}
export async function textHash(value:string):Promise<string> {
 const hash=await crypto.subtle.digest('SHA-256',new TextEncoder().encode(value));
 return [...new Uint8Array(hash)].map(b=>b.toString(16).padStart(2,'0')).join('');
}
/** Only exact current source fields can be replaced. Evidence quotes and native names remain intact. */
export class DynamicTranslations {
 private lookup=new Map<string,string>();
 missing=0; matched=0;
 clear(){this.lookup.clear();this.missing=0;this.matched=0;}
 text(original:string):string{return this.lookup.get(original)??original;}
 async load(rows:readonly PoliceEvent[],manifest:Manifest,client:DataClient,month:string,locale:Locale,signal:AbortSignal) {
  this.clear();const fields=publicTextFields(rows);
  const path=manifest.translations?.[locale]?.[month];
  if(!path){this.missing=fields.length;return;}
  if(!/^translations\/(de|en|zh)\/\d{4}-(0[1-9]|1[0-2])\.json$/.test(path)||!path.startsWith(`translations/${locale}/`))throw Error('Invalid translation path');
  const pack=await client.json<DynamicTextPack>(`${client.base}/${path}`,signal);
  if(pack.schema_version!==1||pack.locale!==locale||![manifest.generation,manifest.metadata.transport_source_generation,manifest.metadata.translation_source_generation].includes(pack.source_generation)||!pack.texts||typeof pack.texts!=='object')throw Error('Stale translation pack');
  const matched=new Map<string,string>();
  for(let i=0;i<fields.length;i+=32) {
   signal.throwIfAborted();
   const hashes=await Promise.all(fields.slice(i,i+32).map(textHash));
   hashes.forEach((hash,j)=>{const value=pack.texts[hash];if(typeof value==='string'&&value.trim()&&value.length<=32000)matched.set(fields[i+j],value);});
  }
  signal.throwIfAborted();this.lookup=matched;this.matched=matched.size;this.missing=fields.length-matched.size;
 }
}
