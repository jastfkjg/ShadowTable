# 深色角色插画

「我的战绩」角色图鉴、趣味记录的职业图标、对局记录与积分流水的角色缩略图，复盘身份图鉴，以及创建房间和房间配置的公开角色列表复用透明 PNG，直接展示在现有 `#1b2b35` 分组底色上。2026-10-16 使用内置 ImageGen 工具生成，参考了项目已有彩色蜡笔头像的笔触与比例，没有沿用参考小程序的图片。

- 原始图集：`docs/sources/role-portraits-atlas.png`，1254×1254，保留透明通道。
- 小程序资源：`miniprogram/assets/roles/*.png`，现有 35 张 112×112 的透明缩略图，合计约 229 KiB（预算 248 KiB）。
- 名称映射：`miniprogram/role-portraits.js`；具名角色和红蓝变体使用独立插画，其余按职业复用，完整角色名与结算阵营独立展示。同名角色跨阵营时保留独立战绩。
- 对局列表的阵营色点与文字取结算记录；插画仅标识角色职业，不据其服装颜色判断阵营。趣味记录的机会数、成功率、未知值和相关对局链接沿用现有数据。
- 公开角色配置由 `miniprogram/room-sheet-presentation.js` 添加插画与重复角色标记；保留服务端的人数、阵营和角色原文，包含盗贼阵营，不据插画推断或调整配比。
- 复盘分别按初始和最终身份选图；身份未记录时显示未知占位，不根据其他时刻的身份补图或推断阵营。积分调整使用独立图标，不显示角色，也不增加详情点击入口。
- 处理脚本：`node scripts/import-role-portraits.js`。依次导入原始图集、阵营图集和最终骑士／内奸图集。先按已核对的行列间隙切片，再裁去透明边缘、等比缩放并补透明留白，最后以索引色 PNG 压缩；替换图集后应重新核对坐标。原始职业图标保留供趣味记录使用。
- 输入风格参考：`crayon-01.jpg`、`crayon-07.jpg`、`crayon-06.jpg`、`crayon-03.jpg`，位于 `miniprogram/pages/profile/assets/avatars/`。

图集从左到右、从上到下分别为：梅林、派西维尔、忠臣、刺客；莫甘娜、莫德雷德、奥伯伦、兰斯洛特；刀客、猎人、守卫、圣骑士；魔术师、先知、女巫、盗贼。

## 2026-11-13 确认稿接入

使用内置 ImageGen（非 CLI）将用户确认的两张预览去除背景和标签，保留真实透明通道；以下原图已存入项目，不依赖本地生成缓存。

- `docs/sources/role-portraits-factions.png`（1122×1402）：4 列 × 5 行。石像鬼、奥伯伦、旧版蓝／红骑士；蓝／红兰斯洛特、加雷斯、加赫雷斯；蓝／红猎人、蓝／红守卫；蓝／红术士、蓝／红盗贼；觉醒蓝／红刀客、旧版蓝／红内奸。旧版骑士和内奸的四个格子不导入。
- `docs/sources/role-portraits-knights-spies.png`（1199×1312）：2 列 × 2 行。最终露面头盔与枪旗的蓝／红骑士；软帽、密信和双面徽章的蓝／红内奸。
- 石像鬼不再复用莫德雷德；奥伯伦（包括红刀客·奥伯伦）使用林地隐士形象。加雷斯和加赫雷斯由发型与额饰区分。红蓝变体只按角色名称选图，不随结算阵营重新着色，尤其不能把盗贼的服饰颜色当成阵营。
- `assetNames` 从共享映射导出供网页静态资源白名单使用，避免新增图片只在小程序能加载。名称查找兼容中点两侧的空格以及“蓝／红刀客 · 兰斯洛特”，不修改原角色名、分组键和阵营。
- 可复现页面预览：`node scripts/render-stats-preview.js`，查看输出目录的 `role-art-variants.html`；采用生产 WXML/WXSS 和共享角色映射，演示数据不写入真实战绩。
- 验证：透明尺寸和留白、资源总大小、独立角色及红蓝配对、跨阵营身份保持、网页匿名素材加载，以及房间配置和复盘回归。

