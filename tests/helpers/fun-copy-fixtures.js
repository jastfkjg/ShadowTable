const knife = ['enemy', 'ally', 'failed'].map((outcome, index) => ({
  id: 'knife_' + outcome, label: ['命中敌方', '命中同伴', '未生效'][index],
  unit: '次', mode: 'knights', ranked: index === 0, positive: index === 0,
  count: index === 1 ? 1 : 0, value: index === 1 ? 1 : 0,
  opportunities: 1, knownGames: 1, unknownGames: 0, rate: index === 1 ? 100 : 0,
  byRole: [{ role: 'gaheris', label: '蓝刀客·加赫雷斯', count: index === 1 ? 1 : 0,
    value: index === 1 ? 1 : 0, opportunities: 1 }],
}));
const story = { version: 'fun-2026-10-v2', status: 'recorded', initialRole: '蓝刀客·加赫雷斯', metrics: knife,
  highlights: [{ id: 'good_shield', label: '成功挡刀', count: 1, unit: '次' },
    { id: 'knife_ally', label: '命中同伴', count: 1, unit: '次' }],
  events: [{ id: 'final-shield', role: '魔术师', label: '成功挡刀', detail: '最终刀落到本人（1号非梅林好人） · 房主登记' },
    { id: 'attack-1', kind: 'knife', round: 1, role: '蓝刀客·加赫雷斯', label: '命中同伴', detail: '9号同阵营 · 目标出局' }],
};
const stats = { total: 3, wins: 1, losses: 2, winRate: 33.3, byFaction: [], byRole: [], byBoard: [], recent: [],
  fun: { version: 'fun-2026-10-v2', legacyGames: 2, teaser: '刀客刀法 · 命中敌方 0 次',
    metrics: knife, cards: [{ id: 'knights:knife', title: '刀客刀法', mode: 'knights', modeLabel: '十二骑士', metrics: knife }] },
};
const match = { id: 'legacy-copy', boardName: '阿瓦隆 · 十二骑士', capacity: 12, endedAt: Date.UTC(2026, 9, 2, 15, 8),
  role: '魔术师', faction: 'good', outcome: 'win', winner: 'good', source: 'manual', seat: 1, members: [], fun: story };
module.exports = { stats, match };
