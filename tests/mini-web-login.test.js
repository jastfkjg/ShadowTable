const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const id = 'a'.repeat(32);
function page(overrides = {}) {
  let definition, timer, logins = 0;
  const calls = [], api = { login: async () => { logins++; }, request: async (path, method, data) => {
    calls.push({ path, method, data });
    if (overrides.request) return overrides.request(path, method, data);
    if (path.endsWith('/profile')) return { nickname: '小程序玩家', identityType: 'wx' };
    return { status: path.endsWith('/confirm') ? 'confirmed' : path.endsWith('/reject') ? 'cancelled' : 'scanned', website: 'https://play.example.com', device: 'Mac', expiresAt: Date.now() + 120000 };
  } };
  vm.runInNewContext(fs.readFileSync(require.resolve('../miniprogram/pages/web-login/web-login.js'), 'utf8'), {
    Page: p => { definition = p; }, require: name => name === '../../api' ? api : { presentProfile: p => p, backToMe() {} },
    setTimeout: fn => { timer = fn; return 1; }, clearTimeout: () => { timer = null; }, Date,
  });
  const p = { ...definition, data: structuredClone(definition.data), setData: values => Object.assign(p.data, values) };
  return { p, calls, timer: () => timer, logins: () => logins };
}
test('扫码只展示请求和当前账号，必须明确点击确认；取消不会确认，重复点击只提交一次', async () => {
  const a = page(); await a.p.onLoad({ scene: id });
  assert.equal(a.p.data.status, 'scanned'); assert.equal(a.p.data.request.website, 'https://play.example.com');
  assert.equal(a.calls.filter(c => c.path.endsWith('/confirm')).length, 0);
  const pending = a.p.confirm(); a.p.confirm(); await pending;
  assert.equal(a.calls.filter(c => c.path.endsWith('/confirm')).length, 1);
  assert.equal(a.p.data.status, 'confirmed'); a.p.onUnload();
  const b = page(); await b.p.onLoad({ scene: id }); await b.p.reject();
  assert.equal(b.p.data.status, 'cancelled'); assert.equal(b.calls.some(c => c.path.endsWith('/confirm')), false);
});
test('非法扫码不请求，开发身份不能确认；过期和卸载阻止提交与旧响应', async () => {
  const bad = page(); await bad.p.onLoad({ scene: '%INVALID' }); assert.equal(bad.calls.length, 0); assert.equal(bad.p.data.terminal, true);
  const dev = page({ request: async () => ({ identityType: 'dev' }) }); await dev.p.onLoad({ scene: id });
  assert.match(dev.p.data.error, /开发和陪测/); assert.equal(dev.calls.length, 1);
  const expired = page(); await expired.p.onLoad({ scene: id }); expired.timer()(); await expired.p.confirm();
  assert.equal(expired.p.data.terminal, true); assert.equal(expired.calls.some(c => c.path.endsWith('/confirm')), false);
  let release;
  const unloaded = page({ request: () => new Promise(resolve => { release = resolve; }) });
  const loading = unloaded.p.onLoad({ scene: id }); await new Promise(resolve => setImmediate(resolve));
  unloaded.p.onUnload(); release({ identityType: 'dev' }); await loading;
  assert.equal(unloaded.p.data.profile, null); assert.equal(unloaded.p.data.error, '');
});
test('会话过期只在新页面重新登录一次，网络失败可重试同一确认请求', async () => {
  let profileReads = 0, confirmations = 0;
  const a = page({ request: async path => {
    if (path.endsWith('/profile')) {
      if (++profileReads === 1) throw Object.assign(new Error('会话过期'), { status: 401 });
      return { identityType: 'wx' };
    }
    if (path.endsWith('/confirm') && ++confirmations === 1) throw new Error('网络未确认');
    return { status: path.endsWith('/confirm') ? 'confirmed' : 'scanned', expiresAt: Date.now() + 120000 };
  } });
  await a.p.onLoad({ scene: id }); assert.equal(a.logins(), 2); assert.equal(a.p.data.status, 'scanned');
  await a.p.confirm(); assert.match(a.p.data.error, /网络未确认/); assert.equal(a.p.data.busy, false);
  await a.p.confirm(); assert.equal(a.p.data.status, 'confirmed'); assert.equal(confirmations, 2);
  assert.ok(a.calls.filter(c => c.path.endsWith('/confirm')).every(c => c.path.includes(id)));
});