最终透明图集处理提示词（两次内置 ImageGen 调用）：

```text
Use case: background-extraction. Edit this exact supplied approved portrait board into a production TRANSPARENT sprite atlas. Remove ONLY the dark navy background and ALL the Chinese text captions, making those pixels fully transparent. Preserve all 20 portraits exactly: same crayon texture, faces, equipment, colors, silhouettes, poses and details. Do NOT redesign or redraw the characters. Keep the exact FOUR columns and FIVE rows in original reading order. Each portrait remains centered in its own equally sized cell, all parts inside cell with generous transparent margins. Do not add or omit characters. True alpha transparency, no simulated checkerboard, no background, no text, no labels, no shadows behind the portraits. Preserve natural textured edges, no dark navy boxes or halos. This is extraction of the approved artwork, not a new creative concept.
```

```text
Use case: background-extraction. Edit this exact supplied approved portrait board into a production TRANSPARENT sprite atlas. Remove ONLY the dark navy background and ALL Chinese caption text, making those pixels fully transparent. Preserve all FOUR portraits exactly: same crayon texture, faces, equipment, colors, silhouettes, poses and details. Do NOT redesign or redraw. Top row blue knight / red knight, bottom row blue court spy / red court spy. Keep exactly TWO columns and TWO rows, each portrait centered in its own equally sized cell with generous transparent margins. Retain entire feathers, pennants, helmets and shoulders. True alpha transparency, no simulated checkerboard, no background, no text, no labels, no shadows behind the portraits. Preserve natural textured edges, no dark navy boxes or halos. This is extraction of the approved artwork, not a new creative concept.
```

## 生成提示词

```text
Use case: stylized-concept. Asset type: ONE production sprite atlas of 16 Avalon role portrait illustrations for a dark navy (#101c24 / #1b2b35) Chinese tabletop companion app. Input images are STYLE REFERENCES ONLY: keep the charming soft wax-crayon texture, tiny dot eyes, compact chibi bust proportions and clear silhouettes. Create fresh role portraits and REMOVE the reference images' cream paper squares. Output an actual transparent PNG atlas, no background behind or between any characters. Layout: exact uniform FOUR columns by FOUR rows, square canvas, equal square cells. Portrait centers at 12.5%,37.5%,62.5%,87.5% horizontally and vertically. Each complete head-and-shoulder silhouette occupies at most 70% of its cell width and 76% height, centered with at least 12% clear transparent margins; all hats, hands, shoulders and accessories stay inside their own cell. Same visual scale. Intended display 80px so use simple readable shapes. Palette: warm ivory skin, muted sapphire, sage, gold, dusty red and violet; warm pale contour accents around dark hair and charcoal clothing so the portraits remain legible directly on dark navy. No white/cream rectangle, no circle disk, no halo, no ground shadow. Exact subjects in reading order: Row 1: Merlin elderly white-bearded wizard with sapphire star hat; Percival young blond seer with small gold circlet and sage cloak; loyal servant friendly silver-helmet knight with sapphire cape and small shield; assassin charcoal-hooded masked rogue with muted red scarf. Row 2: Morgana long dark-purple-haired enchantress with crescent ornament; Mordred stern charcoal-armored knight with red-plumed closed helmet; Oberon solitary pale-haired forest outcast with twig crown; Lancelot brown-haired young knight with sapphire tunic and short sword hilt at chest. Row 3: swordsman silver-haired agile duelist with twin sword hilts visible at chest; hunter green-hooded ranger with short bow and quiver; guard sturdy bronze-and-sage armored guardian with broad shield; paladin white-and-gold knight with a small sun emblem. Row 4: magician young purple-hatted stage mage with two little playing cards; prophet silver-haired sage with crescent-topped headband and small blue crystal; witch crimson-haired witch with a plum hat and tiny potion; thief cheerful copper-haired rogue in a teal hood holding a small gold coin. Exactly 16 isolated portraits, no extra characters, no words, no letters, no labels, no numbers, no border lines, no frame, no UI, no watermark. Genuine alpha transparency throughout negative space; preserve textured painted strokes within each portrait.
```
