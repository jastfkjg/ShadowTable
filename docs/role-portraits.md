# 深色角色插画

「我的战绩」角色图鉴、趣味记录的职业图标、对局记录与积分流水的角色缩略图，复盘身份图鉴，以及创建房间和房间配置的公开角色列表复用透明 PNG，直接展示在现有 `#1b2b35` 分组底色上。2026-10-16 使用内置 ImageGen 工具生成，参考了项目已有彩色蜡笔头像的笔触与比例，没有沿用参考小程序的图片。

- 原始图集：`docs/sources/role-portraits-atlas.png`，1254×1254，保留透明通道。
- 小程序资源：`miniprogram/assets/roles/*.png`，16 张 160×160 的透明缩略图。
- 名称映射：`miniprogram/role-portraits.js`；扩展角色按职业复用插画，完整角色名与结算阵营独立展示。同名角色跨阵营时保留独立战绩。
- 对局列表的阵营色点与文字取结算记录；插画仅标识角色职业，不据其服装颜色判断阵营。趣味记录的机会数、成功率、未知值和相关对局链接沿用现有数据。
- 公开角色配置由 `miniprogram/room-sheet-presentation.js` 添加插画与重复角色标记；保留服务端的人数、阵营和角色原文，包含盗贼阵营，不据插画推断或调整配比。
- 复盘分别按初始和最终身份选图；身份未记录时显示未知占位，不根据其他时刻的身份补图或推断阵营。积分调整使用独立图标，不显示角色，也不增加详情点击入口。
- 处理脚本：`node scripts/import-role-portraits.js`。先按实际行列间隙切片，再裁去透明边缘、等比缩放并补透明留白，以128色PNG压缩。该脚本针对本次已审核原图的尺寸与切片坐标；替换图集后应重新核对坐标。
- 输入风格参考：`crayon-01.jpg`、`crayon-07.jpg`、`crayon-06.jpg`、`crayon-03.jpg`，位于 `miniprogram/pages/profile/assets/avatars/`。

图集从左到右、从上到下分别为：梅林、派西维尔、忠臣、刺客；莫甘娜、莫德雷德、奥伯伦、兰斯洛特；刀客、猎人、守卫、圣骑士；魔术师、先知、女巫、盗贼。

## 生成提示词

```text
Use case: stylized-concept. Asset type: ONE production sprite atlas of 16 Avalon role portrait illustrations for a dark navy (#101c24 / #1b2b35) Chinese tabletop companion app. Input images are STYLE REFERENCES ONLY: keep the charming soft wax-crayon texture, tiny dot eyes, compact chibi bust proportions and clear silhouettes. Create fresh role portraits and REMOVE the reference images' cream paper squares. Output an actual transparent PNG atlas, no background behind or between any characters. Layout: exact uniform FOUR columns by FOUR rows, square canvas, equal square cells. Portrait centers at 12.5%,37.5%,62.5%,87.5% horizontally and vertically. Each complete head-and-shoulder silhouette occupies at most 70% of its cell width and 76% height, centered with at least 12% clear transparent margins; all hats, hands, shoulders and accessories stay inside their own cell. Same visual scale. Intended display 80px so use simple readable shapes. Palette: warm ivory skin, muted sapphire, sage, gold, dusty red and violet; warm pale contour accents around dark hair and charcoal clothing so the portraits remain legible directly on dark navy. No white/cream rectangle, no circle disk, no halo, no ground shadow. Exact subjects in reading order: Row 1: Merlin elderly white-bearded wizard with sapphire star hat; Percival young blond seer with small gold circlet and sage cloak; loyal servant friendly silver-helmet knight with sapphire cape and small shield; assassin charcoal-hooded masked rogue with muted red scarf. Row 2: Morgana long dark-purple-haired enchantress with crescent ornament; Mordred stern charcoal-armored knight with red-plumed closed helmet; Oberon solitary pale-haired forest outcast with twig crown; Lancelot brown-haired young knight with sapphire tunic and short sword hilt at chest. Row 3: swordsman silver-haired agile duelist with twin sword hilts visible at chest; hunter green-hooded ranger with short bow and quiver; guard sturdy bronze-and-sage armored guardian with broad shield; paladin white-and-gold knight with a small sun emblem. Row 4: magician young purple-hatted stage mage with two little playing cards; prophet silver-haired sage with crescent-topped headband and small blue crystal; witch crimson-haired witch with a plum hat and tiny potion; thief cheerful copper-haired rogue in a teal hood holding a small gold coin. Exactly 16 isolated portraits, no extra characters, no words, no letters, no labels, no numbers, no border lines, no frame, no UI, no watermark. Genuine alpha transparency throughout negative space; preserve textured painted strokes within each portrait.
```
