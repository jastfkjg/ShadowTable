// Pure deterministic reference implementation. No network, RNG, or LLM.
export function validateConfig(config) {
  const ids = new Set();
  const dims = [...config.coreDimensions, config.styleDimension];
  if (config.questions.length !== 28 || config.roles.length !== 8 || dims.length !== 8) throw new Error('Invalid v2.0.0 cardinality');
  for (const q of config.questions) {
    if (ids.has(q.id)) throw new Error(`Duplicate question ${q.id}`);
    ids.add(q.id);
    if (q.options.length !== 3 || q.measuredDims.length < 2 || q.measuredDims.length > 3) throw new Error(`Invalid question ${q.id}`);
    if (new Set(q.options.map(o => o.id)).size !== 3) throw new Error(`Duplicate option ${q.id}`);
    if (new Set(q.measuredDims).size !== q.measuredDims.length) throw new Error(`Duplicate dimension ${q.id}`);
    for (const d of q.measuredDims) {
      if (!dims.includes(d)) throw new Error(`Unknown dimension ${d}`);
      const values = q.options.map(o => o.scores[d]);
      if (values.some(v => !Number.isInteger(v) || v < -2 || v > 2)) throw new Error(`Invalid score ${q.id}.${d}`);
      if (Math.max(...values) === Math.min(...values)) throw new Error(`Constant measured dimension ${q.id}.${d}`);
    }
    for (const o of q.options) {
      if (Object.keys(o.scores).sort().join() !== [...q.measuredDims].sort().join()) throw new Error(`Score key mismatch ${q.id}.${o.id}`);
    }
  }
  if (new Set(config.roles.map(r => r.id)).size !== 8) throw new Error('Duplicate role');
  for (const r of config.roles) {
    if (r.prototype.length !== 7 || !r.prototype.every(Number.isFinite) || Math.hypot(...r.prototype) === 0) throw new Error(`Invalid prototype ${r.id}`);
  }
  const units = Object.fromEntries(config.roles.map(r => [r.id, unit(r.prototype)]));
  for (const o of config.tieBreakers.role.options) {
    const projections = config.roles.map(r => dot(config.coreDimensions.map(d => o.scores[d] ?? 0), units[r.id]));
    for (let i = 0; i < projections.length; i++) for (let j = i + 1; j < projections.length; j++) {
      if (Math.abs(projections[i] - projections[j]) <= config.scoring.epsilon) throw new Error(`Role tiebreak collision ${o.id}`);
    }
  }
  return true;
}

const unit = v => { const n = Math.hypot(...v); return v.map(x => x / n); };
const dot = (a, b) => a.reduce((s, x, i) => s + x * b[i], 0);

export function aggregateProfile(config, answers) {
  const dims = [...config.coreDimensions, config.styleDimension];
  const numerator = Object.fromEntries(dims.map(d => [d, 0]));
  const denominator = Object.fromEntries(dims.map(d => [d, 0]));
  const selected = [];
  for (const q of config.questions) {
    const option = q.options.find(o => o.id === answers[q.id]);
    if (!option) throw new Error(`Missing or invalid answer ${q.id}`);
    const centered = {};
    for (const d of q.measuredDims) {
      const mean = q.options.reduce((s, o) => s + o.scores[d], 0) / q.options.length;
      const m = Math.max(...q.options.map(o => Math.abs(o.scores[d] - mean)));
      if (!(m > 0)) throw new Error(`No contrast ${q.id}.${d}`);
      centered[d] = option.scores[d] - mean;
      numerator[d] += centered[d];
      denominator[d] += m;
    }
    selected.push({questionId: q.id, optionId: option.id, text: option.text, interpretation: option.interpretation, centered});
  }
  const profile = Object.fromEntries(dims.map(d => {
    if (!(denominator[d] > 0)) throw new Error(`Unmeasured dimension ${d}`);
    return [d, numerator[d] / denominator[d]];
  }));
  return {profile, numerator, denominator, selected};
}

export function rankRoles(config, profile) {
  // E is deliberately absent: presentation/initiative cannot change the role.
  const v = config.coreDimensions.map(d => profile[d]);
  const norm = Math.hypot(...v);
  return config.roles.map((r, index) => {
    const score = dot(v, unit(r.prototype));
    return {roleId: r.id, score, cosine: norm > config.scoring.epsilon ? score / norm : 0, index};
  }).sort((a, b) => b.score - a.score || a.index - b.index);
  // The index only orders presentation. resolveRole NEVER uses it to settle a tie.
}

