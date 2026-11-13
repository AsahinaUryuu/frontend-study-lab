export const WEB_LANGUAGES=['html','css','javascript'];
export function mainLanguage(profile={}){return WEB_LANGUAGES.includes(profile.mainLanguage)?profile.mainLanguage:['html','css'].includes(profile.mode)?profile.mode:'javascript';}
export function webFiles(profile={},state={}){
  const files={html:state.previewHtml??profile.html??'<main><h1>我的交互页面</h1><button id="demo-button">点击按钮</button><p id="result"></p></main>',css:profile.css??'',javascript:profile.javascript??''};
  for(const language of WEB_LANGUAGES)if(typeof state.webFiles?.[language]==='string')files[language]=state.webFiles[language];
  files[mainLanguage(profile)]=state.code??'';
  return files;
}
