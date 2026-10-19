const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const root = path.resolve(__dirname, '../miniprogram');
const { present } = require('../miniprogram/dialog');

function component() {
  let spec;
  const tabBar = { data: {}, setData(patch) { Object.assign(this.data, patch); } };
  vm.runInNewContext(fs.readFileSync(path.join(root,'components/app-dialog/app-dialog.js'),'utf8'), {
    require: () => ({ present }), Component: value => spec = value,
    getCurrentPages: () => [{ getTabBar: () => tabBar }],
  });
  const host = { ...spec.methods, data: structuredClone(spec.data), setData(patch,callback) { Object.assign(this.data,patch); callback?.(); } };
  spec.lifetimes.attached.call(host);
  return { host, spec, tabBar, tap: () => ({ currentTarget: { dataset: { id:host.data.dialog.id } } }) };
}

test('弹窗排队，旧按钮事件不会误确认下一项，每项只回调一次', async () => {
  const {host,tabBar,tap}=component(), results=[];
  const first=host.show({title:'移除记录？',success:r=>results.push(r.confirm)});
  const oldTap=tap();
  const second=host.show({title:'解散房间？',danger:true,success:r=>results.push(r.confirm)});
  assert.equal(host.data.dialog.title,'移除记录？');
  assert.equal(tabBar.data.dialogVisible,true);
  host.confirm(oldTap);
  assert.equal((await first).confirm,true);
  assert.equal(host.data.dialog.title,'解散房间？');
  assert.equal(host.data.dialog.danger,true);
  host.confirm(oldTap);
  assert.equal(host.data.dialog.title,'解散房间？');
  host.cancel(tap());
  assert.equal((await second).cancel,true);
  assert.deepEqual(results,[true,false]);
  assert.equal(host.data.dialog,null);
  assert.equal(tabBar.data.dialogVisible,false);
});

test('切到后台或卸载时取消当前和排队弹窗，恢复底部导航', async () => {
  for(const lifecycle of ['hide','detached']) {
    const {host,spec,tabBar}=component();
    const promises=[host.show({title:'尚未确认'}),host.show({title:'排队中'})];
    (lifecycle==='hide'?spec.pageLifetimes.hide:spec.lifetimes.detached).call(host);
    assert.ok((await Promise.all(promises)).every(r=>r.cancel&&!r.confirm));
    assert.equal(host.data.dialog,null);
    assert.equal(tabBar.data.dialogVisible,false);
    assert.equal((await host.show({title:'晚到的弹窗'})).cancel,true);
    assert.equal(host.data.dialog,null);
  }
});

test('长内容按可用空间滚动，过期的测量不覆盖新弹窗', async () => {
  const {host,tap}=component(),callbacks=[];
  host.createSelectorQuery=()=>{const q={select(){return q},boundingClientRect(){return q},exec(cb){callbacks.push(cb)}};return q;};
  const first=host.show({title:'很长的说明',content:'内容'});
  callbacks.shift()([{height:600},{height:30},null,{height:48},{height:1200}]);
  assert.equal(host.data.bodyHeight,362);
  host.measureBody();
  const stale=callbacks.shift();
  host.confirm(tap());await first;
  const next=host.show({title:'下一项',content:'短说明'});
  stale([{height:600},{height:30},null,{height:48},{height:1000}]);
  assert.equal(host.data.bodyHeight,0);
  callbacks.shift()([{height:600},{height:30},null,{height:48},{height:26}]);
  assert.equal(host.data.bodyHeight,26);
  host.cancel(tap());await next;
});

test('共享入口只寻找当前页，缺少宿主时安全取消，不调用原生白色弹窗', async () => {
  let pages=[],nativeCalls=0,received;
  const module={exports:{}};
  vm.runInNewContext(fs.readFileSync(path.join(root,'dialog.js'),'utf8'),{module,getCurrentPages:()=>pages,wx:{showModal(){nativeCalls++}}});
  const options={title:'确认',success:r=>received=r};
  await module.exports.show(options);
  assert.equal(received.cancel,true);
  pages=[{selectComponent(){throw Error('不应访问上一页')}},{selectComponent:id=>{assert.equal(id,'#app-dialog');return {show:o=>{received=o;return Promise.resolve({confirm:true})}}}}];
  assert.equal((await module.exports.show(options)).confirm,true);
  assert.equal(received,options);
  assert.equal(nativeCalls,0);
});

test('所有小程序路由都包含共享宿主，业务代码不再使用原生弹窗', () => {
  const app=JSON.parse(fs.readFileSync(path.join(root,'app.json'),'utf8'));
  assert.equal(app.usingComponents['app-dialog'],'/components/app-dialog/app-dialog');
  const routes=[...app.pages,...app.subPackages.flatMap(g=>g.pages.map(p=>g.root+'/'+p))];
  for(const route of routes) assert.match(fs.readFileSync(path.join(root,route+'.wxml'),'utf8'),/<app-dialog id="app-dialog"\s*\/>/,route);
  for(const file of fs.readdirSync(root,{recursive:true}).filter(f=>f.endsWith('.js'))) assert.doesNotMatch(fs.readFileSync(path.join(root,file),'utf8'),/wx\.(showModal|showActionSheet)\s*\(/,file);
  assert.equal(present({showCancel:false}).confirmText,'知道了');
  assert.equal(present({danger:true}).danger,true);
});
