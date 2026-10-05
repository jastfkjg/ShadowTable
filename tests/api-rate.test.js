const { test } = require("node:test");
const assert = require("node:assert/strict");
const vm = require("node:vm");
const fs = require("node:fs");
test("小程序条件读取只复用同会话公开视图，304返回副本且私密/写请求不复用", async () => {
  let token="one", calls=0; const headers=[], module={exports:{}};
  vm.runInNewContext(fs.readFileSync(require.resolve('../miniprogram/api'),'utf8'),{module,require:()=>({baseUrl:'http://test'}),wx:{
    getStorageSync:()=>token,removeStorageSync(){token='';},request(o){
      headers.push(o.header);calls++;
      o.success(calls===2?{statusCode:304}:{statusCode:200,data:{players:[{name:'甲'}]},header:{ETag:'"one"'}});
    }
  }});
  const api=module.exports, original=await api.request('/api/rooms/123456');original.players[0].name='changed';
  assert.equal((await api.request('/api/rooms/123456')).players[0].name,'甲');assert.equal(headers[1]['If-None-Match'],'"one"');
  await api.request('/api/rooms/123456/private');assert.equal(headers[2]['If-None-Match'],undefined);
  token='two';await api.request('/api/rooms/123456');assert.equal(headers[3]['If-None-Match'],undefined);
  await api.request('/api/rooms/123456/commands','POST',{},api.requestId());
  assert.match(headers[4]['Idempotency-Key'],/^v1_/);
  await api.request('/api/rooms/123456');assert.equal(headers[5]['If-None-Match'],undefined);
});
test("邀请实例的公开读取可条件缓存，不复用其他实例或邀请预览", async () => {
  const headers = [], module = { exports: {} };
  vm.runInNewContext(fs.readFileSync(require.resolve('../miniprogram/api'), 'utf8'), { module, require: () => ({ baseUrl: 'http://test' }), wx: {
    getStorageSync: () => 'same-session', request(options) {
      headers.push(options.header);
      options.success({ statusCode: options.header['If-None-Match'] ? 304 : 200, data: { code: '123456' }, header: { ETag: '"one"' } });
    },
  } });
  for (const url of ['/api/rooms/123456?instance=100', '/api/rooms/123456?instance=100', '/api/rooms/123456?instance=200', '/api/rooms/123456/invitation?instance=100'])
    await module.exports.request(url);
  assert.equal(headers[1]['If-None-Match'], '"one"');
  assert.equal(headers[2]['If-None-Match'], undefined);
  assert.equal(headers[3]['If-None-Match'], undefined);
});
test("小程序遵守超过60秒的Retry-After，旧401响应不能清掉新登录", async () => {
  const module={exports:{}};let token='old',pending;
  vm.runInNewContext(fs.readFileSync(require.resolve('../miniprogram/api'),'utf8'),{module,require:()=>({baseUrl:'http://test'}),wx:{getStorageSync:()=>token,removeStorageSync(){token='';},request:o=>{pending=o;}}});
  const request=module.exports.request('/api/me/rooms');token='new';pending.success({statusCode:401,data:{error:'过期'}});
  await assert.rejects(request,e=>e.status===401);assert.equal(token,'new');
  const limited=module.exports.request('/api/me/rooms');pending.success({statusCode:429,data:{error:'限流'},header:{'Retry-After':'120'}});
  await assert.rejects(limited,e=>e.retryAfterMs===120000);
});
test("429冷却期间不再发请求，到期允许显式重试且保留幂等编号", async () => {
  let now = 0,
    calls = 0;
  const headers = [];
  const module = { exports: {} };
  vm.runInNewContext(
    fs.readFileSync(require.resolve("../miniprogram/api"), "utf8"),
    {
      module,
      require: () => ({ baseUrl: "http://test" }),
      Date: { now: () => now },
      wx: {
        getStorageSync: () => "",
        request: (o) => {
          calls++;
          headers.push(o.header);
          o.success(
            calls === 1
              ? {
                  statusCode: 429,
                  data: { error: "请求过于频繁" },
                  header: { "retry-after": "5" },
                }
              : { statusCode: 200, data: { ok: true } },
          );
        },
      },
    },
  );
  const api = module.exports;
  await assert.rejects(
    () => api.request("/commands", "POST", {}, "same-id"),
    (e) => e.status === 429 && e.retryAfterMs === 5000,
  );
  await assert.rejects(
    () => api.request("/room"),
    (e) => e.status === 429,
  );
  assert.equal(calls, 1);
  now = 5000;
  await api.request("/commands", "POST", {}, "same-id");
  assert.equal(calls, 2);
  assert.equal(headers[1]["Idempotency-Key"], "same-id");
});
