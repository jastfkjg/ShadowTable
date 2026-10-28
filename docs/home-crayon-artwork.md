# 首页 A「雾蓝轻绘」素材

2026-10-28 首页改用 B 简洁版：保留 `miniprogram/assets/home-wordmark.png`，入口改用 `home-create-outline.svg` 和 `home-join-outline.svg`。以下记录 A 版素材来源；三张停用插画已移至 `docs/artwork/home-a/` 存档，避免继续占用小程序主包。

视觉采用深蓝、奶油白、雾蓝与暖金，以小尺寸蜡笔梅林衔接头像及分享封面。页面按紧凑品牌区、创建／加入双入口、真实牌桌列表组织。入口沿用轻按反馈，刷新状态旋转、房间侧滑沿用原动效；减少动态效果设置继续生效。

素材通过内置 image_gen 生成，参考用户选定的 A 版与精简版。生成原图保留在 Codex generated_images；项目文件及停用素材保存在下表路径，不依赖该外部目录。

| 素材 | 项目路径 | 输出 | 用途 |
| --- | --- | --- | --- |
| 品牌插画（已停用） | docs/artwork/home-a/home-header.jpg | 800×267，11436 字节，mozjpeg 52 | 无字背景，右侧梅林，左侧留白 |
| 手绘字标 | miniprogram/assets/home-wordmark.png | 320×107，6728 字节，透明 PNG，40 色 | 桌边助手品牌字标，加载失败回退原生文字 |
| 创建图标（已停用） | docs/artwork/home-a/home-create-cards.png | 128×128，6236 字节，透明 PNG，48 色 | 三张星纹卡牌 |
| 加入图标（已停用） | docs/artwork/home-a/home-join-door.png | 128×128，9370 字节，透明 PNG，48 色 | 蓝色拱门与金色箭头 |

四张素材合计 33770 字节。除品牌字标外，入口文案、连接状态、房间名称、号码、人数、座位、时间与操作均为原生 WXML／真实数据；未把 UI 截图整张嵌入页面。样式限制在首页和共享底栏，不改变创建／加入、复制、刷新、管理和侧滑行为。

## 生成提示词

### header（透明背景：false）

```text
Use case: precise-object-edit. Production illustration asset extracted and adapted from the approved A home-screen design, not another UI mockup. Input image 1 is the compact approved home layout; image 2 is its fuller scene/art style reference.
Produce ONE standalone TEXT-FREE WIDE header background, 3:1 landscape, ideally 1200x400. Deep navy #101c24 base must extend right to ALL outer edges for seamless integration into a real app. Left 56 percent is calm nearly solid dark navy, no objects, no lettering, no outlines. Right third features the SAME exact friendly elderly Merlin, mist-blue floppy hat with one GOLD FOUR-POINT star, fluffy ivory beard, tiny black dot eyes, peach round nose, gentle smile, holding one or two small blue star-backed cards and resting one hand on a tiny subtle tabletop line. Cute small wax-crayon character, exactly the reference identity and tactile pencil/crayon technique. Keep all hat, head and hand silhouette safely inside x=61–94%, y=8–94% so slight vertical cropping is safe. At most a faint bit of blue shelving or ONE tiny warm lantern at extreme far right, subordinate to character; no full castle scene. The character's eyes face the viewer. Preserve the warm mature handmade charm.
REMOVE ALL UI, text, brand words, subtitle, green connection dot, help button, WeChat navigation/capsule, cards/buttons, room list and bottom tabs. No text, letters, numerals, logos outside hat/card star, no borders, no watermark. Full bleed illustration only, opaque navy background. Must work as a compact ~100px-high home header with native brand text on the left.
```

### wordmark（透明背景：true）

```text
Use case: background-extraction. Production transparent brand wordmark from the approved A UI references. Extract ONLY the four large Chinese brand characters exactly "桌边助手" from the upper brand area. ONE horizontal line, not two rows. Preserve the reference's warm ivory #f4ead7 wax-crayon hand-lettering, confident friendly chunky strokes and slight dry crayon grain, perfectly correct simplified Chinese. All four characters legible and evenly spaced, no extra flourishes, no underline. Wide canvas 3:1 with modest transparent vertical margins; natural letter proportions, brand letters occupy 92% width and about 60–72% height, evenly centered. True transparent alpha all around and in internal letter counterspaces. Remove background, mascot, dot, subtitle, all UI, shadows, glow, frame and every other mark. No English, no captions, no second wordmark. Final isolated lettering asset only, suitable for display around 140x45 CSS pixels on navy.
```

### create（透明背景：true）

```text
Use case: background-extraction. Production transparent illustration icon matching the approved A UI. Extract and clean up ONLY the small fanned blue role-card stack illustration from the "创建房间" action tile. A charming stack of THREE mist-blue/navy face-down role cards, cream edges and one gold FOUR-point star on the top card, same tactile wax-crayon strokes, naturally slightly tilted, front card readable at 40 CSS pixels. Preserve reference shape and palette, NOT poker cards, no suits or numbers. Square canvas, centered complete stack with 9% transparent padding; true transparent alpha throughout empty space. REMOVE the ivory action button, all words and arrows, background, UI, shadows outside the cards, all other elements. No lettering or watermark, no enclosing circle or tile, no unrelated props. ONE isolated card-stack asset.
```

### join（透明背景：true）

```text
Use case: background-extraction. Production transparent illustration icon matching the approved A UI. Extract and clean up ONLY the little arched mist-blue doorway with a warm gold arrow pointing into it from the "加入房间" action tile. Same cozy wax-crayon identity and palette as reference, blue-grey stone arch, blue wooden door slightly ajar, one clear simple gold right-pointing arrow across the doorway, a tiny hint of sage at threshold if needed. Strong simple silhouette legible at 40 CSS pixels. Square canvas, centered full doorway with 8% transparent padding; true transparent alpha outside object and its threshold. REMOVE the blue action tile, all words, chevron, other background, UI and all other elements. No lettering, numbers, watermark, enclosing circle/tile or extra props. ONE isolated doorway/arrow asset.
```

## 品牌区文字与帮助入口

副标题使用原生 15px／500 字重文字，常规字距 1px，窄屏 0.4px。字标图的透明留白与 aspectFit 产生的边距叠加后，可见左缘分别距图片框约 12.6px／8.9px；因此副标题采用 13px／9px 内缩。原生品牌名回退时内缩为零。梅林背景保留右侧 8px 空间（常规尺寸比初版左移 24px），窄屏缩至 280px；帮助图标的深色衬底用于隔开背景纹理。
