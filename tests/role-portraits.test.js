const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const sharp = require("sharp");
const { portrait } = require("../miniprogram/role-portraits");
const { presentStats } = require("../miniprogram/profile");

test("角色图鉴保留完整名称与最终阵营，同名跨阵营不合并，未知角色使用本地回退插画", () => {
  const good = portrait("蓝刀客·加赫雷斯", "good"), evil = portrait("蓝刀客·加赫雷斯", "evil");
  assert.equal(good.roleTitle, "蓝刀客");
  assert.equal(good.roleSubtitle, "加赫雷斯");
  assert.notEqual(good.roleKey, evil.roleKey);
  assert.equal(evil.factionLabel, "坏人阵营");
  assert.equal(portrait("未来扩展/../角色", "third").portrait, "/assets/roles/thief.png");
  assert.equal(portrait("未知角色", "unknown").portrait, "/assets/roles/guard.png");
  const stats = presentStats({total:3,wins:1,winRate:33.3,byFaction:[],byBoard:[],recent:[],byRole:[
    {role:"刺客",faction:"evil",total:1,wins:0,winRate:0},
    {role:"忠臣",faction:"good",total:2,wins:1,winRate:50},
  ]});
  assert.equal(stats.byRole[0].faction, "good");
  assert.equal(stats.byRole[1].rateLabel, "0%");
});

test("角色资源均为有透明留白的紧凑PNG，缩略图不携带浅色底板", async () => {
  const root = path.resolve(__dirname, "../miniprogram/assets/roles");
  const files = fs.readdirSync(root);
  assert.equal(files.length, 16);
  let total = 0;
  for (const file of files) {
    const source = path.join(root, file);
    total += fs.statSync(source).size;
    const meta = await sharp(source).metadata();
    assert.equal(meta.width, 160, file);
    assert.equal(meta.height, 160, file);
    assert.equal(meta.hasAlpha, true, file);
    const {data, info} = await sharp(source).ensureAlpha().raw().toBuffer({resolveWithObject:true});
    assert.equal(data[3], 0, file);
    assert.equal(data[(info.width * info.height - 1) * 4 + 3], 0, file);
    assert.ok(data.some((value,index) => index % 4 === 3 && value > 0), file);
  }
  assert.ok(total < 256 * 1024, "角色缩略图超过256KiB");
});
