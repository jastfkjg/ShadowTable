const { test } = require('node:test');
const assert = require('node:assert/strict');
const { createWechatCode } = require('../server/wechat-code');
const png = Buffer.concat([Buffer.from('89504e470d0a1a0a', 'hex'), Buffer.from('fixture')]);
const binary = value => ({ ok: true, arrayBuffer: async () => value });
test('微信码服务缓存凭据、合并并发刷新，仅将32位请求传入已发布确认页', async () => {
  let now = 1000, tokens = 0, images = 0;
  const create = createWechatCode({ appId: 'test-id', appSecret: 'secret', clock: () => now,
    fetcher: async (url, options) => {
      const data = JSON.parse(options.body);
      if (url.endsWith('/stable_token')) {
        tokens++; assert.equal(data.appid, 'test-id'); assert.equal(data.secret, 'secret');
        return { ok: true, json: async () => ({ access_token: 'server-token', expires_in: 7200 }) };
      }
      images++;
      assert.equal(new URL(url).searchParams.get('access_token'), 'server-token');
      assert.equal(data.page, 'pages/web-login/web-login'); assert.equal(data.env_version, 'release');
      assert.equal(data.check_path, true); assert.equal(data.scene.length, 32);
      assert.equal(data.secret, undefined);
      return binary(png);
    } });
  const results = await Promise.all([create('a'.repeat(32)), create('b'.repeat(32))]);
  assert.equal(tokens, 1); assert.equal(images, 2); assert.deepEqual(results[0].bytes, png);
  await create('c'.repeat(32)); assert.equal(tokens, 1);
  now += 7200000; await create('d'.repeat(32)); assert.equal(tokens, 2);
});
test('微信凭据失效仅重试一次；微信故障与错误响应不暴露密钥，未发布页面明确报错', async () => {
  for (const errcode of [40001, 40014, 42001, 41030, 45009]) {
    let tokens = 0, images = 0;
    const create = createWechatCode({ appId: 'test', appSecret: 'SECRET', fetcher: async url => {
      if (url.endsWith('/stable_token')) { tokens++; return { ok: true, json: async () => ({ access_token: 'TOKEN', expires_in: 7200 }) }; }
      images++; return binary(Buffer.from(JSON.stringify({ errcode, errmsg: 'sensitive SECRET TOKEN' })));
    } });
    await assert.rejects(create('a'.repeat(32)), e => {
      assert.equal(e.status, 503); assert.doesNotMatch(e.message, /SECRET|TOKEN|sensitive/);
      assert.match(e.message, errcode === 41030 ? /尚未发布/ : /暂时无法生成/); return true;
    });
    assert.equal(images, [40001, 40014, 42001].includes(errcode) ? 2 : 1); assert.equal(tokens, images);
  }
  const broken = createWechatCode({ fetcher: async () => { throw new Error('fetch URL with SECRET'); } });
  await assert.rejects(broken('a'.repeat(32)), e => e.status === 503 && !e.message.includes('SECRET'));
});
