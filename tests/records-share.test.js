const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const source = fs.readFileSync(path.join(__dirname,'../miniprogram/records-share.js'),'utf8');

test('主包与分包的单页导航配置使用微信支持的枚举值', () => {
  const root=path.join(__dirname,'../miniprogram');
  const app=JSON.parse(fs.readFileSync(path.join(root,'app.json'),'utf8'));
  const pages=[...app.pages,...(app.subPackages||[]).flatMap(pkg=>pkg.pages.map(page=>pkg.root+'/'+page))];
  for(const file of ['app.json',...pages.map(page=>page+'.json')]) {
    const config=JSON.parse(fs.readFileSync(path.join(root,file),'utf8'));
    const fit=config.singlePage?.navigationBarFit;
    if(fit!==undefined) assert.ok(['float','squeezed'].includes(fit),file+': singlePage.navigationBarFit 仅支持 float 或 squeezed');
  }
});

test('分享场景判断优先本次进入参数，回退启动参数，普通朋友圈入口仍打开完整功能', () => {
  const mod={exports:{}};
  let enter={scene:1154},launch={scene:1154};
  vm.runInNewContext(source,{module:mod,wx:{getEnterOptionsSync:()=>enter,getLaunchOptionsSync:()=>launch}});
  const {isSinglePage}=mod.exports;
  assert.equal(isSinglePage(),true);
  enter={scene:1155};assert.equal(isSinglePage(),false);
  enter=undefined;assert.equal(isSinglePage(),true);
  assert.equal(isSinglePage({scene:1001}),false);
  assert.equal(isSinglePage({scene:1154}),true);
  launch=undefined;assert.equal(isSinglePage(),false);
});
test('单页模式应用不创建通知器或调用存储，恢复完整模式后启动，切后台停止', () => {
  let definition,created=0,starts=0,stops=0;
  const share={isSinglePage:options=>options.scene===1154};
  vm.runInNewContext(fs.readFileSync(path.join(__dirname,'../miniprogram/app.js'),'utf8'),{
    App:app=>definition=app,getCurrentPages:()=>[],
    require:name=>name==='./records-share'?share:{create(){created++;return {start(){starts++;},stop(){stops++;}};}},
  });
  definition.onShow({scene:1154});assert.equal(created,0);assert.equal(starts,0);
  definition.onShow({scene:1155});assert.equal(created,2);assert.equal(starts,2);
  definition.onShow({scene:1154});assert.equal(starts,2);assert.equal(stops,2);
  definition.onShow({scene:1001});assert.equal(created,2);assert.equal(starts,4);
  definition.onHide();assert.equal(stops,4);
});
test('正常模式的公开分享入口也不启动个人通知，坏链接不触发登录回退', () => {
  const {isSharedEntry}=require('../miniprogram/records-share');
  assert.equal(isSharedEntry({path:'pages/shared/shared',query:{share:'bad'}}),true);
  assert.equal(isSharedEntry({path:'/pages/stats/stats',query:{share:''}}),true);
  assert.equal(isSharedEntry({path:'pages/stats/stats',query:{tab:'records'}}),false);
  assert.equal(isSharedEntry({path:'pages/lobby/lobby',query:{share:'bad'}}),false);
  let definition,starts=0;
  vm.runInNewContext(fs.readFileSync(path.join(__dirname,'../miniprogram/app.js'),'utf8'),{
    App:value=>definition=value,getCurrentPages:()=>[],
    require:name=>name==='./records-share'?{isSinglePage:()=>false,isSharedEntry}:{create(){return {start(){starts++;},stop(){}};}},
  });
  definition.onShow({path:'pages/shared/shared',query:{share:'bad'}});assert.equal(starts,0);
  definition.onShow({path:'pages/lobby/lobby'});assert.equal(starts,2);
});
