const api = require("../../api");

Page({
  data: {
    boards: [],
    boardsExpanded: false,
    loadingBoards: true,
    boardError: "",
    sections: [
      { id: "host", title: "我是房主", subtitle: "从建桌到再开一局", expanded: false, items: [
        { title: "1. 建桌与邀请", text: "选择人数和板子，填写桌上昵称。朋友可通过邀请或 6 位房间码加入；满座后加入的人会先围观。" },
        { title: "2. 入座与发牌", text: "准备阶段可以换座。座位坐满、入座玩家全员准备后，房主发放身份；每位玩家在自己的手机上查看并确认。" },
        { title: "3. 按现场进度发起操作", text: "线下组织讨论，再按需发起组队投票、任务或板子技能。任务需选择队员和失败票门槛；提交收齐后自动结算。" },
        { title: "4. 结束与重开", text: "最终刀梅林在线下进行，房主手动结束本局。小程序不会因三次任务成功或失败、连续否决自动结束整局；结束后可在同一牌桌重新准备。" },
        { title: "有人迟迟未提交怎么办？", text: "先提醒对方查看当前操作。房主也可确认后结束等待：未提交的投票记弃权，可选技能按本次不使用处理，任务或必选目标操作会作废。操作前请阅读确认提示。" },
      ] },
      { id: "basics", title: "阿瓦隆基础入门", subtitle: "先分清身份、投票与任务", expanded: false, items: [
        { title: "阵营与胜负", text: "经典阿瓦隆中，好人争取完成三次任务，并保护梅林不被刺客认出；坏人争取破坏三次任务，或在好人完成三次任务后刺中梅林。经典规则中连续五次组队被否决也会使坏人获胜。扩展板可能有不同条件，请以对应板子规则为准。" },
        { title: "身份与视野", text: "身份决定你的阵营和能力；视野是规则允许你知道的线索，不代表你能看到所有人的真实身份。请私下查看身份，再在线下讨论、推理。" },
        { title: "组队投票：同意谁去做任务", text: "由全体参与玩家表决是否接受队伍。组队票在结算后公开，可以回看各人的票型。它不是任务的成功或失败牌。" },
        { title: "任务出牌：这次任务是否成功", text: "只有被选中的队员提交任务牌。任务仅展示汇总，不公开每张牌是谁出的；失败票达到房主设置的门槛才算任务失败。可出的牌以身份和板子规则为准。" },
        { title: "什么是板子？", text: "板子是一套角色配置和玩法规则。同样的人数也可能有不同板子；新玩家可以先熟悉经典基础，再尝试逆仆、影中执刃、混沌契约或十二骑士。" },
      ] },
      { id: "faq", title: "常见问题", subtitle: "准备、隐私与连接恢复", expanded: false, items: [
        { title: "为什么不能发牌？", text: "请确认座位已坐满，且所有入座玩家都点了准备。只有房主可以发牌，围观玩家不参与本局发牌。" },
        { title: "为什么我本次不用操作？", text: "不同操作只等待对应玩家，例如任务只需队员出牌，部分技能只由对应身份使用。以页面的当前操作提示为准。" },
        { title: "房主能看到我的身份和秘密票吗？", text: "房主也是玩家，不能查询全员身份或秘密提交内容，只能查看完成进度。组队票结算后公开，任务牌仅公开汇总。十二骑士可由房主设置是否公开已结算技能过程，新牌身份仍仅本人可见。" },
        { title: "为什么身份又被遮住了？", text: "这是隐私保护。切到后台后会清除私密展示，回来后需要主动重新查看。请确认周围无人查看再揭示身份。" },
        { title: "断线或退出小程序后怎么回来？", text: "检查网络并按页面提示重试，重新打开后从“我的牌桌”找回房间。提交结果尚未确认时，请按提示重试原请求，避免重复操作。" },
        { title: "回首页、切换牌桌会退出对局吗？", text: "不会，当前座位会保留，可从“我的牌桌”返回。准备阶段可离席，房主也可在房间设置中转交管理权。" },
        { title: "为什么任务结束后没有自动进入下一步？", text: "桌边助手按需提供工具，由房主根据线下讨论发起下一项操作，并手动结束整局。最终刀梅林在线下完成。" },
      ] },
    ],
  },
  onLoad() {
    this.alive = true;
    this.loadBoards();
  },
  onUnload() { this.alive = false; },
  async loadBoards() {
    if (this.fetchingBoards) return;
    this.fetchingBoards = true;
    this.setData({ loadingBoards: true, boardError: "" });
    try {
      const { boards } = await api.request("/api/boards");
      if (!this.alive) return;
      const groups = new Map();
      for (const board of (boards || []).filter(b => b.available)) {
        const classic = ["classic", "classic-court", "classic-11"].includes(board.id);
        const knights = ["knights", "knights-10", "knights-11"].includes(board.id);
        const id = classic ? "classic" : knights ? "knights" : board.id;
        if (!groups.has(id)) groups.set(id, {
          id,
          name: classic ? "阿瓦隆 · 经典基础" : knights ? "阿瓦隆 · 十二骑士" : board.name,
          description: classic
            ? "按人数配置经典角色；9人、11人含逆仆，12人含双奥伯伦。"
            : knights ? "同时秘密提交技能、同时生效，支持B牌复活；10、11、12人局的角色配置不同，技能规则相同。" : board.description,
          choices: [],
        });
        groups.get(id).choices.push(...board.counts.map(capacity => ({
          board: board.id,
          capacity,
          label: `${capacity}人${classic && [9, 11].includes(capacity) ? ' · 逆仆' : ''}`,
        })));
      }
      this.setData({ boards: [...groups.values()].map(group => ({
        ...group, choices: group.choices.sort((a, b) => a.capacity - b.capacity),
      })) });
    } catch (error) {
      if (this.alive) this.setData({ boardError: "板子介绍暂时未加载，请检查网络后重试。其他帮助内容仍可阅读。" });
    } finally {
      this.fetchingBoards = false;
      if (this.alive) this.setData({ loadingBoards: false });
    }
  },
  toggleBoards() {
    this.setData({ boardsExpanded: !this.data.boardsExpanded });
  },
  toggleSection(e) {
    const index = Number(e.currentTarget.dataset.index);
    if (!Number.isInteger(index) || !this.data.sections[index]) return;
    this.setData({ [`sections[${index}].expanded`]: !this.data.sections[index].expanded });
  },
  openBoard(e) {
    const { board, capacity } = e.currentTarget.dataset;
    const valid = this.data.boards.some(group => group.choices.some(c => c.board === board && c.capacity === Number(capacity)));
    if (!valid) return;
    wx.navigateTo({ url: `/pages/board-details/board-details?board=${encodeURIComponent(board)}&capacity=${Number(capacity)}&from=help` });
  },
});