export function resolveRole(config, ranked, tieOptionId) {
  const max = ranked[0].score;
  const tied = ranked.filter(r => max - r.score <= config.scoring.epsilon).map(r => r.roleId);
  if (tied.length === 1) return {roleId: tied[0], tiedRoleIds: [], resolution: 'primary_scores'};
  if (tieOptionId === undefined) return {roleId: null, tiedRoleIds: tied, resolution: 'needs_role_tiebreak'};
  const opt = config.tieBreakers.role.options.find(o => o.id === tieOptionId);
  if (!opt) throw new Error('Invalid T_ROLE answer');
  const v = config.coreDimensions.map(d => opt.scores[d] ?? 0);
  const rankedTie = tied.map(id => {
    const r = config.roles.find(r => r.id === id);
    return {id, projection: dot(v, unit(r.prototype))};
  }).sort((a, b) => b.projection - a.projection);
  if (rankedTie.length > 1 && Math.abs(rankedTie[0].projection - rankedTie[1].projection) <= config.scoring.epsilon) throw new Error('T_ROLE must uniquely resolve tied candidates');
  return {roleId: rankedTie[0].id, tiedRoleIds: tied, resolution: 'role_tiebreak'};
}

export function resolveSubtype(config, value, tieOptionId) {
  if (value > config.scoring.epsilon) return {subtype: 'A', resolution: 'style_score'};
  if (value < -config.scoring.epsilon) return {subtype: 'B', resolution: 'style_score'};
  if (tieOptionId === undefined) return {subtype: null, resolution: 'needs_style_tiebreak'};
  const o = config.tieBreakers.style.options.find(o => o.id === tieOptionId);
  if (!o) throw new Error('Invalid T_STYLE answer');
  return {subtype: o.subtype, resolution: 'style_tiebreak'};
}

export function scoreQuiz(config, answers, tieAnswers = {}) {
  if (!answers || typeof answers !== 'object' || Array.isArray(answers)) throw new Error('answers must be an object keyed by stable question ID');
  const qmap = new Map(config.questions.map(q => [q.id, q]));
  for (const [qid, oid] of Object.entries(answers)) {
    if (!qmap.has(qid)) throw new Error(`Unknown question ${qid}`);
    if (!qmap.get(qid).options.some(o => o.id === oid)) throw new Error(`Unknown option ${qid}.${oid}`);
  }
  for (const [tid, oid] of Object.entries(tieAnswers)) {
    const t = [config.tieBreakers.role, config.tieBreakers.style].find(t => t.id === tid);
    if (!t || !t.options.some(o => o.id === oid)) throw new Error(`Invalid tiebreak answer ${tid}`);
  }
  const missing = config.questions.filter(q => !Object.hasOwn(answers, q.id)).map(q => q.id);
  if (missing.length) return {status: 'incomplete', version: config.version, missingQuestionIds: missing};
  const aggregate = aggregateProfile(config, answers);
  const {profile, selected, denominator} = aggregate;
  const ranked = rankRoles(config, profile);
  const role = resolveRole(config, ranked, tieAnswers.T_ROLE);
  const subtype = resolveSubtype(config, profile[config.styleDimension], tieAnswers.T_STYLE);
  const pending = [];
  if (role.roleId === null) pending.push('T_ROLE');
  if (subtype.subtype === null) pending.push('T_STYLE');
  if (pending.length) return {status: 'needs_tiebreak', version: config.version, pendingQuestionIds: pending, profile, rankedRoles: ranked, roleResolution: role, subtypeResolution: subtype};
  const definition = config.roles.find(r => r.id === role.roleId);
  const runner = ranked.find(r => r.roleId !== role.roleId);
  const own = ranked.find(r => r.roleId === role.roleId);
  const norm = Math.hypot(...config.coreDimensions.map(d => profile[d]));
  const signalStrength = norm / Math.sqrt(config.coreDimensions.length);
  const cosineGap = norm > config.scoring.epsilon ? Math.max(0, (own.score - runner.score) / norm) : 0;
  const mixed = role.resolution === 'role_tiebreak' || signalStrength < config.scoring.lowSignalThreshold || cosineGap < config.scoring.nearGap;
  const secondaryRoleIds = ranked.filter(r => r.roleId !== role.roleId && (mixed || (own.cosine - r.cosine <= config.scoring.nearGap))).slice(0, 2).map(r => r.roleId);
  const primaryUnit = unit(definition.prototype);
  const runnerUnit = unit(config.roles.find(r => r.id === runner.roleId).prototype);
  const explanations = selected.map(s => ({
    questionId: s.questionId, optionId: s.optionId, text: s.text, interpretation: s.interpretation,
    contrastContribution: config.coreDimensions.reduce((sum, d, i) => sum + (s.centered[d] ?? 0) / denominator[d] * (primaryUnit[i] - runnerUnit[i]), 0)
  })).filter(e => e.contrastContribution > config.scoring.epsilon).sort((a, b) => b.contrastContribution - a.contrastContribution || a.questionId.localeCompare(b.questionId)).slice(0, 3);
  return {
    status: 'complete', version: config.version, roleId: role.roleId, subtype: subtype.subtype,
    typeId: `${definition.code}-${subtype.subtype}`, title: `${definition.name}·${definition.subtypes[subtype.subtype].title}`,
    profile, rankedRoles: ranked, secondaryRoleIds, signalStrength, cosineGap,
    tendencyLabel: mixed ? '混合倾向' : '相对鲜明',
    roleResolution: role.resolution, subtypeResolution: subtype.resolution,
    tiedRoleIds: role.tiedRoleIds, explanations
  };
}
