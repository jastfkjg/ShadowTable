"use strict";
const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const vm = require("node:vm");

function client(api, offset = 0) {
  const source = fs.readFileSync(
    require.resolve("../server/admin/app.js"),
    "utf8",
  );
  const context = { api, offset };
  vm.runInNewContext(
    source.slice(
      source.indexOf("async function currentRoomCodes"),
      source.indexOf("async function refresh()"),
    ) + ";this.client = { currentRoomCodes, fetchAudit };",
    context,
  );
  return context.client;
}

test("房间选择使用现有房间接口，包含概览其他页且不依赖历史日志", async () => {
  const pages = [
    {
      rooms: Array.from({ length: 50 }, (_, i) => ({
        code: String(100000 + i),
      })),
      total: 51,
    },
    { rooms: [{ code: "200000" }], total: 51 },
  ];
  const c = client(async (path) => {
    assert.equal(path, "rooms?offset=0");
    return pages[0];
  }, 50);
  const codes = await c.currentRoomCodes(pages[1]);
  assert.equal(codes.length, 51);
  assert.ok(codes.includes("100000"));
  assert.ok(codes.includes("200000"));
});

test("旧接口的账号创建记录在分页前过滤，数量和后续页保持准确", async () => {
  const groups = Array.from({ length: 45 }, (_, i) => ({
    key: String(i),
    entries: [{ action: i < 22 ? "actor" : "player" }],
  }));
  const c = client(async (path) => {
    const start = Number(
      new URL(path, "http://localhost").searchParams.get("offset"),
    );
    return { groups: groups.slice(start, start + 20), total: 45, pageSize: 20 };
  });
  const first = await c.fetchAudit("123456", 0);
  assert.equal(first.total, 23);
  assert.equal(first.groups.length, 20);
  assert.equal(first.groups[0].key, "22");
  const next = await c.fetchAudit("123456", 20);
  assert.equal(next.total, 23);
  assert.equal(next.groups.length, 3);
  assert.equal(next.groups[0].key, "42");
});

test("旧接口分页前隐藏独立发起组，保留带结算结果的发起事件", async () => {
  const groups = Array.from({ length: 21 }, (_, i) => [
    {
      key: `begin-${i}`,
      entries: [{ details: { command: "beginActivity", phaseKey: "tools", outcomes: [] } }],
    },
    {
      key: `quest-${i}`,
      entries: [{ details: { command: "submit", phaseKey: "quest" } }],
    },
  ]).flat();
  groups.push({
    key: "conversion",
    entries: [{ details: { command: "beginActivity", phaseKey: "tools", outcomes: [{ kind: "conversion" }] } }],
  });
  const c = client(async (path) => {
    const start = Number(new URL(path, "http://localhost").searchParams.get("offset"));
    return { filtered: true, groups: groups.slice(start, start + 20), total: groups.length, pageSize: 20 };
  });
  const first = await c.fetchAudit("123456", 0);
  assert.equal(first.total, 22);
  assert.equal(first.groups.length, 20);
  assert.ok(first.groups.every((group) => group.key.startsWith("quest-")));
  const next = await c.fetchAudit("123456", 20);
  assert.deepEqual(Array.from(next.groups, (group) => group.key), ["quest-20", "conversion"]);
});

test("新版接口保留服务端分页，不额外读取全部日志", async () => {
  let calls = 0;
  const result = { filtered: true, displayFiltered: true, groups: [], total: 100, pageSize: 20 };
  const c = client(async () => {
    calls++;
    return result;
  });
  assert.equal(await c.fetchAudit("123456", 20), result);
  assert.equal(calls, 1);
});

