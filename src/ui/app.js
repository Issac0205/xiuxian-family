/** 仙途面板的四项指标。 */
const IMMORTAL_METRICS = [
  ['secrets', '秘闻', '集齐足量秘闻，才能摸到云深谷坊市'],
  ['stones', '灵石', '凡人换来的修行货币'],
  ['qi', '炼气人口', '祛障或天生灵根诞生，每位修士独立管理'],
  ['innate', '天生修士', '上限可达炼气九层'],
  ['pills', '已服祛障丹', '服下多少枚'],
];

/**
 * 通商面板最多画几行在途商队。
 * 位多的时候（几十个驿站）全画出来会把派遣按钮顶到屏幕外，所以截断并提示。
 */
const MAX_CARAVAN_ROWS = 8;

/**
 * 界面层。
 * 只读状态、只发意图，所有改动都交给外部注入的 actions。
 *
 * @param {{ getState: () => object, actions: Record<string, Function> }} deps
 */
function createUI({ getState, actions, rng }) {
  const $ = (id) => document.getElementById(id);
  const state = () => getState();

  /** 答题弹窗：纯展示 + 回传对错，结算逻辑由 actions 负责。 */
  const quizView = createQuizView({
    getState: () => state(),
    onRender: () => render(),
    rng,
  });

  /** @type {Record<string, any>} */
  const cards = {};
  const techRefs = {};
  const techGroups = [];
  const metricRefs = {};
  const routeRefs = {};
  const studyRefs = {};
  const immortalRefs = {};

  let caravanSig = null;
  let caravanRefs = [];
  let logSig = null;
  let wrongBookSig = null;
  let difficultySig = null;
  let speedSig = null;
  let quizModeSig = null;
  let themeSig = null;
  let secretSig = null;
  let collapseSig = null;
  let pageSig = null;
  let resPageSig = null;
  let resRefs = [];

  /** 当前倍速，兜底为 1。 */
  function currentSpeed(s) {
    const v = Number(s?.settings?.speed);
    return v > 0 ? v : 1;
  }

  /**
   * 每一页自己的资源条。
   *
   * 凡人数值（银两／人口／岁入）只在「家业」这一页出现，不做全局常驻——
   * 那是凡人模块的数据，不该在仙途页上也杵着。
   */
  const PAGE_RES = {
    home: [
      ['银两', (s, d) => `${fmt(Math.floor(s.silver))} / ${fmt(d.silverCap)}`],
      ['人口', (s, d) => `${fmt(s.population, 1)} / ${fmt(d.housingCap)}`],
      ['岁入', (s, d) => `${fmt(d.silverPerSec * currentSpeed(s), 2)} 两/秒`],
      ['建筑容量', (s, d) => `${d.usedSlots} / ${d.buildingCap}`],
      ['战力', (s,d) => fmt(d.totalPower,1)],
    ],
    techs: [
      ['银两', (s, d) => `${fmt(Math.floor(s.silver))} / ${fmt(d.silverCap)}`],
      ['已研习', (s) => `${s.techs.length} / ${TECHS.length}`],
    ],
    trade: [
      ['银两', (s, d) => `${fmt(Math.floor(s.silver))} / ${fmt(d.silverCap)}`],
      ['商队', (s, d) => `${d.usedCaravans} / ${d.caravanSlots}`],
      ['秘闻', (s, d) => `${fmt(d.secretCount)} / ${fmt(d.secretGoal)}`],
    ],
    immortal: [
      ['秘闻', (s, d) => `${fmt(d.secretCount)} / ${fmt(d.secretGoal)}`],
      ['灵石', (s, d) => `${fmtStones(d.stones)} 枚`],
      ['炼气人口', (s, d) => `${fmt(d.qi)}`],
      ['家族战力', (s,d) => fmt(d.totalPower,1)],
    ],
    study: [
      ['答题', (s) => `${fmt(studySummary(s).answered)} 题`],
      ['正确率', (s) => { const sum=studySummary(s);return sum.answered?fmtPercent(sum.accuracy,0):'—'; }],
      ['错题', (s) => `${fmt(activeWrongIds(s).length)} 题`],
    ],
  };

  function panelCollapsed(key) {
    return Boolean(state()?.ui?.collapsed?.[key]);
  }

  /* ─────────────────────── 静态结构构建 ─────────────────────── */

  function buildCards() {
    const host = $('building-list');
    host.innerHTML = '';

    for (const def of BUILDINGS) {
      const card = document.createElement('article');
      card.className = `bcard accent-${def.accent}`;
      card.dataset.id = def.id;
      card.title = `${def.name}\n${def.lore}\n每座：${def.perText}`;
      card.innerHTML = `
        <div class="bcard-icon">${def.icon}</div>
        <div class="bcard-main">
          <div class="bcard-title">
            <span class="bcard-name">${def.name}</span>
            <span class="bcard-count" data-role="count">×0</span>
          </div>
          <div class="bcard-tagline">${def.tagline}</div>
          <div class="bcard-effect" data-role="effect"></div>
        </div>
        <div class="bcard-buy">
          <button class="btn buy" data-action="buy" data-id="${def.id}">
            <span class="buy-label" data-role="buylabel">购置</span>
            <span class="buy-cost" data-role="buycost">—</span>
          </button>
          <button class="btn sell" data-action="sell" data-id="${def.id}"
                  title="拆售一座，返还半价。建筑容量有限时用它腾地方。不会触发单词题。">
            <span data-role="selltext">出售</span>
          </button>
          <div class="bcard-per">${def.perText}</div>
        </div>`;
      host.appendChild(card);

      cards[def.id] = {
        root: card,
        count: card.querySelector('[data-role="count"]'),
        effect: card.querySelector('[data-role="effect"]'),
        buy: card.querySelector('button.buy'),
        buyLabel: card.querySelector('[data-role="buylabel"]'),
        buyCost: card.querySelector('[data-role="buycost"]'),
        sell: card.querySelector('button.sell'),
        sellText: card.querySelector('[data-role="selltext"]'),
      };
    }
  }

  function buildTechs() {
    const host = $('tech-list');
    host.innerHTML = '';
    techGroups.length = 0;

    for (const tier of TECH_TIERS) {
      const items = TECHS.filter((t) => t.tier === tier.tier);
      if (!items.length) continue;

      const group = document.createElement('div');
      group.className = 'tech-group';
      const groupIds = items.map((t) => t.id);

      const head = document.createElement('div');
      head.className = 'tech-tier';
      head.innerHTML = `<span class="tier-name">${tier.name}</span><span class="tier-hint">${tier.hint}</span>`;
      group.appendChild(head);

      for (const tech of items) {
        const gains = techGainText(tech, BUILDING_MAP[tech.unlocksBuilding]?.name);
        const row = document.createElement('div');
        row.className = 'tech';
        row.dataset.tech = tech.id;
        row.title = tech.desc;
        row.innerHTML = `
          <div class="tech-mark">${tech.icon}</div>
          <div class="tech-body">
            <div class="tech-title">
              <span class="tech-name">${tech.name}</span>
              <span class="tech-cost" data-role="cost">—</span>
            </div>
            <div class="tech-gain">${gains.join(' · ')}</div>
            <div class="tech-req" data-role="req"></div>
          </div>
          <button class="btn tech-btn" data-action="research" data-tech="${tech.id}">研习</button>`;
        group.appendChild(row);

        techRefs[tech.id] = {
          root: row,
          cost: row.querySelector('[data-role="cost"]'),
          req: row.querySelector('[data-role="req"]'),
          btn: row.querySelector('button.tech-btn'),
        };
      }

      host.appendChild(group);
      techGroups.push({ root: group, ids: groupIds });
    }
  }

  function buildMetricsInto(hostId, refs, defs) {
    const host = $(hostId);
    host.innerHTML = '';
    for (const [id, label, hint] of defs) {
      const row = document.createElement('div');
      row.className = 'metric';
      row.title = hint;
      row.innerHTML = `<span class="m-label">${label}</span><span class="m-value" data-role="v">—</span>`;
      host.appendChild(row);
      refs[id] = row.querySelector('[data-role="v"]');
    }
  }

  function buildMetrics() {
    buildMetricsInto('pop-metrics', metricRefs, [
      ['birth', '出生率', '每秒新增人口比例'],
      ['death', '死亡率', '基础死亡 + 屋舍拥挤'],
      ['net', '净增长', '每秒人口变化'],
      ['total', '累计生 / 卒', '开局至今'],
    ]);
  }

  function buildStudy() {
    buildMetricsInto('study-metrics', studyRefs, [
      ['acc', '正确率', '答对题数 / 总答题数'],
      ['streak', '连续答对', '当前连续 / 历史最佳'],
      ['learned', '已复习题目', '做过的题 / 当前题库总题数'],
      ['weak', '薄弱题', '错次 ≥ 对次的题'],
    ]);
  }

  function buildImmortal() {
    buildMetricsInto('immortal-metrics', immortalRefs, IMMORTAL_METRICS);
  }

  function buildRoutes() {
    const host = $('route-list');
    host.innerHTML = '';

    for (const def of TRADE_ROUTES) {
      const row = document.createElement('div');
      row.className = 'route';
      row.dataset.route = def.id;
      row.title = def.desc;
      row.innerHTML = `
        <div class="route-main">
          <div class="route-icon">${def.icon}</div>
          <div class="route-body">
            <div class="route-title"><span>${def.name}</span></div>
            <div class="route-desc">${def.desc}</div>
            <div class="route-stats">
              <span>本钱 ${fmt(def.cost)}</span>
              <span>${fmtDuration(def.duration)}</span>
              <span class="profit" data-role="profit">—</span>
              <span class="secret" data-role="chance">—</span>
            </div>
          </div>
        </div>
        <div class="route-actions">
          <button class="btn go" data-action="trade" data-route="${def.id}"
                  title="派出一支商队，答一道题。">
            <span class="go-label">派遣 1 队</span>
            <span class="go-sub" data-role="onesub">—</span>
          </button>
          <button class="btn go" data-action="trade-fleet" data-route="${def.id}" data-fleet="half"
                  title="派出可派队数的一半（向上取整），整批只答一道题。">
            <span class="go-label">派遣一半</span>
            <span class="go-sub" data-role="halfsub">—</span>
          </button>
          <button class="btn go" data-action="trade-fleet" data-route="${def.id}" data-fleet="all"
                  title="把空商队位一次派满（受银两限制），整批只答一道题。">
            <span class="go-label">全部派遣</span>
            <span class="go-sub" data-role="allsub">—</span>
          </button>
        </div>`;
      host.appendChild(row);

      routeRefs[def.id] = {
        root: row,
        one: row.querySelector('[data-action="trade"]'),
        half: row.querySelector('[data-fleet="half"]'),
        all: row.querySelector('[data-fleet="all"]'),
        oneSub: row.querySelector('[data-role="onesub"]'),
        halfSub: row.querySelector('[data-role="halfsub"]'),
        allSub: row.querySelector('[data-role="allsub"]'),
        profit: row.querySelector('[data-role="profit"]'),
        chance: row.querySelector('[data-role="chance"]'),
      };
    }
  }

  /* ─────── 玩家引导：动态计算下一步，纯 UI 不写入存档 ─────── */
  const GUIDE_STEPS = [
    { done: (s) => s.buildings.field >= 2, name:'添置田地', title:'先有良田，方能养活族人',
      desc:'田地能提升出生率，人口增长后每秒银两也会增加。建议先添置第二块田地。', page:'home', target:'building-list', key:'field', type:'building', button:'查看田地' },
    { done: (s) => s.techs.includes('realestate'), name:'置办地契', title:'研习房地产，开启置业之路',
      desc:'当前只能种地。研习「房地产」后才能修建地产，扩大营造容量。', page:'techs', target:'tech-list', key:'realestate', type:'tech', button:'前往格物' },
    { done: (s) => s.techs.includes('architecture'), name:'营造屋舍', title:'解锁建筑学，扩充家族居所',
      desc:'人口住得太挤会提高死亡率。研习建筑学，尽快解锁房产。', page:'techs', target:'tech-list', key:'architecture', type:'tech', button:'前往格物' },
    { done: (s) => s.buildings.house >= 1, name:'安置族人', title:'建造房产，让家族兴旺',
      desc:'房产提升人口容纳量，但也会略微抬高其他建筑的价格。', page:'home', target:'building-list', key:'house', type:'building', button:'查看房产' },
    { done: (s) => s.techs.includes('finance'), name:'经营银库', title:'研习金融，建立钱庄',
      desc:'钱庄能提高银两储存上限，为后期高价科技和丹药筹备资金。', page:'techs', target:'tech-list', key:'finance', type:'tech', button:'前往格物' },
    { done: (s) => s.techs.includes('expansion'), name:'拓展势力', title:'研习对外扩张，准备商路',
      desc:'扩张可解锁演武台，但会带来一定的人口死亡代价。', page:'techs', target:'tech-list', key:'expansion', type:'tech', button:'前往格物' },
    { done: (s) => s.techs.includes('trade'), name:'开辟商路', title:'研习商路，让银钱流动起来',
      desc:'商路科技是贸易系统的门槛，先具备金融与对外扩张能力。', page:'techs', target:'tech-list', key:'trade', type:'tech', button:'前往格物' },
    { done: (s) => s.buildings.caravan >= 1, name:'兴建驿站', title:'营造商队驿站，开辟商贸收入',
      desc:'一座驿站提供一个商队位。商队行商能获得额外收入和秘闻。', page:'home', target:'building-list', key:'caravan', type:'building', button:'查看驿站' },
    { done: (s) => s.secrets.length >= SECRET_UNLOCK, name:'探寻秘闻', title:'遣商队探秘，寻找修仙机缘',
      desc:'收集十条秘闻即可找到云深谷坊市。研习「探秘者」能提高线索概率，但死亡率也会上升。', page:'trade', target:'route-list', type:'secrets', button:'前往通商' },
    { done: (s) => s.techs.includes('quzhang'), name:'研习祛障', title:'窥见天光，研习祛障之术',
      desc:'集齐秘闻后研习祛障。后期研习所需银两可能超过原银库上限。', page:'techs', target:'tech-list', key:'quzhang', type:'tech', button:'前往格物' },
    { done: (s) => s.spiritStones >= 1 || s.cultivation.pills > 0, name:'积攒灵石', title:'云深谷坊市，兑换灵石',
      desc:'进入通商界面的坊市，将银两兑换成灵石，准备祛障丹。', page:'trade', target:'market', type:'stones', button:'前往坊市' },
    { done: (s) => s.cultivation.qi >= 1, name:'踏入仙途', title:'服用祛障丹，冲击炼气',
      desc:'祛障丹并非必定成功。储备灵石后到仙途页尝试突破。', page:'immortal', target:'pill-box', type:'qi', button:'前往仙途' },
  ];

  function updateOverview(s, d) {
    const complete = GUIDE_STEPS.filter(step => step.done(s)).length;
    const remaining = GUIDE_STEPS.find(step => !step.done(s));
    const title = $('overview-title');
    const desc = $('overview-desc');
    const button = $('overview-go');
    const hint = $('overview-hint');
    const progress = $('overview-track');
    const progressN = $('overview-progress-value');
    progressN.textContent = `${complete} / ${GUIDE_STEPS.length}`;
    progress.setAttribute('aria-valuenow', String(complete));
    $('overview-progress-fill').style.width = `${complete / GUIDE_STEPS.length * 100}%`;
    const phase = complete < 2 ? '凡尘 · 立族' : complete < 5 ? '凡尘 · 兴家'
      : complete < 8 ? '凡尘 · 通商' : complete < 11 ? '凡尘 · 探秘' : '仙途 · 入道';
    $('overview-chapter').textContent = phase;
    const trend = $('overview-trend');
    trend.textContent = `${fmtRate(d.netPerSec * currentSpeed(s), 3)} 人/秒`;
    trend.classList.toggle('is-down', d.netPerSec < 0);

    if (!remaining) {
      title.textContent = '修仙之门已开，家族道途初成';
      desc.textContent = '恭喜诞生炼气族人！接下来可继续经营商路、发展人口，并尝试更长远的家族规划。';
      button.textContent = '查看仙途 ↗';
      button.dataset.targetPage = 'immortal';
      button.dataset.targetId = 'immortal-metrics';
      hint.textContent = '凡尘篇核心目标已达成';
      return;
    }
    title.textContent = remaining.title;
    desc.textContent = remaining.desc;
    button.textContent = `${remaining.button} ↗`;
    button.dataset.targetPage = remaining.page;
    button.dataset.targetId = remaining.target;
    hint.textContent = `${complete + 1} / ${GUIDE_STEPS.length} · ${remaining.name}`;

    if (remaining.type === 'tech' || remaining.type === 'building') {
      const def = remaining.type === 'tech' ? TECH_MAP[remaining.key] : BUILDING_MAP[remaining.key];
      const cost = remaining.type === 'tech' ? def.cost : currentUnitCost(s, d, def);
      if (remaining.type === 'building' && def.slots > d.freeSlots) {
        hint.textContent = '营造位已满，请先购置地产或腾出容量';
      } else if (cost > d.silverCap) {
        hint.textContent = `所需 ${fmt(cost)} 两已超出银库上限，请先建钱庄`;
        button.textContent = '查看钱庄 ↗';
        button.dataset.targetPage = 'home';
        button.dataset.targetId = 'building-list';
      } else if (s.silver < cost) {
        const needed = Math.max(0, Math.ceil(cost - s.silver));
        const sec = d.silverPerSec > 0 ? Math.ceil(needed / (d.silverPerSec * currentSpeed(s))) : null;
        hint.textContent = `还差 ${fmt(needed)} 两${sec === null ? '' : ` · 按当前岁入约 ${fmtDuration(sec)}`}`;
      } else {
        hint.textContent = `已备好 ${fmt(cost)} 两，可前往操作`;
      }
    } else if (remaining.type === 'secrets') {
      hint.textContent = `当前 ${s.secrets.length} / ${SECRET_UNLOCK} 条秘闻`;
    } else if (remaining.type === 'stones') {
      hint.textContent = `灵石 ${fmtStones(s.spiritStones)} / 1 枚`;
    } else if (remaining.type === 'qi') {
      const need = Math.max(0, PILL_STONE_COST - s.spiritStones);
      if (need > 0.00000001) {
        hint.textContent = `已试丹 ${s.cultivation.pills} 次 · 还需 ${fmtStones(need)} 枚灵石`;
        button.textContent = '前往坊市补充灵石 ↗';
        button.dataset.targetPage = 'trade';
        button.dataset.targetId = 'market';
      } else {
        hint.textContent = `已有 ${fmtStones(s.spiritStones)} 枚灵石 · 服丹成功率 ${fmtPercent(PILL_QI_CHANCE, 0)}`;
      }
    }
  }

  /* ─────────────────────── 各区块刷新 ─────────────────────── */

  function updateTopbar(s, d) {
    // 资源不在这里——每一页有自己的资源条（updatePageRes）。
    // 顶栏只管全局控制与一个身份说明。
    $('brand-sub').textContent = d.cultivationUnlocked
      ? `炼气篇 · 第${s.generation}代`
      : `凡尘篇 · 第${s.generation}代`;
  }

  function buildPageRes(page) {
    const host = $('page-res');
    host.innerHTML = '';
    resRefs = [];

    for (const [label, fn] of PAGE_RES[page] || []) {
      const chip = document.createElement('span');
      chip.className = 'pres-chip';
      chip.innerHTML = `<span class="pres-label">${label}</span><span class="pres-value">—</span>`;
      host.appendChild(chip);
      resRefs.push({ node: chip.querySelector('.pres-value'), fn });
    }
  }

  function updatePageRes(s, d) {
    const page = s.ui.page || 'home';
    if (page !== resPageSig) {
      resPageSig = page;
      buildPageRes(page);
    }
    for (const ref of resRefs) ref.node.textContent = ref.fn(s, d);
  }

  /**
   * 页面同步：既要切换高亮，也要把**还没到时候出现的栏目藏起来**。
   * 可见性一变就顺手兜一次底 —— 当前页若被藏了，退回「家业」。
   */
  let pageVisSig = null;
  function syncPage() {
    const s = state();
    const vis = visiblePages(s).join(',');
    if (vis !== pageVisSig) {
      pageVisSig = vis;
      const shown = new Set(vis.split(','));
      for (const tab of document.querySelectorAll('.pagetab')) {
        tab.hidden = !shown.has(tab.dataset.page);
      }
      for (const sec of document.querySelectorAll('.page')) {
        sec.hidden = !shown.has(sec.dataset.page);
      }
      pageSig = null;   // 可见性变了，重算一次高亮
    }
    let page = s?.ui?.page || 'home';
    if (!visiblePages(s).includes(page)) {
      page = 'home';
      if (s?.ui) s.ui.page = 'home';
    }
    if (page !== pageSig) {
      pageSig = page;
      for (const tab of document.querySelectorAll('.pagetab')) {
        const active = tab.dataset.page === page;
        tab.classList.toggle('is-active', active);
        if (active) tab.setAttribute('aria-current', 'page');
        else tab.removeAttribute('aria-current');
      }
      for (const sec of document.querySelectorAll('.page')) {
        sec.classList.toggle('is-active', sec.dataset.page === page);
      }
    }
  }

  /** 「隐藏已研习」：把 done 的科技收起，免得列表越拉越长。 */
  function syncHideDone() {
    const hide = Boolean(state()?.ui?.hideDoneTechs);

    const btn = $('hide-done-btn');
    btn.classList.toggle('is-active', hide);
    btn.textContent = hide ? '显示全部' : '隐藏已研习';

    for (const tech of TECHS) {
      const ref = techRefs[tech.id];
      if (!ref) continue;
      ref.root.classList.toggle(
        'is-hidden',
        hide && ref.root.classList.contains('is-done'),
      );
    }
    // 一整代都被藏起来的话，连标题一起收掉
    for (const group of techGroups) {
      const anyVisible = group.ids.some((id) => !techRefs[id].root.classList.contains('is-hidden'));
      group.root.classList.toggle('is-hidden', !anyVisible);
    }
  }

  function updateCard(def, s, d) {
    const c = cards[def.id];
    const owned = s.buildings[def.id] || 0;
    c.count.textContent = `×${owned}`;
    updateSellButton(c, def, s, d, owned);

    if (!d.unlocked[def.id]) {
      const tech = TECH_MAP[def.tech];
      c.root.classList.add('locked');
      c.root.classList.remove('affordable', 'blocked');
      c.effect.textContent = `须研习「${tech?.name || def.tech}」`;
      c.buyLabel.textContent = '未解锁';
      c.buyCost.textContent = '—';
      c.buy.disabled = true;
      return;
    }

    c.root.classList.remove('locked');
    c.effect.textContent = owned > 0
      ? def.effectText(owned, d)
      : `尚未营造 · 每座 ${def.perText}`;

    const slotBlocked = def.slots > 0 && d.freeSlots < def.slots;
    const count = maxAffordable(s, d, def, s.ui.buyMode);

    if (count > 0) {
      c.buyLabel.textContent = count > 1 ? `购置 ×${count}` : '购置';
      c.buyCost.textContent = `${fmt(batchCost(s, d, def, count))} 两`;
      c.buy.disabled = false;
      c.root.classList.add('affordable');
      c.root.classList.remove('blocked');
    } else {
      c.buyLabel.textContent = '购置';
      c.buyCost.textContent = slotBlocked ? '容量不足' : `${fmt(currentUnitCost(s, d, def))} 两`;
      c.buy.disabled = true;
      c.root.classList.remove('affordable');
      c.root.classList.toggle('blocked', slotBlocked);
    }
  }

  /**
   * 刷新出售按钮。
   * 卖价按「最近买的几座」算，所以卖 1 座的返还 ≈ 手里最贵那座的一半。
   */
  function updateSellButton(c, def, s, d, owned) {
    if (owned <= 0) {
      c.sell.disabled = true;
      c.sellText.textContent = '出售';
      return;
    }

    const cap = maxSellable(s, d, def);
    if (cap <= 0) {
      c.sell.disabled = true;
      c.sellText.textContent = '腾不出容量';
      return;
    }

    c.sell.disabled = false;
    c.sellText.textContent = `出售 +${fmt(sellRefund(s, d, def, 1))} 两`;
  }

  function updateTechs(s) {
    for (const tech of TECHS) {
      const ref = techRefs[tech.id];
      const status = techStatus(s, tech);

      ref.root.classList.toggle('is-done', status === 'done');
      ref.root.classList.toggle('is-locked', status === 'locked');
      ref.root.classList.toggle('is-ready', status === 'ready');
      ref.root.classList.toggle('is-open', status === 'open');

      ref.cost.textContent = status === 'done' ? '已研习' : `${fmt(tech.cost)} 两`;

      // 前置可能是科技，也可能是「见过世面」（秘闻），两者都要说清楚
      const blockers = [];
      if (status === 'locked' && !isResearched(s, tech.id)) {
        const missing = tech.requires
          .filter((r) => !isResearched(s, r))
          .map((r) => `「${TECH_MAP[r]?.name || r}」`);
        if (missing.length) blockers.push(`须先研习 ${missing.join('、')}`);
      }
      if (tech.requiresSecrets && s.secrets.length < CULTIVATOR_MARKET.requiresSecrets) {
        blockers.push(
          `须集齐 ${CULTIVATOR_MARKET.requiresSecrets} 条秘闻（${s.secrets.length}/${CULTIVATOR_MARKET.requiresSecrets}）`,
        );
      }
      ref.req.textContent = blockers.join(' · ');

      ref.btn.disabled = status !== 'ready';
      ref.btn.textContent = status === 'done' ? '已研习' : status === 'locked' ? '需前置' : status === 'open' ? '银两不足' : '立即研习';
      ref.btn.title = status === 'open' ? `还缺 ${fmt(Math.ceil(Math.max(0,tech.cost - s.silver)))} 两` : tech.desc;
    }

    const chip = $('tech-chip');
    const ready = researchableCount(s);
    chip.textContent = ready > 0
      ? `已研习 ${s.techs.length} / ${TECHS.length} · ${ready} 项可研习`
      : `已研习 ${s.techs.length} / ${TECHS.length}`;
    chip.className = `chip${ready > 0 ? ' chip-open' : ''}`;
    const techNav = document.querySelector('.pagetab[data-page="techs"]');
    if (techNav) techNav.dataset.ready = String(ready > 0);
  }

  function updatePopulation(s, d) {
    const speed = currentSpeed(s);

    $('housing-text').textContent = `${fmt(s.population, 1)} / ${fmt(d.housingCap)}`;

    const bar = $('housing-bar');
    bar.style.width = `${Math.min(100, d.crowdRatio * 100).toFixed(2)}%`;
    bar.classList.toggle('warn', d.crowdRatio >= 0.75 && d.crowdRatio < 1);
    bar.classList.toggle('danger', d.crowdRatio >= 1);

    const mood = populationMood(d);
    const chip = $('pop-chip');
    chip.textContent = mood.text;
    chip.dataset.mood = mood.key;

    // 同样按倍速换算成「每秒实际发生多少」，与岁入口径一致
    const perSec = speed > 1 ? `/秒 ·×${speed}` : '/秒';
    setMetric('birth', `${fmtPercent(d.birthRate * speed, 2)}${perSec}`, 'flat');
    setMetric('death', `${fmtPercent(d.deathRate * speed, 2)}${perSec}`, 'flat');
    setMetric('net', `${fmtRate(d.netPerSec * speed, 3)} 人/秒`,
      d.netRate > 0.0002 ? 'pos' : d.netRate < -0.0002 ? 'neg' : 'flat');
    setMetric('total', `${fmt(s.stats.births)} / ${fmt(s.stats.deaths)}`, 'flat');

    const note = $('pop-note');
    const head = d.crowdOver > 0
      ? `屋舍渐紧（占 <b>${fmtPercent(d.crowdRatio, 1)}</b>），拥挤使死亡率多出 <b>${fmtPercent(d.crowdDeath * speed, 2)}/秒</b>。`
      : `屋舍尚有余裕（占 <b>${fmtPercent(d.crowdRatio, 1)}</b>），生育不受所限。`;

    const expand = d.expandDeath > 0
      ? `对外扩张（演武台／商队驿站）又折去 <b>${fmtPercent(d.expandDeath * speed, 2)}/秒</b>。`
      : '';

    const tail = d.crowdOver > 0
      ? '增开<b>房产</b>可缓解拥挤，<b>田地</b>推高出生率。'
      : '增开<b>田地</b>可推高出生率。';

    note.innerHTML = head + expand + tail;
  }

  function setMetric(id, text, cls) {
    const node = metricRefs[id];
    node.textContent = text;
    node.classList.remove('pos', 'neg', 'flat');
    node.classList.add(cls);
  }

  function updateSlots(_s, d) {
    const chip = $('slot-chip');
    chip.textContent = `建筑容量 ${d.usedSlots} / ${d.buildingCap}`;
    chip.classList.toggle('chip-full', d.freeSlots <= 0 && d.buildingCap > 0);
  }

  function updateCaravans(s, d, now) {
    const speed = currentSpeed(s);
    const host = $('caravan-slots');
    const sig = `${d.caravanSlots}|${s.caravans.map((c) => c.startedAt).join(',')}`;

    if (sig !== caravanSig) {
      caravanSig = sig;
      host.innerHTML = '';
      caravanRefs = [];

      if (d.caravanSlots === 0) {
        const div = document.createElement('div');
        div.className = 'caravan empty';
        div.textContent = d.unlocked.caravan ? '尚无驿站，商路未通' : '须研习「商路」并建起驿站';
        host.appendChild(div);
        return;
      }

      // 只给在途商队画进度行。空置的位不各占一行——位一多，
      // 那些空行会把底下的派遣按钮顶到屏幕外去。
      const shown = s.caravans.slice(0, MAX_CARAVAN_ROWS);
      for (const c of shown) {
        const route = ROUTE_MAP[c.routeId];
        const row = document.createElement('div');
        row.className = 'caravan';
        row.innerHTML = `
          <span class="caravan-name">${route ? route.name : '未知商路'}</span>
          <span class="caravan-time">—</span>
          <div class="bar"><div class="bar-fill"></div></div>`;
        host.appendChild(row);
        caravanRefs.push({
          remaining: c.remaining,
          total: c.total,
          time: row.querySelector('.caravan-time'),
          bar: row.querySelector('.bar-fill'),
        });
      }

      const addNote = (text) => {
        const div = document.createElement('div');
        div.className = 'caravan-note';
        div.textContent = text;
        host.appendChild(div);
      };

      const extra = s.caravans.length - shown.length;
      if (extra > 0) addNote(`另有 ${extra} 支商队在路上`);

      const free = Math.max(0, d.caravanSlots - s.caravans.length);
      addNote(free > 0 ? `空置商队位 ×${free}` : '商队位已满');
    }

    // 每帧都从 state 重读：倍速改了以后剩余时间要立刻跟着变
    for (let i = 0; i < caravanRefs.length; i += 1) {
      const ref = caravanRefs[i];
      if (!ref) continue;
      const live = s.caravans[i];
      const remaining = live ? live.remaining : ref.remaining;
      const total = live && live.total > 0 ? live.total : ref.total;

      const pct = Math.min(100, 100 * (1 - remaining / total));
      ref.bar.style.width = `${Math.max(0, pct).toFixed(2)}%`;

      // 显示的是一倍速下的等效时间，也就是你真正要等多久
      const realLeft = remaining / speed;
      ref.time.textContent = realLeft > 0 ? fmtDuration(realLeft) : '归来中';
    }

    const chip = $('trade-chip');
    if (!d.tradeUnlocked) {
      chip.textContent = d.unlocked.caravan ? '待建驿站' : '未解锁';
      chip.className = 'chip';
    } else {
      chip.textContent = `商队 ${d.usedCaravans} / ${d.caravanSlots}`;
      chip.className = `chip${d.freeCaravans > 0 ? ' chip-open' : ' chip-full'}`;
    }
  }

  function updateRoutes(s, d) {
    for (const def of TRADE_ROUTES) {
      const ref = routeRefs[def.id];
      const noSlot = d.freeCaravans <= 0;

      // 收益与秘闻概率会被科技改动（比如探秘者），所以每帧重算
      ref.profit.textContent = `净赚 +${fmt(tradeReward(s, def) - def.cost)}`;
      ref.chance.textContent = `秘闻 ${fmtPercent(tradeSecretChance(s, def), 0)}`;

      // 单队
      const canOne = d.tradeUnlocked && !noSlot && s.silver >= def.cost;
      ref.one.disabled = !canOne;
      ref.oneSub.textContent = !d.tradeUnlocked
        ? '未解锁'
        : noSlot
          ? '无空位'
          : s.silver < def.cost
            ? '银两不足'
            : `${fmt(def.cost)} 两`;

      // 批量：按钮上直接写清会派出几队、总共花多少
      for (const [fleet, btn, sub] of [
        ['half', ref.half, ref.halfSub],
        ['all', ref.all, ref.allSub],
      ]) {
        const n = d.tradeUnlocked ? fleetSize(s, d, def, fleet) : 0;
        btn.disabled = n <= 0;
        sub.textContent = !d.tradeUnlocked
          ? '未解锁'
          : n > 0
            ? `${n} 队 · ${fmt(n * def.cost)} 两`
            : noSlot
              ? '无空位'
              : '银两不足';
      }

      ref.root.classList.toggle('is-locked', !d.tradeUnlocked);
      ref.root.classList.toggle('is-ready', canOne);
    }
  }

  function updateSecrets(s, d) {
    const last = s.secrets[s.secrets.length - 1];
    const sig = `${d.secretCount}|${last === undefined ? -1 : last}`;
    if (sig === secretSig) return;
    secretSig = sig;

    $('secret-count').textContent = `${d.secretCount} / ${d.secretGoal}`;
    $('secret-bar').style.width =
      `${Math.min(100, (d.secretCount / Math.max(1, d.secretGoal)) * 100).toFixed(1)}%`;
    $('secret-latest').textContent = last === undefined
      ? '尚无所获。跑商路，总有人会多嘴。'
      : SECRETS[last];
  }

  function updateMarket(s, d) {
    const unlocked = d.marketUnlocked;
    const can = unlocked && s.silver >= CULTIVATOR_MARKET.silver;

    const chip = $('market-chip');
    chip.textContent = unlocked ? '已通' : `需 ${d.secretGoal} 秘闻`;
    chip.className = `chip${unlocked ? (can ? ' chip-open' : '') : ' chip-locked'}`;

    $('market-desc').textContent = unlocked
      ? `${fmt(CULTIVATOR_MARKET.silver)} 银两 → ${fmtStones(CULTIVATOR_MARKET.stones)} 灵石。`
        + '那边的客人看不上银子，兑率苛刻得很。'
      : `集齐 ${d.secretGoal} 条秘闻，才能摸到这条路（现有 ${d.secretCount} 条）。`;

    const btn = $('exchange-btn');
    btn.disabled = !can;
    btn.querySelector('[data-role="exchangetext"]').textContent = !unlocked
      ? '未通'
      : can
        ? `兑换 ${fmtStones(CULTIVATOR_MARKET.stones)} 灵石`
        : `需 ${fmt(CULTIVATOR_MARKET.silver)} 银两`;
  }

  function updateImmortal(s, d) {
    setImmortal('secrets', `${fmt(d.secretCount)} / ${fmt(d.secretGoal)}`,
      d.marketUnlocked ? 'pos' : 'flat');
    setImmortal('stones', `${fmtStones(d.stones)} 枚`, d.stones > 0 ? 'pos' : 'flat');
    setImmortal('qi', `${fmt(d.qi)}`, d.qi > 0 ? 'pos' : 'flat');
    setImmortal('innate', fmt(d.cultivateFx.innate), d.cultivateFx.innate > 0 ? 'pos' : 'flat');
    setImmortal('pills', `${fmt(s.cultivation.pills)}`, 'flat');

    const chip = $('immortal-chip');
    if (d.cultivationUnlocked) {
      chip.textContent = '炼气篇';
      chip.className = 'chip chip-open';
    } else if (d.marketUnlocked) {
      chip.textContent = '待祛障';
      chip.className = 'chip chip-locked';
    } else {
      chip.textContent = '未启';
      chip.className = 'chip chip-locked';
    }

    // 祛障丹
    const pill = PILL_MAP.quzhangdan;
    const researched = isResearched(s, pill.requiresTech);
    const afford = d.stones >= pill.stoneCost - 1e-9;
    const pillBtn = $('pill-btn');

    $('pill-cost').textContent =
      `${fmtStones(pill.stoneCost)} 灵石 · 成算 ${fmtPercent(pill.qiChance, 0)}`;
    pillBtn.disabled = !(researched && afford);
    pillBtn.textContent = !researched ? '未解锁' : afford ? '服用' : '灵石不足';

    const note = $('immortal-note');
    if (d.cultivationUnlocked) {
      // 境界上限由 data/realms.js 决定，这里直接取表，避免和表脱节
      const top = realmName(REALM_MAX_INDEX);
      const gates = REALM_TIERS.filter((t) => realmGate(t.endIndex)).map((t) => t.name);
      note.innerHTML =
        `族中已有 <b>${fmt(d.qi)}</b> 名修士，最高可修至 <b>${top}</b>。`
        + `炼气期无瓶颈、修为到了自然晋阶；升入 <b>${gates.join(' / ')}</b> 需要备齐材料主动冲关。`
        + `天生灵根必须具有修士血脉，灵池与祛障丹是后天产生修士的两条途径。`;
    } else if (!researched) {
      note.innerHTML = d.marketUnlocked
        ? '已在「格物」中解锁<b>祛障</b>——研习它，才能服下祛障丹。'
        : `集齐 <b>${fmt(d.secretGoal)}</b> 条秘闻，才能摸到云深谷坊市；`
          + '那是凡人换到灵石唯一的路。';
    } else {
      note.innerHTML =
        `服下祛障丹，有 <b>${fmtPercent(pill.qiChance, 0)}</b> 的机会让一名族人踏入炼气。`
        + '服下多少枚，全看家底。';
    }
    updateCultivatorRoster(s,d);
  }

  function updateCultivatorRoster(s,d) {
    const set=(id,value)=>{const el=$(id); if(el) el.textContent=value;};
    const formatPower=n=>Number(n).toLocaleString('zh-CN',{maximumFractionDigits:1,minimumFractionDigits:1});
    set('power-value',formatPower(d.totalPower));
    set('power-mortal',formatPower(d.mortalPower));
    set('power-cultivator',formatPower(d.cultivatorPower));
    set('power-guard','+'+formatPower(d.guardPower));
    set('power-chip',d.qi>0?'已有修士':'凡人立族');
    set('roster-count',`${d.qi} 位修士`);
    const people=s.cultivation?.cultivators || [];
    const counts={guard:0,retreat:0,labor:0,explore:0,sect:0};
    for(const p of people) counts[p.job]=(counts[p.job]||0)+1;
    const jobNode=$('cultivator-job-stats');
    const newJobSig=Object.entries(counts).map(([k,v])=>k+v).join(':');
    if(jobNode.dataset.signature!==newJobSig){
      jobNode.dataset.signature=newJobSig;
      jobNode.innerHTML=Object.entries(CULTIVATOR_JOBS).map(([id,def])=>`<div class="job-stat"><strong>${counts[id]}</strong><span>${def.name}</span></div>`).join('');
    }
    const host=$('cultivator-list');
    // 脏检查要把「会影响冲关按钮状态的一切」都算进去：
    // 境界、修为、失败次数，以及灵石与线索（否则材料变少了按钮不会变灰）。
    const sig=people.map(p=>{
      const st=breakthroughState(p);
      const need=cultivateXpNeeded(p.realmIndex)||1;
      return `${p.id}:${p.job}:${p.realmIndex}:${p.talent}:${Math.floor(100*(p.xp/need))}:${st.kind}:${p.breakFailures||0}`
        + `:${p.root?.grade||'-'}:${(p.root?.elements||[]).join('')}:${p.root?.rerolls||0}`;
    }).join('|')+`#${Math.floor(s.spiritStones||0)}:${s.cultivation?.clues||0}`;
    if(host.dataset.signature===sig) return;
    host.dataset.signature=sig;
    if(!people.length){
      host.innerHTML='<div class="cultivator-empty">尚无炼气修士。必须先通过祛障丹或灵池获得第一名修士；没有修士血脉时，绝不会天生修士。</div>';
      return;
    }
    host.innerHTML=people.map(p=>{
      const cap=cultivateLevelCap(p);
      const st=breakthroughState(p);
      const need=cultivateXpNeeded(p.realmIndex);
      const atCeiling=st.kind==='max';
      const pct=atCeiling?100:Math.min(100,100*p.xp/(Number.isFinite(need)?need:1));
      const role=Object.entries(CULTIVATOR_JOBS).map(([id,def])=>`<option value="${id}" ${id===p.job?'selected':''}>${def.name}</option>`).join('');

      // 底部一行：平时显示修炼进度，卡在瓶颈上时换成「缺什么」
      let footText;
      if(atCeiling) footText='已至此界尽头';
      else if(st.kind==='blocked') footText='<b>瓶颈</b> · 可冲关';
      else if(st.kind==='filling') footText=`待冲关 · 还需 ${Math.ceil(st.remaining)} 点修为`;
      else if(p.job==='retreat') footText=`修炼 ${pct.toFixed(1)}%`;
      else footText='未闭关 · 修为暂停';

      // 只有 blocked 才给突破按钮 —— 这是全篇唯一需要玩家主动点的境界操作
      let gateBtn='';
      if(st.kind==='blocked'){
        // 注意：本文件里 state 是取值函数，状态对象是形参 s
        const plan=breakthroughPlan(s,p.id);
        const rate=realmBreakRate(p.realmIndex,p.talent,p.breakFailures);
        const cls=plan.ok?'btn break is-ready':'btn break';
        const tip=plan.ok
          ? `${plan.pillName?`需 ${plan.pillName} ×1，`:''}耗 ${plan.stones} 灵石 + ${plan.clues} 线索，成功率 ${(plan.rate*100).toFixed(0)}%；失败修为倒退 ${plan.loss} 点`
          : plan.reason;
        gateBtn=`<button class="${cls}" data-breakthrough="${p.id}" ${plan.ok?'':'disabled'} title="${tip}">`
          + `冲关 ${realmName(p.realmIndex+1)} · ${(rate*100).toFixed(0)}%</button>`;
        // 代价里要把丹药写在最前面 —— 没有丹就冲不了关，这是玩家最需要知道的一条
        const pillTxt=plan.pillName?`<b>${plan.pillName}</b> + `:'';
        if(plan.ok) gateBtn+=`<span class="break-cost">${pillTxt}${plan.stones} 灵石 + ${plan.clues} 线索</span>`;
        else gateBtn+=`<span class="break-cost is-short">${plan.reason}</span>`;
      }

      return `<article class="cultivator-card">
        <div class="cultivator-card-top"><span class="cultivator-name">${p.name}</span><span class="cultivator-origin ${p.origin==='innate'?'is-innate':''}">${p.origin==='innate'?'天生':'后天'}</span></div>
        <div class="cultivator-realm"><strong>${realmName(p.realmIndex)}</strong><em>最多可至 ${realmName(cap)}</em></div>
        <div class="cultivator-root" title="${rootGradeOf(p).desc}">
          <span class="root-grade grade-${rootGradeOf(p).id}">${rootGradeOf(p).name}</span>
          <span class="root-elements">${rootElementsOf(p).map((e)=>`<i class="el-${e}">${elementName(e)}</i>`).join('') || '—'}</span>
          <span class="root-meta">天赋 ${Number(p.talent||1).toFixed(2)} · 修炼 ×${rootSpeedMult(p).toFixed(2)} · 冲关 ${rootBreakBonus(p)>=0?'+':''}${(rootBreakBonus(p)*100).toFixed(0)}%</span>
        </div>
        <div class="cultivator-progress"><span style="width:${pct.toFixed(1)}%"></span></div>
        <div class="cultivator-foot"><span>${footText}</span>
        <select class="cultivator-assignment" data-assign-id="${p.id}" aria-label="指派${p.name}的工作">${role}</select></div>
        <div class="cultivator-break">${gateBtn}${(()=>{
          const cost=rootRerollCost(p);
          const rp=rootRerollPlan(s,p.id);
          return `<button class="btn reroll" data-root-reroll="${p.id}" ${rp.ok?'':'disabled'}`
            + ` title="${rp.ok?`消耗 ${cost} 灵石重测灵根。测得更差会保留原有的，只扣灵石。`:rp.reason}">`
            + `测灵根 · ${cost} 灵石</button>`;
        })()}</div>
      </article>`;
    }).join('');
  }

  function setImmortal(id, text, cls) {
    const node = immortalRefs[id];
    node.textContent = text;
    node.classList.remove('pos', 'neg', 'flat');
    node.classList.add(cls);
  }

  function updateStudy(s) {
    const sum = studySummary(s);

    const accText = sum.accuracy === null
      ? '—'
      : `${fmtPercent(sum.accuracy, 0)}（${s.quiz.right}/${s.quiz.total}）`;
    setStudy('acc', sum.accuracy===null ? '—' : `${fmtPercent(sum.accuracy,0)}（${sum.right}/${sum.answered}）`,
      sum.accuracy === null ? 'flat' : sum.accuracy >= .8 ? 'pos' : sum.accuracy >= .5 ? 'flat' : 'neg');
    setStudy('streak', `${sum.streak} / ${sum.bestStreak}`, sum.streak > 0 ? 'pos' : 'flat');
    setStudy('learned', `${fmt(sum.seenWords)} / ${fmt(sum.totalWords)}`, 'flat');
    setStudy('weak', `${fmt(sum.weak)}`, sum.weak > 0 ? 'neg' : 'flat');

    const chip = $('study-chip');
    if (sum.answered === 0) {
      chip.textContent = '尚未开课';
      chip.className = 'chip';
    } else {
      chip.textContent = `${fmt(sum.answered)} 题 · 错 ${fmt(sum.answered-sum.right)}`;
      chip.className = `chip${sum.weak > 0 ? ' chip-full' : ' chip-open'}`;
    }

    const note = $('study-note');
    if (note) {
      const mode = s.settings.quizMode;
      if (mode === 'off') {
        note.innerHTML = '当前为<b>免答</b>模式：不会触发答题，当成普通挂机游戏玩。';
      } else if (sum.lost > 0) {
        note.innerHTML = `地狱难度下已因答错损失 <b>${fmt(sum.lost)}</b> 两银。`;
      } else if (mode === 'half') {
        note.innerHTML = '当前为<b>轻松</b>模式：一半概率触发答题。做错的题会更高频地再出现。';
      } else {
        note.innerHTML = '答对才生效。做错的题会更高频地再出现，直到你掌握。';
      }
    }
  }

  function setStudy(id, text, cls) {
    const node = studyRefs[id];
    node.textContent = text;
    node.classList.remove('pos', 'neg', 'flat');
    node.classList.add(cls);
  }

  /**
   * 错题本。
   *
   * 列表只给一行缩略（单词 + 释义），题干一长就看不全 ——
   * 所以每条都是可点的，点开在下面展开完整题目、四个选项、正确答案与解析。
   */
  let wbOpenId = null;
  function renderWrongBookDetail(s) {
    const host = $('wb-detail');
    if (!host) return;
    const d = wbOpenId ? wrongBookDetail(s, wbOpenId) : null;
    if (!d) {
      wbOpenId = null;
      host.hidden = true;
      host.innerHTML = '';
      return;
    }
    host.hidden = false;
    const opts = d.options.length
      ? `<ul class="wb-options">${d.options.map((o) =>
          `<li class="${o.correct ? 'is-correct' : ''}">${o.correct ? '<b>✓</b> ' : ''}${o.text}</li>`).join('')}</ul>`
      : '';
    const head = d.kind === 'custom'
      ? `<div class="wb-detail-q">${d.title}</div>${d.source ? `<div class="wb-detail-src">出处：${d.source}</div>` : ''}`
      : `<div class="wb-detail-q">${d.title}</div>
         <div class="wb-detail-src">${d.phonetic}${d.pos ? ` · ${d.pos}` : ''}</div>`;
    host.innerHTML = `<div class="wb-detail-head">
        <strong>${d.kind === 'custom' ? '题目回顾' : '单词回顾'}</strong>
        <button class="btn ghost" type="button" data-wb-close="1">收起</button>
      </div>
      ${head}
      ${opts}
      <div class="wb-detail-ans"><b>正确答案</b>：${d.answerText}</div>
      ${d.explanation ? `<div class="wb-detail-exp"><b>解析</b>：${d.explanation}</div>` : ''}
      <div class="wb-detail-stats">答对 ${d.stats.right} 次 · 答错 ${d.stats.wrong} 次 · 共作答 ${d.stats.seen} 次</div>`;
  }

  function updateWrongBook(s) {
    const list = wrongBookWords(s).slice(0, 8);
    const sig = `${questionBankLibrary.selected}|${activeWrongIds(s).length}|${list.map((w) => `${w.id}:${w.wrong}`).join(',')}|${wbOpenId}`;
    if (sig === wrongBookSig) return;
    wrongBookSig = sig;

    $('wb-count').textContent = `${activeWrongIds(s).length} 题`;

    const host = $('wb-list');
    if (!list.length) {
      host.innerHTML = '<div class="wb-empty">还没有错题，继续保持。</div>';
      renderWrongBookDetail(s);
      return;
    }
    // 渲染成按钮 —— 让「可以点开」这件事从外观上就能看出来
    host.innerHTML = list.map((w) =>
      `<button type="button" class="wb-item${w.id === wbOpenId ? ' is-open' : ''}" data-wb-open="${w.id}" title="点开看完整题目与解析">
        <span class="wb-word">${w.word}</span>
        <span class="wb-mean">${w.meaning}</span>
        <span class="wb-times">错 ${w.wrong}</span>
      </button>`).join('');
    renderWrongBookDetail(s);
  }

  /* 错题条目的点开 / 收起。与其它只读面板一致，不触发答题。 */
  document.addEventListener('click', (ev) => {
    const open = ev.target.closest('[data-wb-open]');
    if (open) {
      const id = open.dataset.wbOpen;
      wbOpenId = wbOpenId === id ? null : id;   // 再点一次收起
      updateWrongBook(state());
      return;
    }
    if (ev.target.closest('[data-wb-close]')) {
      wbOpenId = null;
      updateWrongBook(state());
    }
  });

  let bankUiSig = null;
  function updateBanks() {
    const lib=questionBankLibrary;
    const sig=lib.selected + ':' + lib.banks.map(b=>b.id+':'+b.questions.length).join('|');
    if (sig===bankUiSig) return;
    bankUiSig=sig;
    $('bank-count').textContent=lib.banks.length ? `${lib.banks.length} 份自定义` : '默认题库';
    $('bank-current-name').textContent=currentBankLabel();
    const selected=activeQuestionBank();
    $('bank-current-size').textContent=`${selected ? selected.questions.length : WORD_LIST.length} 题`;
    $('bank-export').disabled=!selected;
    const host=$('bank-list');host.replaceChildren();
    const entries=[{id:BUILTIN_BANK_ID,title:'六级英语词库',description:'游戏内置英文单词词库',size:WORD_LIST.length},
      ...lib.banks.map(b=>({...b,size:b.questions.length}))];
    for (const b of entries) {
      const el=document.createElement('article');
      const chosen=lib.selected===b.id;
      el.className='bank-card'+(chosen?' is-selected':'');
      const header=document.createElement('div');header.className='bank-card-name';
      const title=document.createElement('span');title.textContent=b.title;
      const tag=document.createElement('span');tag.className='bank-card-tag';tag.textContent=chosen?'● 当前使用':'';
      header.append(title,tag);
      const desc=document.createElement('div');desc.className='bank-card-meta';
      desc.textContent=`${b.size} 道题 · ${b.description || '无说明'}`;
      const actions=document.createElement('div');actions.className='bank-card-actions';
      const select=document.createElement('button');select.className='btn'+(chosen?' ghost':'');
      select.type='button';select.dataset.action='bank-select';select.dataset.bankId=b.id;
      select.disabled=chosen;select.textContent=chosen?'已选中':'切换题库';actions.appendChild(select);
      if (b.id!==BUILTIN_BANK_ID) {
        const del=document.createElement('button');del.className='btn ghost danger';del.type='button';
        del.dataset.action='bank-delete';del.dataset.bankId=b.id;del.textContent='删除';actions.appendChild(del);
      }
      el.append(header,desc,actions);host.appendChild(el);
    }
  }

  function updateLog(s) {
    const head = s.log[0];
    const sig = `${s.log.length}|${head ? `${head.at}:${head.repeat || 1}` : ''}`;
    if (sig === logSig) return;
    logSig = sig;

    $('log-chip').textContent = `${s.log.length} 条`;

    const host = $('log-list');
    host.innerHTML = '';
    for (const item of s.log) {
      const div = document.createElement('div');
      div.className = `log-item kind-${item.kind || 'info'}`;
      const repeat = item.repeat > 1 ? ` <span class="rep">×${item.repeat}</span>` : '';
      div.innerHTML = `<span class="t">${fmtClock(item.at)}</span><span class="txt">${item.text}${repeat}</span>`;
      host.appendChild(div);
    }
  }

  /* ─────────────────────── 折叠 ─────────────────────── */

  function syncCollapsed() {
    const collapsed = state()?.ui?.collapsed || {};
    const sig = Object.keys(collapsed).filter((k) => collapsed[k]).sort().join(',');
    if (sig === collapseSig) return;
    collapseSig = sig;

    for (const panel of document.querySelectorAll('[data-panel]')) {
      const isCollapsed = Boolean(collapsed[panel.dataset.panel]);
      panel.classList.toggle('is-collapsed', isCollapsed);
      panel.querySelector('.panel-toggle')?.setAttribute('aria-expanded', String(!isCollapsed));
    }
  }

  /* ─────────────────────── 设置开关同步 ─────────────────────── */

  function syncQuizMode() {
    const mode = state()?.settings?.quizMode || 'always';
    if (mode !== quizModeSig) {
      quizModeSig = mode;
      for (const btn of document.querySelectorAll('[data-quiz-mode]')) {
        btn.classList.toggle('is-active', btn.dataset.quizMode === mode);
      }
    }
    // 免答时「难度」这一档不起作用，灰掉它免得让人以为失效了
    $('difficulty-group').classList.toggle('is-muted', mode === 'off');
  }

  function syncDifficulty() {
    const diff = state()?.settings?.difficulty || 'normal';
    if (diff === difficultySig) return;
    difficultySig = diff;
    for (const btn of document.querySelectorAll('[data-difficulty]')) {
      btn.classList.toggle('is-active', btn.dataset.difficulty === diff);
    }
  }

  function syncSpeed() {
    const speed = currentSpeed(state());
    if (speed === speedSig) return;
    speedSig = speed;
    for (const btn of document.querySelectorAll('[data-speed]')) {
      btn.classList.toggle('is-active', Number(btn.dataset.speed) === speed);
    }
  }

  function syncTheme() {
    const theme = document.body?.dataset.theme || document.documentElement.dataset.theme || 'classic';
    if (theme === themeSig) return;
    themeSig = theme;
    for (const btn of document.querySelectorAll('[data-theme-choice]')) {
      btn.classList.toggle('is-active', btn.dataset.themeChoice === theme);
    }
  }

  function syncBuyMode() {
    const mode = state().ui.buyMode;
    for (const btn of document.querySelectorAll('[data-buy-mode]')) {
      btn.classList.toggle('is-active', btn.dataset.buyMode === mode);
    }
  }

  /* ─────────────────────── 提示条 ─────────────────────── */

  function toast(text, kind = 'info', duration = 2200) {
    const host = $('toast-host');
    while (host.childElementCount >= 4) host.firstElementChild.remove();

    const div = document.createElement('div');
    div.className = `toast ${kind}`;
    div.innerHTML = text;
    host.appendChild(div);

    setTimeout(() => {
      div.classList.add('fade');
      setTimeout(() => div.remove(), 420);
    }, duration);
  }

  /** 离线归来的结算弹窗。 */
  function reportOffline(rep) {
    const delta = rep.popTo - rep.popFrom;
    const lines = [
      `<b>离山 ${fmtDuration(rep.seconds)}</b>`,
      `银两 +${fmt(rep.silverGain)} 两`,
      `人口 ${fmt(rep.popFrom, 1)} → ${fmt(rep.popTo, 1)}（${delta >= 0 ? '+' : ''}${fmt(delta, 1)}）`,
    ];
    if (rep.capped) lines.push('<span style="color:#8d929c">离线收益最多结算 12 小时</span>');
    toast(lines.join('<br>'), 'offline', 7000);
  }

  /* ─────────────────────── 事件 ─────────────────────── */

  function bindEvents() {
    const settingsButton = $('settings-toggle');
    const settingsPanel = $('global-settings');
    const syncSettingsToggle = (expanded) => {
      settingsButton?.setAttribute('aria-expanded', String(expanded));
      settingsButton?.setAttribute('aria-label', expanded ? '收起游戏设置' : '展开游戏设置');
      settingsPanel?.setAttribute('aria-hidden', String(!expanded));
      if (settingsButton) settingsButton.textContent = expanded ? '✕ 收起设置' : '⚙ 设置';
    };
    settingsButton?.addEventListener('click', () => {
      const expanded = settingsPanel.classList.toggle('is-open');
      syncSettingsToggle(expanded);
    });
    document.addEventListener('keydown', (ev) => {
      if (ev.key === 'Escape' && settingsPanel?.classList.contains('is-open')) {
        settingsPanel.classList.remove('is-open');
        syncSettingsToggle(false);
      }
      if (!quizView.isBusy() || ev.altKey || ev.ctrlKey || ev.metaKey) return;
      if (/^[1-4]$/.test(ev.key)) {
        ev.preventDefault();
        quizView.answer(Number(ev.key) - 1);
      } else if (/^[a-d]$/i.test(ev.key)) {
        ev.preventDefault();
        quizView.answer(ev.key.toUpperCase().charCodeAt(0) - 65);
      }
    });
    for(const key of ['bank-ai-title','bank-ai-count','bank-ai-focus']) {
      document.getElementById(key)?.addEventListener('input',updateBankAiPreview);
      document.getElementById(key)?.addEventListener('change',updateBankAiPreview);
    }
    updateBankAiPreview();
    document.addEventListener('change', ev=>{
      const select=ev.target.closest('[data-assign-id]');
      if(!select) return;
      if(quizView.isBusy()){ ui.toast('请先完成当前答题','warn'); ui.render(); return; }
      actions.assignCultivator(Number(select.dataset.assignId),select.value);
    });
    $('bank-file')?.addEventListener('change', async (ev) => {
      const file=ev.target.files?.[0];
      ev.target.value='';
      if (!file) return;
      if (quizView.isBusy()) { actions.bankError('答题未完成，暂时不能导入题库。'); return; }
      await actions.importBankFile(file);
    });
    document.addEventListener('click', (ev) => {
      if (settingsPanel?.classList.contains('is-open') && !ev.target.closest('#global-settings') && !ev.target.closest('#settings-toggle')) {
        settingsPanel.classList.remove('is-open');
        syncSettingsToggle(false);
      }

      // 折叠开关任何时候都能点，不受答题弹窗影响
      const toggleEl = ev.target.closest('[data-toggle]');
      if (toggleEl) {
        actions.togglePanel(toggleEl.dataset.toggle);
        return;
      }

      const actEl = ev.target.closest('[data-action]');
      if (actEl) {
        const { action } = actEl.dataset;

        // 答题相关永远优先处理
        if (action === 'quiz-answer') {
          quizView.answer(Number(actEl.dataset.index));
          return;
        }
        if (action === 'quiz-continue') {
          quizView.finishFeedback();
          return;
        }

        // 有题在等答案时，其余操作一律忽略（弹窗本来也盖住了界面）
        if (quizView.isBusy()) return;

        if (action === 'buy') actions.buy(actEl.dataset.id);
        else if (action === 'sell') actions.sell(actEl.dataset.id);
        else if (action === 'research') actions.research(actEl.dataset.tech);
        else if (action === 'trade') actions.trade(actEl.dataset.route);
        else if (action === 'trade-fleet') actions.tradeFleet(actEl.dataset.route, actEl.dataset.fleet);
        else if (action === 'exchange') actions.exchange();
        else if (action === 'pill') actions.pill(actEl.dataset.pill);
        else if (action === 'toggle-hide-done') actions.toggleHideDone();
        else if (action === 'bank-import') $('bank-file')?.click();
        else if (action === 'bank-template') actions.downloadBankTemplate();
        else if (action === 'bank-ai-copy') actions.copyBankAiPrompt();
        else if (action === 'bank-ai-show') actions.toggleBankAiPrompt();
        else if (action === 'bank-export') actions.exportBank();
        else if (action === 'bank-select') actions.selectBank(actEl.dataset.bankId);
        else if (action === 'bank-delete') actions.deleteBank(actEl.dataset.bankId);
        else if (action === 'save') actions.save();
        else if (action === 'reset') actions.reset();
        else if (action === 'overview-go') {
          const targetPage = actEl.dataset.targetPage || 'home';
          const targetId = actEl.dataset.targetId;
          actions.setPage(targetPage);
          if (targetId) requestAnimationFrame(() => {
            document.getElementById(targetId)?.scrollIntoView({ behavior:'smooth', block:'start' });
          });
        }
        return;
      }

      if (quizView.isBusy()) return;

      const speedEl = ev.target.closest('[data-speed]');
      if (speedEl) {
        actions.setSpeed(speedEl.dataset.speed);
        return;
      }
      const pageEl = ev.target.closest('.pagetab[data-page]');
      if (pageEl) {
        actions.setPage(pageEl.dataset.page);
        return;
      }
      const qmEl = ev.target.closest('[data-quiz-mode]');
      if (qmEl) {
        actions.setQuizMode(qmEl.dataset.quizMode);
        return;
      }
      const diffEl = ev.target.closest('[data-difficulty]');
      if (diffEl) {
        actions.setDifficulty(diffEl.dataset.difficulty);
        return;
      }
      const themeEl = ev.target.closest('[data-theme-choice]');
      if (themeEl) {
        actions.setTheme(themeEl.dataset.themeChoice);
        return;
      }
      const modeEl = ev.target.closest('[data-buy-mode]');
      if (modeEl) actions.setBuyMode(modeEl.dataset.buyMode);
    });
  }

  /* ─────────────────────── 初始化 ─────────────────────── */

  applyThemeChoice(readThemeChoice(), false);

  buildCards();
  buildTechs();
  buildMetrics();
  buildStudy();
  buildImmortal();
  buildRoutes();
  bindEvents();
  syncBuyMode();
  syncDifficulty();
  syncSpeed();
  syncTheme();
  syncQuizMode();
  syncCollapsed();

  function render() {
    const s = state();
    if (!s) return;
    const d = derive(s);
    const now = Date.now();

    updateTopbar(s, d);
    updateOverview(s, d);
    updatePageRes(s, d);
    updateSlots(s, d);
    for (const def of BUILDINGS) updateCard(def, s, d);
    updateTechs(s);
    updatePopulation(s, d);
    updateStudy(s);
    updateWrongBook(s);
    updateBanks();
    updateCaravans(s, d, now);
    updateRoutes(s, d);
    updateSecrets(s, d);
    updateMarket(s, d);
    updateImmortal(s, d);
    updateLog(s);
    syncDifficulty();
    syncSpeed();
    syncQuizMode();
    syncCollapsed();
    syncPage();
    syncHideDone();
  }

  /**
   * 请求答题。有题未答时返回 false。
   * @param {object} plan engine 的操作计划
   * @param {(correct: boolean, question: object, pickedIndex: number) => void} onAnswer
   */
  function askQuiz(plan, onAnswer) {
    return quizView.ask(plan, onAnswer);
  }

  return {
    render,
    toast,
    reportOffline,
    syncBuyMode,
    syncDifficulty,
    syncSpeed,
    syncTheme,
    syncQuizMode,
    syncCollapsed,
    syncPage,
    syncHideDone,
    askQuiz,
    quiz: quizView,
    /** 暴露给调试用：控制台里能直接调 ui.actions.buy('field') 之类。 */
    actions,
    /** 给测试看的：某个面板是否折叠 */
    isPanelCollapsed: panelCollapsed,
  };
}
