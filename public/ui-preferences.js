// Only presentation preferences travel with progress. Credentials and endpoint
// configuration deliberately stay outside this allowlist.
export const UI_PREFERENCE_KEYS=Object.freeze(['zhixing-tutor-width','zhixing-tutor-open','zhixing-lesson-reading','zhixing-tutor-reading-v1','zhixing-catalog-view','zhixing-editor-display','zhixing-preview-width']);
const object=value=>value&&typeof value==='object'&&!Array.isArray(value);
const number=(value,min,max,fallback)=>Number.isFinite(Number(value))?Math.max(min,Math.min(max,Number(value))):fallback;
const option=(value,allowed,fallback)=>allowed.includes(value)?value:fallback;
export function sanitizeUIPreferences(raw){
 const clean={};if(!object(raw))return clean;
 for(const key of UI_PREFERENCE_KEYS){
  const value=raw[key];if(typeof value!=='string'||value.length>2048)continue;
  if(key==='zhixing-tutor-open'){if(['true','false'].includes(value))clean[key]=value;continue;}
  if(key==='zhixing-preview-width'){if(['auto','375','834','1210'].includes(value))clean[key]=value;continue;}
  if(key==='zhixing-tutor-width'){if(value.trim()&&Number.isFinite(Number(value)))clean[key]=String(Math.round(number(value,300,760,340)));continue;}
  let parsed;try{parsed=JSON.parse(value);}catch{continue;}if(!object(parsed))continue;
  let normalized;
  if(key==='zhixing-lesson-reading')normalized={font:Math.round(number(parsed.font,14,22,15)),line:option(parsed.line,[1.7,2,2.3],2)};
  if(key==='zhixing-tutor-reading-v1')normalized={font:Math.round(number(parsed.font,12,26,16)),line:option(parsed.line,[1.6,1.9,2.2],1.9),theme:option(parsed.theme,['light','paper','dark'],'light'),wrap:parsed.wrap===true,width:option(parsed.width,['comfortable','wide'],'comfortable')};
  if(key==='zhixing-catalog-view')normalized={filter:option(parsed.filter,['all','unfinished','wrong','bookmarked','recent'],'all'),order:option(parsed.order,['path','recent','title'],'path')};
  if(key==='zhixing-editor-display')normalized={wrap:parsed.wrap!==false,font:option(parsed.font,[14,16,18,20,22],16)};
  if(normalized)clean[key]=JSON.stringify(normalized);
 }
 return clean;
}
export function collectUIPreferences(storage){const raw={};for(const key of UI_PREFERENCE_KEYS)try{const value=storage.getItem(key);if(value!==null)raw[key]=value;}catch{}return sanitizeUIPreferences(raw);}
export function restoreUIPreferences(storage,raw){const clean=sanitizeUIPreferences(raw);for(const [key,value] of Object.entries(clean))storage.setItem(key,value);return clean;}