function auditRenderer() {
  function node(tag, text = "", className = "") {
    return {
      tag,
      text,
      className,
      children: [],
      append(...items) {
        this.children.push(...items);
      },
      replaceChildren() {
        this.children = [];
      },
    };
  }
  const elements = new Map();
  const context = {
    $: (id) => {
      if (!elements.has(id)) elements.set(id, node("div"));
      return elements.get(id);
    },
    el: node,
    document: { createTextNode: (text) => node("text", text) },
    labels: { login: "管理员登录" },
    auditOffset: 0,
  };
  const source = fs.readFileSync(
    require.resolve("../server/admin/app.js"),
    "utf8",
  );
  vm.runInNewContext(
    source.slice(
      source.indexOf("function redundantBeginGroup("),
      source.indexOf("async function refresh()"),
    ) + source.slice(
      source.indexOf("function renderAudit("),
      source.indexOf("function renderRoomOptions("),
    ) + ";this.render = renderAudit;",
    context,
  );
  const flatten = (n) => [n, ...n.children.flatMap(flatten)];
  return {
    render: context.render,
    nodes: () => flatten(elements.get("audit")),
  };
}

test("操作记录显示行动当时身份和发起时间，不重复显示局轮，合并技能跳过", () => {
  const c = auditRenderer();
  const startedAt = new Date("2026-09-19T02:44:00Z").getTime();
  const actor = { seat: 1, name: "zzz", role: "魔术师", required: true };
  c.render({
    groups: [
      {
        active: false,
        entries: [
          {
            created: startedAt + 90000,
            details: {
              game: 1,
              round: 2,
              stage: "s1",
              phaseKey: "skillPrepare",
              phase: "同时秘密使用技能",
              activityStartedAt: startedAt,
              participants: [{ ...actor, role: "红猎人" }],
              player: { seat: 2, name: "other", role: "忠臣" },
              command: "submit",
              value: "pass",
            },
          },
          {
            created: startedAt + 30000,
            details: {
              game: 1,
              round: 2,
              stage: "s1",
              phaseKey: "skillPrepare",
              phase: "同时秘密使用技能",
              activityStartedAt: startedAt,
              participants: [actor],
              player: actor,
              command: "submit",
              choice: "秘密换号 3号 ↔ 4号",
            },
          },
        ],
      },
    ],
    total: 1,
    pageSize: 20,
  });
  const nodes = c.nodes();
  const text = nodes.map((n) => n.text).join(" ");
  assert.match(text, /1号·zzz·魔术师/);
  assert.doesNotMatch(text, /zzz·红猎人|2号·other|明细/);
  assert.doesNotMatch(text, /第\s*\d+\s*[局轮]|操作 #/);
  assert.match(text, /未使用技能／确认：2号/);
  assert.equal(
    nodes.find((n) => n.tag === "time").text,
    "发起于 " + new Date(startedAt).toLocaleString(),
  );
  assert.ok(!nodes.some((n) => ["details", "summary"].includes(n.tag)));
});

test("旧记录不猜身份，时间取首次记录；管理员操作保留简短说明", () => {
  const c = auditRenderer();
  c.render({
    groups: [
      {
        entries: [
          {
            created: 3000,
            details: {
              stage: "s1",
              phase: "技能",
              game: 1,
              player: { seat: 1, name: "旧玩家" },
              command: "submit",
              value: "target:2",
              choice: "对 2号开刀",
            },
          },
          { created: 1000, details: { stage: "s1", phase: "技能", game: 1 } },
        ],
      },
      {
        entries: [
          { created: 4000, action: "login", reason: "测试登录", details: {} },
        ],
      },
    ],
    total: 2,
    pageSize: 20,
  });
  const nodes = c.nodes();
  assert.match(nodes.map((n) => n.text).join(" "), /1号·旧玩家·身份未记录/);
  assert.equal(
    nodes.find((n) => n.tag === "time").text,
    "记录于 " + new Date(1000).toLocaleString(),
  );
  assert.match(nodes.map((n) => n.text).join(" "), /管理员登录 · 测试登录/);
});

function actionClient(api) {
  const elements = new Map();
  const $ = (id) => {
    if (!elements.has(id))
      elements.set(id, {
        textContent: "",
        disabled: false,
        open: false,
        handlers: {},
        reset() {},
        focus() {},
        addEventListener(name, fn) {
          this.handlers[name] = fn;
        },
        showModal() {
          this.open = true;
        },
        close() {
          this.open = false;
          this.handlers.close?.();
        },
      });
    return elements.get(id);
  };
  const messages = [];
  const context = {
    $,
    api,
    actionBusy: false,
    loading: false,
    pending: null,
    labels: {
      "test-on": "开启陪测",
      "clear-testers": "清理陪测座位",
      "test-off": "关闭陪测",
      terminate: "终止对局",
      rematch: "同房重开",
      delete: "删除房间",
    },
    refresh: async () => {},
    feedback: (text) => messages.push(text),
  };
  const source = fs.readFileSync(
    require.resolve("../server/admin/app.js"),
    "utf8",
  );
  vm.runInNewContext(
    source.slice(
      source.indexOf("function openAction("),
      source.indexOf('$("refresh").addEventListener'),
    ) + ";this.open = openAction;",
    context,
  );
  return {
    $,
    messages,
    open: context.open,
    submit: () => $("action-form").handlers.submit({ preventDefault() {} }),
  };
}

test("开启和清理直接发送，不弹确认；请求中拦截重复点击并恢复状态", async () => {
  for (const action of ["test-on", "clear-testers"]) {
    const calls = [];
    let finish;
    const c = actionClient((path, body) => {
      calls.push({ path, body });
      return new Promise((resolve) => {
        finish = resolve;
      });
    });
    const room = { code: "123456", stage: "s1" };
    const request = c.open(room, action);
    c.open(room, action);
    assert.equal(calls.length, 1);
    assert.equal(calls[0].body.action, action);
    assert.equal(calls[0].body.stage, "s1");
    assert.equal(calls[0].body.confirm, undefined);
    assert.equal(c.$("confirm-dialog").open, false);
    assert.equal(c.$("rooms").inert, true);
    finish({ ok: true });
    await request;
    assert.equal(c.$("rooms").inert, false);
    assert.equal(c.$("refresh").disabled, false);
    assert.match(c.messages.at(-1), /完成/);
  }
});

test("终止重开删除和关闭陪测可取消，仅点击确认后发送布尔确认", async () => {
  for (const action of ["terminate", "rematch", "delete", "test-off"]) {
    const calls = [];
    const c = actionClient(async (path, body) => {
      calls.push({ path, body });
    });
    const room = { code: "123456", stage: "s1" };
    c.open(room, action);
    assert.equal(calls.length, 0);
    assert.equal(c.$("confirm-dialog").open, true);
    c.$("cancel").handlers.click();
    await c.submit();
    assert.equal(calls.length, 0);
    c.open(room, action);
    await c.submit();
    assert.equal(calls.length, 1);
    assert.equal(calls[0].body.confirm, true);
    assert.equal(c.$("confirm-dialog").open, false);
  }
});

test("直接执行失败时展示错误并允许重试", async () => {
  let calls = 0;
  const c = actionClient(async () => {
    if (++calls === 1) throw new Error("房间状态已变化");
  });
  const room = { code: "123456", stage: "s1" };
  await c.open(room, "clear-testers");
  assert.match(c.messages.at(-1), /房间状态已变化/);
  assert.equal(c.$("rooms").inert, false);
  await c.open(room, "clear-testers");
  assert.equal(calls, 2);
});

function scoringClient(api) {
  const elements = new Map(), inputs = [], confirmations = [];
  const node = (tag = 'div', textContent = '') => ({
    tag, textContent, value: '', dataset: {}, children: [], disabled: false, listeners: {}, attributes: {},
    append(...items) { this.children.push(...items); }, replaceChildren(...items) { this.children = items; },
    addEventListener(type, fn) { this.listeners[type]=fn; }, setAttribute(key,value) { this.attributes[key]=value; }, focus() { this.focused=true; }, querySelector() { return this.children.find(n => n.tag === 'small'); },
    querySelectorAll() { return inputs; },
  });
  const $ = id => { if (!elements.has(id)) elements.set(id, node()); return elements.get(id); };
  const source = fs.readFileSync(require.resolve('../server/admin/app.js'), 'utf8');
  const context = { $, el: node, api, crypto: require('node:crypto'),
    window: { confirm: message => { confirmations.push(message); return true; } },
    document: { querySelectorAll: () => inputs },
    correctionMatches: [], correctionBusy: false, correctionPending: null, correctionLoading: false,
    correctionMatch: () => context.match, selectOptions() {},
  };
  vm.runInNewContext(source.slice(source.indexOf('let scorePlayers=[]')) + `
    this.test = { submitScoreWrite, loadMatchScores, searchScorePlayers, updatePlayerScorePreview,
      player(p) { scorePlayers=[p]; selectedScorePlayer=p; $('score-player').value=p.uid; },
      match(m) { matchScoreDetail=m; },
      pending() { return scoreWritePending; }, detail() { return matchScoreDetail; }
    };`, context);
  return { ...context.test, $, inputs, context, confirmations };
}
test('积分提交断网后锁住原请求，重试复用编号和数据，成功后刷新总分；版本冲突可重新查询', async () => {
  const writes=[];let attempts=0;
  const c=scoringClient(async (path,body)=>{
    if(body) { writes.push(structuredClone(body)); if (++attempts===1) throw Error('网络中断'); return {revision:2}; }
    return { points:9,matchPoints:4,manualPoints:5,revision:2,adjustments:{records:[],hasMore:false} };
  });
  c.player({uid:'wx:1',name:'林间',points:4,revision:1});
  c.$('player-score-points').value='5';c.$('player-score-mode').value='delta';
  await c.submitScoreWrite('player');assert.ok(c.pending());assert.equal(c.$('player-score-points').disabled,true);
  assert.equal(c.$('match-score-submit').disabled,true);assert.match(c.$('player-score-status').textContent,/重试/);
  c.$('player-score-points').value='100';await c.submitScoreWrite('player');
  assert.deepEqual(writes[0],writes[1]);assert.equal(c.confirmations.length,1);assert.equal(c.pending(),null);
  assert.equal(c.$('score-total').textContent,9);assert.equal(c.$('player-score-points').value,'');
  assert.ok(!Object.hasOwn(writes[0],'reason'));
  c.context.api=async()=>{throw Object.assign(Error('玩家积分已变化'),{status:409});};
  c.$('player-score-points').value='1';await c.submitScoreWrite('player');
  assert.equal(c.pending(),null);assert.equal(c.$('score-player-query').disabled,false);
});
test('单局改分只提交有变化的玩家与自动恢复选项，迟到的对局明细不覆盖当前选择', async () => {
  const players=[{uid:'a',seat:1,name:'甲',editable:true,score:{total:4}},{uid:'b',seat:2,name:'乙',editable:true,score:{total:3}}];
  const writes=[],c=scoringClient(async(path,body)=>{if(body)writes.push(structuredClone(body));return {id:'m',revision:1,players};});
  c.context.match={id:'m',options:[]};c.match({id:'m',revision:0,players});
  c.inputs.push({dataset:{scoreUid:'a'},value:'8'},{dataset:{scoreUid:'b',reset:'true'},value:''});
  await c.submitScoreWrite('match');assert.deepEqual(writes[0].scores,[{uid:'a',points:8},{uid:'b',points:null}]);
  assert.ok(!Object.hasOwn(writes[0],'reason'));
  let resolveOld,resolveNew;
  c.context.api=path=>new Promise(resolve=>{if(path.includes('/old/'))resolveOld=resolve;else resolveNew=resolve;});
  c.context.match={id:'old',options:[]};const old=c.loadMatchScores();c.context.match={id:'new',options:[]};const latest=c.loadMatchScores();
  resolveNew({id:'new',revision:3,players:[]});await latest;resolveOld({id:'old',revision:2,players:[]});await old;
  assert.equal(c.detail().id,'new');
});
test('积分标签支持键盘切换且保留草稿，增减和设置显示各自结果预览', () => {
  const c=scoringClient(async()=>{});
  c.player({uid:'wx:1',name:'林间',points:12,revision:0});
  c.$('player-score-points').value='-5';c.$('player-score-mode').value='delta';c.updatePlayerScorePreview();
  assert.equal(c.$('player-score-preview').textContent,'总积分 12 → 7 分');
  c.$('score-tab-player').listeners.keydown({key:'ArrowRight',preventDefault(){}});
  assert.equal(c.$('score-tab-match').attributes['aria-selected'],'true');
  assert.equal(c.$('player-score-section').hidden,true);assert.equal(c.$('score-tab-match').focused,true);
  c.$('score-tab-match').listeners.keydown({key:'Home',preventDefault(){}});
  assert.equal(c.$('player-score-section').hidden,false);assert.equal(c.$('player-score-points').value,'-5');
  c.$('player-score-mode').value='set';c.updatePlayerScorePreview();
  assert.equal(c.$('player-score-preview').textContent,'总积分 12 → -5 分');
});
test('玩家查询失败后清除旧编辑目标，不把改分提交给上一次玩家',async()=>{
  let writes=0;const c=scoringClient(async(path,body)=>{if(body)writes++;throw Error('读取失败');});
  c.player({uid:'wx:old',name:'旧玩家',points:9,revision:0});c.$('score-player-query').value='新玩家';
  await c.searchScorePlayers();assert.equal(c.$('player-score-editor').hidden,true);assert.equal(c.$('player-score-submit').disabled,true);
  await c.submitScoreWrite('player');assert.equal(writes,0);assert.match(c.$('player-score-status').textContent,/读取失败/);
});
test('自定义确认弹窗取消不提交，等待确认时更换玩家不把旧分值写给新玩家',async()=>{
  let writes=0,resolveConfirmation;
  const c=scoringClient(async(path,body)=>{if(body)writes++;});
  c.context.window.AdminUI={confirm:()=>new Promise(resolve=>{resolveConfirmation=resolve;})};
  c.player({uid:'old',name:'旧玩家',points:5,revision:0});
  c.$('player-score-points').value='7';c.$('player-score-mode').value='delta';
  const canceled=c.submitScoreWrite('player');
  assert.equal(writes,0);resolveConfirmation(false);await canceled;
  assert.equal(writes,0);assert.equal(c.pending(),null);
  const stale=c.submitScoreWrite('player');
  c.player({uid:'new',name:'新玩家',points:20,revision:1});
  resolveConfirmation(true);await stale;
  assert.equal(writes,0);assert.equal(c.pending(),null);
});
test('管理员不计分对局更正提交趣味目标与带刀人，失败重试保持原数据，筛掉已出局玩家',async()=>{
  const source=fs.readFileSync(require.resolve('../server/admin/app.js'),'utf8'),elements=new Map(),writes=[];
  const node=(tag='div',textContent='')=>({tag,textContent,value:'',children:[],listeners:{},replaceChildren(...rows){this.children=rows;},addEventListener(type,fn){this.listeners[type]=fn;}});
  const $=id=>{if(!elements.has(id))elements.set(id,node());return elements.get(id);};
  const match={id:'m',revision:0,correctionKind:'fun',needsActor:true,options:[{id:'early_assassination',requiresTarget:true}],players:[{seat:1,name:'甲'},{seat:2,name:'乙'},{seat:3,name:'出局',alive:false}]};
  let attempts=0;
  const context={$,el:node,crypto:require('node:crypto'),window:{confirm:()=>true},scoreBusy:false,scoreWritePending:null,matchScoreLoading:false,matchScoreSequence:0,selectedScorePlayer:null,lockScoreControls(){},loadMatchScores(){},loadPlayerScore(){},api:async(path,body)=>{if(body){writes.push(structuredClone(body));if(++attempts===1)throw Error('网络中断');return {revision:1,winner:'good'};}return {matches:[{...match,revision:1}]};}};
  vm.runInNewContext(source.slice(source.indexOf('let correctionMatches ='),source.indexOf('let scorePlayers=[]'))+';this.setMatch=m=>{correctionMatches=[m];};this.target=updateCorrectionTarget;this.refreshMatch=updateCorrectionMatch;',context);
  context.setMatch(match);$('correction-match').value='m';context.refreshMatch();
  assert.ok(!$('correction-target').children.some(row=>row.value==='3'));assert.ok(!$('correction-actor').children.some(row=>row.value==='3'));
  $('correction-result').value='early_assassination';context.target();assert.equal($('correction-actor-row').hidden,false);
  $('correction-target').value='1';$('correction-actor').value='2';$('correction-code').value='123456';
  const submit=$('correction-form').listeners.submit;await submit({preventDefault(){}});assert.match($('correction-submit').textContent,/重试/);
  $('correction-target').value='0';await submit({preventDefault(){}});assert.deepEqual(writes[0],writes[1]);assert.equal(writes[0].funTarget,1);assert.equal(writes[0].funActor,2);assert.ok(!Object.hasOwn(writes[0],'scoreTarget'));assert.match($('correction-status').textContent,/趣味记录/);
  assert.ok(!Object.hasOwn(writes[0],'reason'));
});

test("任务复盘只显示任务队员及未提交者，并突出保存的票数与结算结果", () => {
  const c = auditRenderer();
  const participants = [
    { seat: 1, name: "房主", role: "忠臣", required: false },
    { seat: 2, name: "队员乙", role: "刺客", required: true },
    { seat: 3, name: "队员丙", role: "忠臣", required: true },
    { seat: 4, name: "围观队员", role: "梅林", required: false },
  ];
  const context = {
    phaseKey: "quest",
    phase: "任务出牌",
    stage: "q",
    game: 2,
    round: 3,
    auditVersion: 2,
    team: [2, 3],
    participants,
  };
  c.render({
    groups: [
      {
        active: true,
        entries: [
          {
            id: 1,
            created: 1,
            details: {
              ...context,
              command: "beginActivity",
              label: "发起任务出牌",
              player: participants[0],
            },
          },
          {
            id: 2,
            created: 2,
            details: {
              ...context,
              command: "submit",
              value: "fail",
              choice: "失败",
              player: participants[1],
            },
          },
        ],
      },
    ],
    total: 1,
    pageSize: 20,
  });
  let text = c
    .nodes()
    .map((node) => node.text)
    .join(" ");
  assert.match(text, /队员乙·刺客.*失败/);
  assert.match(text, /队员丙·忠臣.*未提交/);
  assert.match(text, /进行中 · 已提交 1\/2/);
  assert.doesNotMatch(text, /围观队员|无需操作|未记录操作/);
  c.render({
    groups: [
      {
        active: false,
        entries: [
          {
            id: 1,
            created: 1,
            details: {
              ...context,
              command: "submit",
              value: "fail",
              choice: "失败",
              player: participants[1],
            },
          },
          {
            id: 2,
            created: 2,
            details: {
              ...context,
              command: "submit",
              value: "success",
              choice: "成功",
              player: participants[2],
              outcomes: [
                {
                  kind: "quest",
                  text: "任务失败",
                  lines: ["成功牌 1 张 · 失败牌 1 张 · 失败门槛 1 张"],
                },
              ],
            },
          },
        ],
      },
    ],
    total: 1,
    pageSize: 20,
  });
  text = c
    .nodes()
    .map((node) => node.text)
    .join(" ");
  assert.match(text, /任务失败.*成功牌 1 张 · 失败牌 1 张 · 失败门槛 1 张/);
  assert.doesNotMatch(text, /房主|围观队员|未提交|未记录结算/);
  assert.equal(
    c.nodes().filter((node) => node.className === "audit-result").length,
    1,
  );
});

test("入座和重开只显示行动者，隐藏单独发起记录，重复准备保留时间顺序", () => {
  const c = auditRenderer();
  const actor = { seat: 1, name: "房主" };
  const participants = [actor, { seat: 2, name: "其他玩家", required: false }];
  c.render({
    groups: [
      {
        entries: [
          {
            id: 3,
            created: 3,
            details: {
              phaseKey: "lobby",
              phase: "入座与准备",
              player: actor,
              participants,
              command: "ready",
              parameters: { ready: true },
            },
          },
          {
            id: 2,
            created: 2,
            details: {
              phaseKey: "lobby",
              phase: "入座与准备",
              player: actor,
              participants,
              command: "ready",
              parameters: { ready: false },
            },
          },
          {
            id: 1,
            created: 1,
            details: {
              phaseKey: "lobby",
              phase: "入座与准备",
              player: actor,
              participants,
              command: "ready",
              parameters: { ready: true },
            },
          },
        ],
      },
      {
        entries: [
          {
            created: 4,
            details: {
              phaseKey: "ended",
              phase: "对局结束",
              player: actor,
              participants,
              command: "rematch",
              label: "同房重开",
            },
          },
        ],
      },
      {
        entries: [
          {
            created: 5,
            details: {
              phaseKey: "tools",
              phase: "等待房主发起操作",
              player: actor,
              participants,
              command: "beginActivity",
              label: "发起操作",
              parameters: { kind: "quest" },
            },
          },
        ],
      },
    ],
    total: 3,
    pageSize: 20,
  });
  const nodes = c.nodes();
  assert.deepEqual(
    nodes.filter((node) => node.tag === "h3").map((node) => node.text),
    ["入座与准备", "同房重开"],
  );
  assert.doesNotMatch(
    nodes.map((node) => node.text).join(" "),
    /其他玩家|无需操作|等待房主发起操作|对局结束|发起任务出牌/,
  );
  const actions = nodes
    .filter((node) => node.tag === "text")
    .map((node) => node.text.trim());
  assert.deepEqual(actions.slice(0, 3), ["已准备", "取消准备", "已准备"]);
});

test("发起时已有结算结果仍显示结果，不重复显示发起动作", () => {
  const c = auditRenderer();
  c.render({
    groups: [{
      entries: [{
        created: 1000,
        details: {
          command: "beginActivity",
          phaseKey: "tools",
          phase: "等待房主发起操作",
          parameters: { kind: "conversion" },
          label: "发起阵营转换",
          outcomes: [{ kind: "conversion", text: "本轮阵营转换", lines: ["2号·乙 → 坏人"] }],
        },
      }],
    }],
    total: 1,
    pageSize: 20,
  });
  const nodes = c.nodes();
  assert.deepEqual(nodes.filter((node) => node.tag === "h3").map((node) => node.text), ["阵营转换"]);
  const text = nodes.map((node) => node.text).join(" ");
  assert.match(text, /本轮阵营转换.*2号·乙 → 坏人/);
  assert.doesNotMatch(text, /发起阵营转换|第\s*\d+\s*[局轮]/);
});

test("提前截止保留缺交玩家和处理方式，作废操作不冒充任务结果", () => {
  const c = auditRenderer();
  const participants = [
    { seat: 2, name: "缺交玩家", role: "忠臣", required: true },
  ];
  c.render({
    groups: [
      {
        active: false,
        entries: [
          {
            created: 1,
            details: {
              phaseKey: "quest",
              phase: "任务出牌",
              stage: "q",
              participants,
              team: [2],
              command: "closeWaiting",
              label: "提前结束等待",
              earlyClosed: true,
              skippedSeats: [2],
              outcomes: [
                {
                  kind: "cancel",
                  text: "本次操作已作废",
                  lines: ["本次不产生结算结果。"],
                },
              ],
            },
          },
        ],
      },
    ],
    total: 1,
    pageSize: 20,
  });
  const text = c
    .nodes()
    .map((node) => node.text)
    .join(" ");
  assert.match(text, /缺交玩家·忠臣.*未提交（操作已作废）/);
  assert.match(text, /本次操作已作废/);
  assert.doesNotMatch(text, /任务成功|旧记录未保存|未记录结算/);
});
