# 月报背景美术素材

使用 Codex 内置 imagegen，以用户提供的月报概念图为参考生成无文字背景。项目文件：`miniprogram/assets/monthly-report-background.jpg`，941×1672，约 135 KiB。使用系统图片工具转换为 JPEG，原图保留。

生成图：`/Users/zilong/.codex/generated_images/01a12bec-23b1-73a3-91a4-ebc46df1c877/exec-bf568d13-9959-4df4-a7e9-ef49ade7ae0d.png`。

绘图代码读取背景上方 25% 作为标题区、下方 20% 作为页脚，其余内容动态排版。示例头像取自现有内置头像库，真实分享始终使用该玩家当前公开头像。

提示词：

> Use case: background-extraction. Asset type: text-free production background for a dynamic Chinese monthly-report poster, portrait 9:16. Use the supplied poster only as an art and composition reference. Extract and reconstruct its dark Arthurian scene as a CLEAN BACKGROUND PLATE. Preserve the premium painterly realism, midnight navy / dark teal, aged gold, cinematic candle light. TOP 24%: right half contains a detailed round wooden table with a small gold crown and upright engraved sword, several chairs with subtle heraldic banners, candles, tall stone arch, crescent moon and distant castle. Keep the same framing as the reference, table low at the edge of the top quarter; entire left half of top quarter must be very dark calm empty space for large dynamically overlaid title. No new people. MIDDLE 58%: empty quiet midnight navy-black, extremely subtle smoky grain and a faint vignette, absolutely no tables, decorative objects, text, lines, badges, panels or content; this space must be clean for dynamic ranking text. BOTTOM 18%: retain the misty forest and Gothic castle silhouettes from the reference with a deep navy fade, discreet and atmospheric. Remove ALL typography, letters, words, digits, headings, rankings, avatars, medals, stat icons, rules, borders, dividers and UI. No watermark. This is ONLY artwork, not another complete poster. Match reference artwork closely. Blend the scene smoothly into near-solid #0e2028 body.
