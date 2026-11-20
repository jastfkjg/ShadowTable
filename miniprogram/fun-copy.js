// Shared display copy for the mini-program, browser and archived projections.
(function (root, factory) {
  const copy = factory();
  if (typeof module === "object" && module.exports) module.exports = copy;
  else root.shadowtableFunCopy = copy;
})(typeof window === "object" ? window : this, function () {
  const labels = {
    survival_revive: "复活", survival_knifed: "被刀",
    honor_mvp: "胜方最佳", honor_svp: "败方最佳",
    percival_green: "三蓝并保护梅林", percival_bust: "三红或梅林被刺",
    merlin_evade: "成功躲刀", merlin_hit: "被刺中",
    good_shield: "成功挡刀",
    assassin_hit: "刺中梅林", assassin_miss: "刺错梅林",
    defense_ally: "保护友方", defense_enemy: "保护对方",
    kill_enemy: "击杀对方", kill_ally: "击杀友方",
    knife_enemy: "刀中敌方", knife_ally: "刀中友方",
    duel_enemy: "决斗敌方", duel_ally: "决斗友方",
  };
  const titles = { survival: "生存趣事", honor: "本场最佳", percival: "派西维尔", knife: "刀客刀法", duel: "骑士", defense: "防御技能", kill: "击杀技能",
    reverse: "逆仆", lancelot: "兰斯洛特", servant: "忠臣", morgana: "莫甘娜", mordred: "莫德雷德", oberon: "奥伯伦" };
  const roleRecords = Object.fromEntries(Object.entries({
    reverse_guard: ["首席护卫", "good", "躲过逆仆刀，留在蓝方，随后梅林刀落到本人身上。"],
    reverse_recruit: ["最佳新援", "evil", "被逆仆刀命中后转为红方，随后梅林被刺中，本人随红方获胜。"],
    lancelot_both: ["双面骑士", "other", "同一局以蓝方兰斯洛特身份参加过成功任务，又以红方兰斯洛特身份亲手提交过失败牌，顺序不限。"],
    servant_all_green: ["圆桌劳模", "good", "同一局以忠臣身份参加了三次成功任务。"],
    servant_bench_win: ["躺赢大师", "good", "在任务名单完整的对局中，忠臣一次正式任务都没上车，最终随蓝方获胜。"],
    morgana_with_percival: ["梅林二号", "evil", "同一局以莫甘娜身份与真正的派西维尔一起参加了至少两次已结算的任务。"],
    mordred_last_bust: ["深藏不露", "evil", "三次任务失败时，莫德雷德在第三次失败的任务中是车上唯一红方。"],
    oberon_two_busts: ["最强独狼", "evil", "同一局以奥伯伦身份亲手在两次任务里提交失败牌，且两次任务均失败。"],
    merlin_all_rides: ["隐身乘客", "good", "蓝方完成三次成功任务并获胜，梅林每趟任务都上车且未被刺中。"],
    merlin_skip_decider: ["幕后军师", "good", "梅林未参加决定第三次任务成功或失败的任务，蓝方最终获胜。"],
    merlin_bust_exit: ["弹射下车", "good", "梅林参加过失败任务，之后至少还有一趟任务且本人再未上车，蓝方最终获胜。"],
    percival_merlin_streak: ["孤注一掷", "good", "派西维尔在场，连续三趟已结算任务均有梅林上车，蓝方最终获胜。"],
    percival_morgana_streak: ["压错宝", "good", "派西维尔在场，连续三趟已结算任务均有莫甘娜上车，刺杀结果不影响计数。"],
    percival_assassinated: ["化身梅派", "good", "最终刺杀的目标是派西维尔，蓝方最终获胜。"],
    servant_green_only: ["金牌乘客", "good", "忠臣至少上过一趟成功任务，没上过失败任务，且蓝方完成三次成功任务；刺杀结果不影响计数。"],
    servant_all_with_bust: ["定蓝机", "good", "忠臣参加每趟任务且至少经历一次任务失败，蓝方完成三次成功任务；刺杀结果不影响计数。"],
    servant_bench_three_green: ["与世无争", "good", "忠臣全局未参加任务，蓝方完成三次成功任务；刺杀结果不影响计数。"],
    reverse_wrong_side: ["站错队", "evil", "被逆仆刀命中转红后，红方最终选错刺杀目标，蓝方获胜。"],
    mordred_three_rides: ["影帝大莫", "evil", "莫德雷德参加至少三趟任务，任务及刺杀结果不影响计数。"],
    mordred_bench_win: ["车底大莫", "evil", "莫德雷德全局未参加任务，红方最终获胜。"],
    mordred_decider_only: ["最后王牌", "evil", "莫德雷德只在决胜任务上车，该任务失败并为红方带来三次任务失败的胜利。"],
    morgana_three_rides: ["倒钩王者", "evil", "莫甘娜参加至少三趟任务，任务及刺杀结果不影响计数。"],
    morgana_no_rides: ["新手演员", "evil", "莫甘娜全局未参加任务，刺杀结果不影响计数。"],
    assassin_oberon_double: ["勇敢炮灰", "evil", "刺客与奥伯伦同车，且该任务收到至少两张失败牌；刺杀结果不影响计数。"],
    oberon_solo_bust: ["孤儿狼", "evil", "奥伯伦是车上唯一红方，亲手提交失败牌并使任务失败；刺杀结果不影响计数。"],
    oberon_bench_win: ["队友勿cue", "evil", "奥伯伦全局未参加任务，红方最终获胜。"],
    oberon_double_bust: ["双炸艺术家", "evil", "奥伯伦与另一名红方同车，且该任务收到至少两张失败牌；刺杀结果不影响计数。"],
    lancelot_red_redemption: ["浪子回头", "evil", "红兰斯洛特转蓝后上车并亲手提交成功牌，最终随蓝方获胜。", "红兰斯洛特"],
    lancelot_blue_betrayal: ["反水大师", "good", "蓝兰斯洛特转红后在决胜任务上车并亲手提交失败牌，最终随红方获胜。", "蓝兰斯洛特"],
    lancelot_double_agent: ["双面间谍", "other", "同一局至少两次阵营转换，最终随当前阵营获胜。红蓝兰斯洛特合并统计。", "红／蓝兰斯洛特"],
    lancelot_switch_win: ["阵营摇摆王", "other", "同一局至少一次阵营转换，最终随当前阵营获胜。红蓝兰斯洛特合并统计。", "红／蓝兰斯洛特"],
  }).map(([id, [title, category, description, roleLabel]]) => [id, { title, category, description, roleLabel, countOnly: true }]));
  const honors = {
    survival_revive: { title: "我在阿瓦隆玩重生", description: "十二骑士中实际复活的次数，包含刀、决斗、猎人、魔术师换号、女巫替死及铠甲等导致的复活", countOnly: true },
    survival_knifed: { title: "全民公敌", description: "十二骑士中承受轮内刀和最终刀的次数，按换号及替死后的实际承受者统计；无论是否生效或复活都计入，不含枪和决斗", countOnly: true },
    honor_mvp: { title: "最强 MVP", description: "获得胜方最佳玩家的次数", countOnly: true },
    honor_svp: { title: "最强 SVP", description: "获得败方最佳玩家的次数", countOnly: true },
    percival_green: { title: "最强派西", description: "派西玩家带3蓝车并保护梅林次数最多" },
    percival_bust: { title: "竭尽全力", description: "派西玩家带3红车或梅林被刺次数最多" },
    merlin_evade: { title: "闪身步大神", description: "梅林玩家成功躲刀次数最多" },
    merlin_hit: { title: "舍我其谁", description: "梅林玩家被刺中次数最多" },
    good_shield: { title: "金牌替身", description: "终局时存活的非梅林好人被最终刀选中的次数最多，包含派西维尔" },
    assassin_hit: { title: "职业刺客", description: "刺客玩家刺中梅林次数最多" },
    assassin_miss: { title: "背锅侠", description: "刺客玩家刺错梅林次数最多" },
    defense_ally: { title: "绝对防御", description: "玩家有防御技能（适用于守卫、魔术师）并保护友方阵营次数最多" },
    defense_enemy: { title: "卧龙凤雏", description: "玩家有防御技能（适用于守卫、魔术师）并保护对方阵营次数最多" },
    kill_enemy: { title: "职业杀手", description: "玩家有击杀技能并击杀对方阵营次数最多" },
    kill_ally: { title: "痛击队友", description: "玩家有击杀技能并击杀友方阵营次数最多" },
  };
  const identities = { survival: "十二骑士全体玩家", honor: "玩家票选",
    percival: "派西维尔", merlin: "梅林", good: "非梅林好人", assassin: "刺客",
    defense: "蓝守卫／魔术师", kill: "刀客／骑士／猎人等",
  };
  const conditions = {
    survival_revive: "因各种原因实际复活的次数", survival_knifed: "被刀次数，无论是否生效或复活",
    honor_mvp: "获得胜方最佳玩家的次数", honor_svp: "获得败方最佳玩家的次数",
    percival_green: "三蓝且梅林未被刺的局数", percival_bust: "三红或梅林被刺的局数",
    merlin_evade: "成功躲过最终刺杀的次数", merlin_hit: "最终被刺中的次数",
    good_shield: "作为非梅林好人，最终刀落到本人身上的次数",
    assassin_hit: "最终刺中梅林的次数", assassin_miss: "最终刺杀未命中梅林的次数",
    defense_ally: "成功保护友方的次数", defense_enemy: "成功保护对方的次数",
    kill_enemy: "成功击杀对方的次数", kill_ally: "成功击杀友方的次数",
  };
  const killIdentities = "蓝刀客·加雷斯、蓝刀客·加赫雷斯、红刀客·奥伯伦、蓝兰斯洛特、红兰斯洛特、刺客、觉醒蓝刀客、觉醒红刀客、蓝骑士、红骑士、蓝猎人、红猎人";
  for (const [id, record] of Object.entries(roleRecords)) labels[id] = record.title;
  const legacyTitleIds = {
    灯下黑梅林: "merlin_all_rides",
    影帝梅林: "merlin_skip_decider",
    炸飞梅林: "merlin_bust_exit",
    占错队: "reverse_wrong_side",
  };
  const currentTitle = title => Object.hasOwn(legacyTitleIds, title) ? roleRecords[legacyTitleIds[title]].title : title;
  const currentTitleScope = scope => scope?.split(" · ").map(currentTitle).join(" · ");
  const recordDetails = { ...honors, ...roleRecords };
  const displayGroups = [
    'percival', 'merlin', 'servant', 'reverse', 'assassin', 'morgana', 'mordred', 'oberon', 'lancelot',
    'good', 'defense', 'kill', 'knife', 'gun', 'duel', 'final', 'survival', 'honor',
  ];
  const groupOrder = new Map(displayGroups.map((group, index) => [group, index]));
  const titleOrder = new Map(Object.keys(recordDetails).map((id, index) => [id, index]));
  function compareDisplayIds(a, b) {
    const groupA = groupOrder.get(a.split('_')[0]) ?? groupOrder.size;
    const groupB = groupOrder.get(b.split('_')[0]) ?? groupOrder.size;
    return groupA - groupB || (titleOrder.get(a) ?? titleOrder.size) - (titleOrder.get(b) ?? titleOrder.size);
  }
  for (const [id, honor] of Object.entries(recordDetails)) {
    const group = id.split("_")[0];
    honor.roleLabel ||= identities[group] || titles[group];
    honor.roleDetail = id.startsWith("kill_") ? killIdentities : honor.roleLabel;
    honor.conditionLabel = conditions[id] || honor.description;
  }
  const descriptions = {
    survival: "复活按实际回场计数；被刀包含轮内刀和最终刀，按换号、替死后的承受者统计，无论是否生效或复活。",
    assassin: "仅统计刺客的非空最终刺杀。",
  };
  const modeLabels = { all: '全部玩法', classic: '经典', knights: '十二骑士', other: '扩展玩法' };
  const combinedRecords = new Set(['merlin_evade', 'merlin_hit', 'percival_green', 'percival_bust', ...Object.keys(roleRecords)]);
  const isCombinedRecord = id => combinedRecords.has(id);
  function metric(row) {
    const id = row.id || row.key?.replace(/^fun_/, "");
    const record = recordDetails[id];
    const title = row.key && record ? record.title : titles[id?.split("_")[0]];
    return { ...row, ...(labels[id] ? { label: labels[id],
      ...(row.rankLabel !== undefined ? { rankLabel: labels[id] } : {}) } : {}),
      ...(row.title !== undefined && title ? { title } : {}),
      ...(record ? { countOnly: !!record.countOnly, honorTitle: record.title, description: record.description,
        ...(record.category ? { category: record.category } : {}),
        roleLabel: record.roleLabel, roleDetail: record.roleDetail, conditionLabel: record.conditionLabel } : {}) };
  }
  function legacyLabel(label, type) {
    if (label === "三绿达成") return labels.percival_green;
    if (label === "三炸收场") return labels.percival_bust;
    if (label === "命中敌方") return labels[type + "_enemy"] || label;
    if (["命中同伴", "命中友方"].includes(label)) return labels[type + "_ally"] || label;
    return currentTitle(label);
  }
  function recordEntries(cards, splitModes, includeCatalogue) {
    const entries = [];
    const totals = new Map();
    for (const card of cards) {
      for (const row of card.metrics) {
        if (row.id.endsWith('aim_enemy')) continue;
        if (splitModes || !isCombinedRecord(row.id)) {
          entries.push({ card, row });
          continue;
        }
        let total = totals.get(row.id);
        if (!total) {
          total = { ...row, mode: 'all', byRole: [], count: 0, opportunities: 0, knownGames: 0, unknownGames: 0, value: null, rate: null };
          totals.set(row.id, total);
          entries.push({ card, row: total });
        }
        total.unknownGames += row.unknownGames || 0;
        if (row.value == null) continue;
        total.count += row.count;
        total.opportunities += row.opportunities;
        total.knownGames += row.knownGames || 0;
        total.value = total.count;
      }
    }
    for (const row of totals.values()) {
      if (row.opportunities > 0) row.rate = Math.round(row.count / row.opportunities * 1000) / 10;
    }
    if (splitModes || !includeCatalogue) return entries;
    const displayed = new Set(entries.map(({ row }) => row.id));
    const catalogue = Object.keys(recordDetails).flatMap(id => {
      if (!Object.hasOwn(roleRecords, id) && displayed.has(id)) return [];
      const group = id === 'good_shield' ? 'shield' : id.split('_')[0];
      const mode = group === 'honor' ? 'voted' : ['survival', 'defense', 'kill'].includes(group) ? 'knights' : 'all';
      const row = totals.get(id) || metric({ id, mode, noSamples: true, value: null, count: 0,
        knownGames: 0, unknownGames: 0, opportunities: 0, rate: null });
      return [{ card: { id: mode + ':' + group }, row }];
    });
    return entries.filter(({ row }) => !Object.hasOwn(roleRecords, row.id)).concat(catalogue)
      .sort((a, b) => compareDisplayIds(a.row.id, b.row.id));
  }
  function records(value, { splitModes = false, includeCatalogue = false } = {}) {
    const cards = summary(value)?.cards || [];
    const multipleModes = new Set(cards.filter(card => !card.id.endsWith(':honor')).map(card => card.id.split(':')[0])).size > 1;
    const visuals = {
      honor: ['record-medal.svg', 'gold'], survival: ['record-heart.svg', 'purple'],
      percival: ['roles/percival.png', 'portrait'], merlin: ['roles/merlin.png', 'portrait'],
      shield: ['record-shield-good.svg', 'green'], assassin: ['roles/assassin.png', 'portrait'],
      defense: ['record-shield.svg', 'gold'], kill: ['record-swords.svg', 'blue'],
      knife: ['roles/swordsman.png', 'portrait'], gun: ['roles/hunter.png', 'portrait'], duel: ['roles/lancelot.png', 'portrait'],
      reverse: ['roles/reverse.png', 'portrait'], lancelot: ['roles/lancelot.png', 'portrait'],
      servant: ['roles/servant.png', 'portrait'], morgana: ['roles/morgana.png', 'portrait'],
      mordred: ['roles/mordred.png', 'portrait'], oberon: ['roles/oberon.png', 'portrait'],
    };
    const tiles = recordEntries(cards, splitModes, value && includeCatalogue).map(({ card, row }) => {
      const group = card.id.split(':').pop(), mode = row.mode || card.mode || card.id.split(':')[0];
      const [image, iconTone] = row.id === 'survival_knifed' ? ['record-swords.svg', 'blue'] : visuals[group] || ['record-spark.svg', 'purple'];
      const known = row.value != null, hasCount = known && row.count > 0;
      const hasRate = known && !row.countOnly && row.rate != null && row.opportunities > 0;
      const positive = row.positive ?? row.ranked;
      const rateName = !row.honorTitle ? row.label + '率' : row.rateLabel === '发生率' || !positive ? '发生率' : '成功率';
      const rateLabel = hasRate ? rateName + ' ' + Number(row.rate.toFixed(1)) + '%' : '';
      const sampleLabel = hasRate ? row.count + ' / ' + row.opportunities + ' ' + (row.unit || '次') : '';
      const stateLabel = row.noSamples ? (Object.hasOwn(roleRecords, row.id) ? '暂无该身份记录' : '暂无相关记录')
        : !known ? '尚无完整记录' : !row.countOnly && !row.opportunities ? '暂无有效机会' : !hasCount ? '暂无次数' : '查看说明';
      const url = row.noSamples ? '' : '/pages/matches/matches?fun=' + encodeURIComponent(row.id) + '&mode=' + encodeURIComponent(mode);
      const roleLabel = ({ survival:'生存趣事', defense:'守卫 / 魔术师', kill:'击杀技能', knife:'刀客', gun:'猎人', duel:'骑士' })[group] || row.roleLabel || card.title || titles[group] || '趣味记录';
      return { ...row, key: mode + ':' + row.id, mode, url, hasCount, known,
        title: row.honorTitle || row.label, icon: '/assets/' + image, iconTone,
        roleLabel: (mode === 'all' || ((multipleModes || row.noSamples) && group !== 'honor') ? (modeLabels[mode] || mode) + ' · ' : '') + roleLabel,
        valueLabel: known ? String(row.count) : '—', unit: known ? row.unit || '次' : '',
        color: !hasCount ? 'muted' : group === 'honor' ? row.id === 'honor_mvp' ? 'mvp' : 'svp' : group === 'survival' ? 'purple' : row.id.endsWith('failed') ? 'muted' : positive ? 'good' : 'evil',
        rateLabel, sampleLabel, stateLabel,
        accessibilityLabel: (row.honorTitle || row.label) + '，' + (row.conditionLabel || row.label) + '，' + (known ? row.count + (row.unit || '次') : stateLabel) + (hasRate ? '，' + rateLabel + '，' + sampleLabel : '') + '，查看记录说明',
        roles: (['knife', 'gun', 'duel', 'kill'].includes(group) ? row.byRole || [] : []).map(role => ({ ...role,
          countLabel: role.value == null ? '—' : String(role.count),
          url: url + '&role=' + encodeURIComponent(role.role),
        })),
      };
    });
    return { tiles, recordedTiles: tiles.filter(row => row.hasCount), totalCount: tiles.length, recordedCount: tiles.filter(row => row.hasCount).length };
  }
  function recordInfo(tile) {
    let content = String(tile.description || tile.conditionLabel || tile.label).replace(/次数最多/g, '次数');
    if (!tile.honorTitle) content += '的次数，按完整技能环节的实际记录累计；缺失过程不按零次计算。';
    if (tile.id === 'percival_green') content = '初始身份为派西维尔，三蓝后仍有梅林在场，且最终刀未刺中梅林的局数。';
    if (tile.id === 'percival_bust') content = '初始身份为派西维尔，三红或最终刀刺中梅林的局数。提前盘刀刺中也计入，一局最多一次。';
    if (['assassin_hit', 'assassin_miss'].includes(tile.id)) content += '空刀不计入刺客的次数和比例。';
    if (tile.id.startsWith('defense_')) content += '守卫需实际挡下伤害；魔术师需通过换号让原目标避开伤害。比例按实际保护总次数计算。';
    if (tile.id.startsWith('kill_')) content += '合并轮内刀、枪、决斗造成的实际出局，按技能发生时的阵营和实际承受者统计；最终刺杀单独记录。';
    const mode=modeLabels[tile.mode],rules=[];
    let description=content;
    if(tile.id==='survival_knifed') {
      description='累计承受轮内刀和最终刀的次数。';
      rules.push({label:'统计对象',value:'换号、替死后的实际承受者'},{label:'计入条件',value:'是否生效或复活，均计入'},{label:'不计入',value:'枪、决斗'});
    }
    if(tile.rateLabel) rules.push({label:tile.rateLabel.split(' ')[0],value:tile.rateLabel.split(' ').slice(1).join(' ')+' · '+tile.sampleLabel});
    return { variant:'fun-record', title:tile.title, contextIcon:tile.icon, contextLabel:tile.known?'累计记录':'',
      contextValue:tile.known ? tile.valueLabel+' '+tile.unit : tile.stateLabel,
      content, info:{category:tile.roleLabel+(mode&&!tile.roleLabel.includes(mode)?' · '+mode:''),description,rules,identity:tile.roleDetail||tile.roleLabel} };
  }
  function summary(value) {
    if (!value) return value;
    const cards = value.cards.filter(card => !card.id.endsWith(":final")).map(card => ({ ...card,
      title: titles[card.id.split(":").pop()] || card.title,
      ...(descriptions[card.id.split(":").pop()] ? { description: descriptions[card.id.split(":").pop()] } : {}),
      metrics: card.metrics.map(metric) }));
    const teaserType = value.teaser?.startsWith("刀客刀法") ? "knife"
      : value.teaser?.startsWith("骑士") ? "duel" : "percival";
    let teaser = value.teaser?.replace(/三绿达成|三炸收场|命中敌方|命中同伴|命中友方/g,
      label => legacyLabel(label, teaserType)).replace(/骑士决斗/g, "骑士");
    if (/^(最终带刀|十二骑士最终刺杀)\s*·/.test(teaser || "")) {
      const highlight = cards.flatMap(card => card.metrics
        .filter(row => (row.positive ?? row.ranked) && row.count > 0)
        .map(row => ({ ...row, title: card.title }))).sort((a, b) => b.count - a.count)[0];
      teaser = highlight ? `${highlight.title} · ${highlight.label} ${highlight.count} ${highlight.unit}` : "";
    }
    return { ...value,
      ...(value.teaser !== undefined ? { teaser } : {}),
      ...(value.metrics ? { metrics: value.metrics.filter(row => !row.id.startsWith("final_")).map(metric) } : {}),
      cards };
  }
  function groupEvents(events = []) {
    const groups = new Map();
    for (const [index, event] of events.entries()) {
      const round = Number(event.round);
      const numbered = Number.isInteger(round) && round > 0;
      const terminal = /^(final|task-outcome)/.test(event.id || "");
      const id = numbered ? "round-" + round : terminal ? "final" : "other";
      if (!groups.has(id)) groups.set(id, {
        id, round: numbered ? round : null,
        label: numbered ? `第 ${round} 轮` : terminal ? "终局记录" : "本局记录",
        marker: numbered ? String(round).padStart(2, "0") : terminal ? "终" : "记",
        events: [],
      });
      const icon = event.kind === "revive" || event.label?.includes("复活") ? "heart"
        : event.kind === "receivedKnife" || event.label === "被刀" ? "sword"
        : event.kind === "defense" || /保护|挡刀/.test(event.label || "") ? "shield"
        : /^honor_/.test(event.id || "") ? "medal"
        : ["knife", "duel", "gun"].includes(event.kind) ? "swords" : "spark";
      groups.get(id).events.push({ ...event, id: event.id || "event-" + index, icon: "/assets/record-" + icon + ".svg" });
    }
    return [...groups.values()].sort((a, b) => (a.round ?? Infinity) - (b.round ?? Infinity)).map(group => {
      const roles = [...new Set(group.events.map(event => event.role).filter(Boolean))];
      return { ...group, role: roles.length === 1 ? roles[0] : "", showEventRoles: roles.length > 1 };
    });
  }
  function story(value) {
    if (!value) return value;
    const types = [...new Set((value.metrics || []).map(row => row.id.split("_")[0])
      .filter(type => ["knife", "gun", "duel"].includes(type)))];
    const events = (value.events || []).map(event => ({ ...event,
      label: roleRecords[String(event.id ?? "").replace(/^final-/, "")]?.title ||
        legacyLabel(event.label, event.kind || event.type || (types.length === 1 ? types[0] : "")),
      ...(typeof event.detail === "string" ? { detail: event.detail.replace(/(\d+号)非梅林好人/g, "$1") } : {}) }));
    return { ...value, eventGroups: groupEvents(events),
      hasEffectiveHighlights: (value.highlights || []).some(row =>
        row.count > 0 && !row.id.endsWith("_failed") && !row.id.endsWith("_aim_enemy")),
      ...(value.metrics ? { metrics: value.metrics.map(metric) } : {}),
      ...(value.highlights ? { highlights: value.highlights.map(metric) } : {}),
      ...(value.events ? { events } : {}) };
  }
  function matchStory(value) {
    const result = story(value);
    if (!result) return result;
    const events = result.events || [];
    const hit = events.find(event => event.id === "final" && event.label === labels.merlin_hit);
    const duplicate = !!hit && events.some(event => event.id === "final-received");
    const displayEvents = events.filter(event => !duplicate || event.id !== "final-received").map(event => {
      if (event !== hit) return event;
      const target = /^最终目标：\s*(\d+)\s*号(?:\s*·\s*(?:系统结算|房主登记))?$/.exec(event.detail || "");
      return target ? { ...event, detail: `最终目标为本人（${target[1]} 号）` } : event;
    });
    const matchHighlights = (result.highlights || []).map(item => {
      if (item.id === "merlin_hit") return { ...item, label: "终局被刺中" };
      if (duplicate && item.id === "survival_knifed") return { ...item, count: item.count - 1, label: "轮内被刀" };
      return item;
    }).filter(item => item.count > 0);
    return {
      ...result,
      matchHighlights,
      eventCount: displayEvents.length,
      eventGroups: groupEvents(displayEvents).map(group => ({
        ...group,
        label: group.id === "final" ? "终局" : group.label,
        compact: group.id === "final" && group.events.length === 1,
      })),
    };
  }
  function leaderboard(value) {
    const id = value.metric?.replace(/^fun_/, "");
    const record = recordDetails[id];
    return { ...value,
      ...(value.availableFunMetrics ? { availableFunMetrics: value.availableFunMetrics.map(metric) } : {}),
      ...(value.fun && record ? {
        title: record.title, description: record.description,
        roleLabel: record.roleLabel, roleDetail: record.roleDetail, conditionLabel: record.conditionLabel,
        countOnly: !!record.countOnly,
        metricLabel: roleRecords[id] ? "达成次数" : id.startsWith("honor_") ? "获奖次数" : (labels[id] || value.metricLabel?.replace(/次数$|率$/, "")) + (value.sort === "rate" ? "率" : "次数"),
      } : value.fun && labels[id] ? {
        title: titles[id.split("_")[0]] || value.title,
        metricLabel: labels[id] + (value.sort === "rate" ? "率" : "次数"),
      } : {}) };
  }
  function response(value) {
    if (!value || typeof value !== "object" || Array.isArray(value)) return value;
    const result = leaderboard(value);
    if (value.fun && typeof value.fun === "object") result.fun = value.fun.cards ? summary(value.fun) : story(value.fun);
    if (value.myFun) result.myFun = story(value.myFun);
    for (const key of ["records", "recent"])
      if (Array.isArray(value[key])) result[key] = value[key].map(record => record.fun
        ? { ...record, fun: story(record.fun) } : record);
    return result;
  }
  function shareSnapshot(snapshot) {
    if (snapshot?.version !== 1 || !snapshot.player || !snapshot.data) return snapshot;
    const { kind, data, player } = snapshot;
    if (kind === "fun" && Object.hasOwn(roleRecords, data.metric)) {
      const record = roleRecords[data.metric];
      return { ...snapshot, title: `${player.name}的${record.title} · ${data.count}${data.unit}`,
        data: { ...data, label: record.title, description: record.description } };
    }
    if (kind === "funSummary") return { ...snapshot, data: { ...data,
      items: data.items.map(item => ({ ...item, label: currentTitle(item.label) })) } };
    if (kind === "matches") return { ...snapshot, data: { ...data, scope: currentTitleScope(data.scope) } };
    return snapshot;
  }
  return { labels, titles, honors, roleRecords, compareDisplayIds, currentTitleScope, metric, summary, records, isCombinedRecord, recordInfo, story, matchStory, groupEvents, leaderboard, response, shareSnapshot };
});
