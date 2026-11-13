import {GradeError} from './config.mjs';

const LANGUAGES=['html','css','javascript'];
function source(value,label,limit){
  if(typeof value!=='string'||value.length>limit)throw new GradeError(`${label}必须是文本，且不能超过 ${limit.toLocaleString('en-US')} 个字符。`);
  return value;
}
export function normalizeSubmission(value,{allowEmpty=false}={}){
  if(typeof value==='string')value={mode:'code',code:value};
  if(!value||typeof value!=='object'||Array.isArray(value))throw new GradeError('代码提交格式无效。');
  const testCode=source(value.testCode??'','调用示例',10000);
  if(value.mode==='web'){
    if(!LANGUAGES.includes(value.mainLanguage)||!value.files||typeof value.files!=='object'||Array.isArray(value.files))throw new GradeError('联动提交需要主文件语言和 HTML、CSS、JavaScript 三个文件。');
    const files=Object.fromEntries(LANGUAGES.map(name=>[name,source(value.files[name],name.toUpperCase()+' 文件',30000)]));
    if(!allowEmpty&&!Object.values(files).some(code=>code.trim()))throw new GradeError('请先填写代码，再请求 AI 评价。');
    return {mode:'web',mainLanguage:value.mainLanguage,files,testCode};
  }
  if(value.mode!=='code')throw new GradeError('代码提交模式无效。');
  const code=source(value.code,'代码',30000);
  if(!allowEmpty&&!code.trim())throw new GradeError('请先填写代码，再请求 AI 评价。');
  const language=typeof value.language==='string'?value.language.slice(0,50):'javascript';
  return {mode:'code',code,language,testCode};
}

export function submissionMaterial(value){
  const submission=normalizeSubmission(value);
  return submission.mode==='web'?{
    mode:'web',mainLanguage:submission.mainLanguage,
    files:submission.files,testCode:submission.testCode,
    evaluationScope:'结合 HTML 结构、CSS 样式、JavaScript 事件与 DOM 操作及调用示例评价整个页面。主文件是本题实现，其余文件是学习者可修改的配套文件；不能忽略它们之间的依赖。调用示例仅辅助理解，不能当作已经实际执行的测试。'
  }:submission;
}
