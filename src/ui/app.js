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
  /** 仙道科技的行引用。与 techRefs 分开，这样「凡人科技有几项」的计数不会被污染。 */
  const immortalTechRefs = {};
  /** 上一次同步过的「正在看哪条线」。用来避免每帧重排 DOM。 */
  let techLineSig = null;
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
      ['道心', (s) => {
        const t = moralityTierOf(s);
        return `${t.name} ${moralityOf(s).toFixed(0)}`;
      }],
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

  /**
   * 建一行科技。凡人侧与仙道侧**共用这一个函数** ——
   * 两条线的差别只有「花什么货币」与「按钮写什么字」，
   * 所以把它们写成两份是没必要的重复，改一处总比改两处安全。
   *
   * @param {HTMLElement} host   挂到哪个容器
   * @param {object} tech        科技定义
   * @param {string[]} gains     收益文案
   * @param {object} refs        行引用的登记表
   * @param {object} opts        { immortal:boolean }
   */
  function buildTechRow(host, tech, gains, refs, opts = {}) {
    const immortal = Boolean(opts.immortal);
    const costText = immortal
      ? `${tech.stones || 0} 石 · ${fmt(tech.cost || 0)} 两`
      : `${fmt(tech.cost)} 两`;
    const row = document.createElement('div');
    row.className = immortal ? 'tech is-immortal' : 'tech';
    row.dataset.tech = tech.id;
    row.title = tech.desc;
    row.innerHTML = `
      <div class="tech-mark">${tech.icon}</div>
      <div class="tech-body">
        <div class="tech-title">
          <span class="tech-name">${tech.name}</span>
          <span class="tech-cost" data-role="cost">${costText}</span>
        </div>
        <div class="tech-gain">${gains.join(' · ')}</div>
        <div class="tech-req" data-role="req"></div>
      </div>
      <button class="btn tech-btn" data-action="${immortal ? 'researchImmortal' : 'research'}"
              data-tech="${tech.id}">${immortal ? '参悟' : '研习'}</button>`;
    host.appendChild(row);
    refs[tech.id] = {
      root: row,
      cost: row.querySelector('[data-role="cost"]'),
      req: row.querySelector('[data-role="req"]'),
      btn: row.querySelector('button.tech-btn'),
    };
  }

  function buildTechs() {
    const host = $('tech-list');
    // 【缺陷修复 · 由 6d2ce7f 引入】静态骨架把 #tech-list 包在
    // `.tech-list-static-placeholder[hidden]` 里（本意是 JS 接管前藏住静态标记）。
    // 但 buildTechs 是往 #tech-list **内部**重建的，于是整条凡人科技线永远待在
    // hidden 祖先内部 —— 界面上一条都看不见（房地产 / 建筑学 / 钱庄 / …），
    // 玩家会以为这些内容被删掉了，而家业页的建筑卡片还在提示
    // 「须研习『房地产』」，形成死结。
    // smoke 抓不到这个：`#tech-list .tech[data-tech].length === 18` 照样通过，
    // 因为 DOM 里确实有 18 个子节点 —— 无头垫片不计算可见性。
    // 修法：JS 接管后把占位层的 hidden 摘掉。容器 (#tech-list) 留在原位即可见，
    // 而且保住了原本「JS 接管前藏住静态标记」的防闪意图 —— 因为解除隐藏时
    // 紧跟其后的 innerHTML='' 会把静态标记清掉，玩家只可能看到 JS 构建的结果。
    // ⚠ 不要改用 insertBefore 把容器搬出去：无头垫片 scripts/dom-shim.mjs 没实现它，
    //    会抛 "insertBefore is not a function"；而它的 appendChild(:62) 不先从旧父节点
    //    摘除，搬移会变成复制。`hidden` 是 REFLECTED_BOOL，属性赋值即可生效。
    const ph = host.parentElement;
    if (ph && ph.classList.contains('tech-list-static-placeholder')) ph.hidden = false;
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

  /**
   * 建仙道科技树。与 buildTechs 同构，差别：
   *   · 分组用 IMMORTAL_TECH_TIERS
   *   · 货币是「灵石 · 银两」
   *   · 前置换算走 immortalTechMissing()，所以「须先研习 XX」里
   *     会同时出现凡人科技与仙道科技的名字 —— 这就是咬合点最直观的展示
   */
  function buildImmortalTechs() {
    const host = $('immortal-tech-list');
    if (!host) return;
    host.innerHTML = '';

    for (const tier of IMMORTAL_TECH_TIERS) {
      const items = IMMORTAL_TECHS.filter((t) => t.tier === tier.tier);
      if (!items.length) continue;

      const group = document.createElement('div');
      group.className = 'tech-group';

      const head = document.createElement('div');
      head.className = 'tech-tier';
      head.innerHTML = `<span class="tier-name">${tier.name}</span><span class="tier-hint">${tier.hint}</span>`;
      group.appendChild(head);

      for (const tech of items) {
        const gains = techGainText(
          tech,
          BUILDING_MAP[tech.unlocksBuilding]?.name,
          ALCHEMY_RECIPE_MAP[tech.unlocksPill]?.name,
        );
        buildTechRow(group, tech, gains, immortalTechRefs, { immortal: true });
      }
      host.appendChild(group);
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

  /* ═══════════════ 【策划 C15 / 任务 T-2】境界仪表盘 ═══════════════
   *
   * 首页顶部**随境界换一块表**：炼气看到行气条，筑基换成道基牌位，金丹换成丹图……
   * 玩家一眼就知道自己进入了新玩法。
   *
   * 三条硬约定（出自 docs/91-落地任务清单.md §三 T-2 验收标准）：
   *   1. 容器有稳定 id `#realm-dashboard`，内容**只渲染当前最高境界那一格**；
   *   2. 未解锁的机制**不渲染**（DOM 里根本不存在），靠 `hidden` 属性兜底；
   *   3. 每格都带一个 `[查百科]` 链接（`data-target-page="codex"` + 真实条目 id）。
   *
   * 落地的顺序约定（同文档）：T-3～T-8 每做完一条就顺手补它那一格，
   * 所以本函数里的 qi / foundation / core 三格是**本轮负责**的，
   * nascent / tribulation 两格留给第二阶段（T-7 / T-8），现在只给占位说明。
   */

  /** 「寿 X，余 Y」这一小行：族谱与仪表盘共用。 */
  function lifeSpanText(s, p) {
    const max = realmLifespan(p.realmIndex);
    const used = Math.max(0, (Number(s.clock?.year) || 0) - (Number(p.realmEnteredYear) || 0));
    const left = max - used;
    // 【策划 C14 / 任务 T-2b】余量为负（磨蹭太久）时**夹到 0** 并改文案。
    // 收窄版没有老死，所以负数只是文案；不夹的话界面上会出现「余 −69」。
    // 出处：docs/91 §三 T-2b「⚠ 结合［实跑］」那一段（原文要求「显示夹到 max(0, Y)」）。
    const shown = Math.max(0, Math.round(left));
    const ratio = max > 0 ? Math.max(0, Math.min(1, left / max)) : 0;
    const cls = left <= 0 ? 'dash-life-gone' : ratio < 0.2 ? 'dash-life-danger'
      : ratio < 0.5 ? 'dash-life-warn' : 'dash-life-normal';
    const text = left <= 0 ? `寿 ${max}，寿元已尽…` : `寿 ${max}，余 ${shown}`;
    return { text, cls };
  }

  /** 每格的「查百科」链接。条目 id 必须真实存在于 data/codex.js。 */
  function dashCodexLink(entryId, label) {
    return `<button class="dash-link" type="button" data-target-page="codex" data-target-id="${entryId}">查百科 · ${label}</button>`;
  }

  function renderDashboardCell(s, key) {
    const people = s.cultivation?.cultivators || [];
    if (key === 'qi') {
      // ── 炼气：行气条（T-3 的猛进开关 + T-4 的在外人数）──
      const qi = people.filter((p) => p.realmIndex <= 9);
      const pushing = qi.filter((p) => p.push === true).length;
      const out = qi.filter((p) => p.job === 'errand').length;
      const stalled = qi.filter((p) => (Number(p.stalled) || 0) > 0).length;
      const avg = qi.length ? qi.reduce((a, p) => {
        const need = cultivateXpNeeded(p.realmIndex) || 1;
        return a + Math.min(100, (100 * (p.xp || 0)) / need);
      }, 0) / qi.length : 0;
      return `<div class="dash-cell dash-qi">
        <div class="dash-head"><span class="dash-title">行气 · 炼气</span>
          <span class="dash-note">拨「猛进」换速度与走火之险；派「差事」换秘闻线索</span>
          ${dashCodexLink('mech-realm', '境界')}</div>
        <div class="dash-bar"><i style="width:${avg.toFixed(1)}%"></i></div>
        <div class="dash-row"><span>炼气族人 <b>${qi.length}</b></span>
          <span>猛进行气 <b>${pushing}</b></span>
          <span>差事在外 <b>${out}</b></span>
          <span>气机滞住 <b>${stalled}</b></span>
          <span>平均行气 <b>${avg.toFixed(1)}%</b></span></div>
      </div>`;
    }
    if (key === 'foundation') {
      // ── 筑基：道基牌位（T-5 的 person.foundation）──
      const rows = people.filter((p) => p.foundation).map((p) => {
        const f = p.foundation;
        const node = mapNode(f.nodeId);
        const grade = FOUNDATION_GRADE_MAP[f.grade] || FOUNDATION_GRADE_MAP[1];
        const qi = EARTH_QI[f.element] || EARTH_QI.tu;
        const held = mapHeld(s, f.nodeId) && mapIsPacified(s, f.nodeId);
        const rel = earthQiRelation((p.root?.elements || [])[0] || null, f.element);
        const relText = rel === 'match' ? '相合 ×1.5' : rel === 'clash' ? '相冲 ×0.6' : '无涉';
        const life = lifeSpanText(s, p);
        return `<span>${p.name} · ${node ? node.name : f.nodeId}（${grade.name} · ${qi.name}气）· ${relText}${held ? '' : ' · <b>地已失，词条减半</b>'} · <i class="${life.cls}">${life.text}</i></span>`;
      });
      const body = rows.length
        ? `<div class="dash-row">${rows.join('')}</div>`
        : `<span class="dash-note">尚无人择地筑基。炼气九层冲关时会让你先挑一块走到过的地。</span>`;
      return `<div class="dash-cell dash-foundation">
        <div class="dash-head"><span class="dash-title">道基 · 筑基</span>
          <span class="dash-note">地气定词条，灵根主系定相合相冲</span>
          ${dashCodexLink('realm-zhuji', '筑基')}</div>
        ${body}
      </div>`;
    }
    if (key === 'core') {
      // ── 金丹：丹图（T-6 的丹纹 / 品阶 / 剩余机会）──
      const grid = coreDashboard(s);
      const rows = grid.map((g) => `<span>${g.name} · <b>${g.marks} 纹</b> · ${g.grade} · 余 ${g.chancesLeft} 次</span>`);
      const body = rows.length ? `<div class="dash-row">${rows.join('')}</div>`
        : `<span class="dash-note">修为满时不再自动晋升：面板上会出现「晋升 / 结丹」两个按钮。</span>`;
      return `<div class="dash-cell dash-core">
        <div class="dash-head"><span class="dash-title">丹图 · 金丹</span>
          <span class="dash-note">每层一次机会：文火稳、武火中、三昧真火买上限</span>
          ${dashCodexLink('realm-jindan', '金丹')}</div>
        ${body}
      </div>`;
    }
    if (key === 'nascent') {
      // ── 元婴：第二阶段 T-7 填充。现在只给一句说明，不摆假数据 ──
      return `<div class="dash-cell dash-nascent">
        <div class="dash-head"><span class="dash-title">元婴 · 圣胎</span>
          <span class="dash-note">圣胎温养（第二阶段 T-7）—— 本体在家，元婴在外，两者都在消耗你</span>
          ${dashCodexLink('realm-yuanying', '元婴')}</div>
      </div>`;
    }
    // ── 化神：第二阶段 T-8 填充 ──
    return `<div class="dash-cell dash-tribulation">
      <div class="dash-head"><span class="dash-title">化神 · 天劫</span>
        <span class="dash-note">天劫（第二阶段 T-8）—— 你越强，天地越要收你</span>
        ${dashCodexLink('realm-huashen', '化神')}</div>
    </div>`;
  }

  function updateDashboard(s) {
    const host = $('realm-dashboard');
    if (!host) return;
    const key = realmDashboardKey(s);
    // ⚠ 脏检查：只在「该显示哪一格」或内容真的变了时才重画。
    //   仪表里的数字（行气 %、在外人数）每帧都在动，所以用较粗的取整口径做签名，
    //   否则每个 tick 都会重排 DOM（界面会闪）。
    const people = s.cultivation?.cultivators || [];
    const sig = `${key}|${Math.round((Number(s.clock?.year) || 0) / 5)}|` + people.map((p) => {
      const need = cultivateXpNeeded(p.realmIndex) || 1;
      return `${p.id}:${p.realmIndex}:${p.job}:${p.push ? 1 : 0}:${Math.round((Number(p.stalled) || 0) / 60)}`
        + `:${p.foundation ? `${p.foundation.nodeId}/${p.foundation.grade}` : '-'}`
        + `:${coreOf(p).marks}:${Math.floor((100 * (p.xp || 0)) / need / 5)}`;
    }).join(',');
    if (host.dataset.signature === sig) return;
    host.dataset.signature = sig;
    if (!key) { host.hidden = true; host.innerHTML = ''; return; }
    host.hidden = false;
    host.innerHTML = renderDashboardCell(s, key);
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
   *
   * ⚠ 唯一的例外是 `#techs`：格物页**开局就允许直接看**（见 visiblePages），
   *   但这一条仍然保留，因为「轮回到一半」之类的中间态会把它藏掉。
   *   调试时用 `location.hash === '#techs'` 强制看一眼，见 main.js 的启动段。
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

  /**
   * 切换「凡人 · 格物」/「仙道 · 参悟」两条线。
   *
   * 用 is-hidden 切换而不是重建 DOM —— 两条线的行引用（techRefs /
   * immortalTechRefs）在 build 阶段一次性建好，切换时只是改 class，
   * 所以是零成本的，也不会打断滚动位置。
   */
  function setTechLine(line) {
    const imm = line === 'immortal';
    $('tech-list')?.classList.toggle('is-hidden', imm);
    $('immortal-tech-list')?.classList.toggle('is-hidden', !imm);
    $('line-mortal-btn')?.classList.toggle('is-active', !imm);
    $('line-immortal-btn')?.classList.toggle('is-active', imm);
    // 记住看的是哪一条线（界面偏好，随存档走），刷新后还停在原处
    const s = state();
    if (s?.ui) s.ui.techLine = imm ? 'immortal' : 'mortal';
    syncHideDone();
  }

  /** 按 state 里记着的偏好把两条线摆对。build 之后与每次 render 都调一次。 */
  function syncTechLine() {
    const want = state()?.ui?.techLine === 'immortal' ? 'immortal' : 'mortal';
    if (want === techLineSig) return;
    techLineSig = want;
    const imm = want === 'immortal';
    $('tech-list')?.classList.toggle('is-hidden', imm);
    $('immortal-tech-list')?.classList.toggle('is-hidden', !imm);
    $('line-mortal-btn')?.classList.toggle('is-active', !imm);
    $('line-immortal-btn')?.classList.toggle('is-active', imm);
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

    // 仙道侧同规则。它不在 techGroups 里，所以单独走一遍。
    for (const tech of IMMORTAL_TECHS) {
      const ref = immortalTechRefs[tech.id];
      if (!ref) continue;
      ref.root.classList.toggle('is-hidden', hide && ref.root.classList.contains('is-done'));
    }
  }

  function updateCard(def, s, d) {
    const c = cards[def.id];
    const owned = s.buildings[def.id] || 0;
    c.count.textContent = `×${owned}`;
    updateSellButton(c, def, s, d, owned);

    if (!d.unlocked[def.id]) {
      // 【修复 用户实机缺陷 ③·拼音泄漏】统一走 `techLabelOf()`（两条线一起查，
      // 查不到给中文「未知科技」）。**删掉了原来的 `|| def.tech` 回退** ——
      // 那个回退正是玩家看到 `须研习「lingtian」` 的原因：
      // `lingtian` 是**仙道线**的 id，而 `TECH_MAP` 只有凡人线 ⇒ 查表落空 ⇒ 打印 id。
      c.root.classList.add('locked');
      c.root.classList.remove('affordable', 'blocked');
      c.effect.textContent = `须研习「${techLabelOf(def.tech)}」`;
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

      /**
       * 前置可能是三类：凡人科技、仙道科技（跨树前置）、或是「见过世面」（秘闻）。
       * ⚠ 三条必须都说清楚，否则玩家会以为界面漏了东西 ——
       *   「祛障」的跨树前置就是这样：不写出来，玩家只会看到它一直锁着。
       */
      const blockers = [];
      if (status === 'locked' && !isResearched(s, tech.id)) {
        const missing = (tech.requires || [])
          .filter((r) => !isResearched(s, r))
          .map((r) => `「${TECH_MAP[r]?.name || r}」`);
        if (missing.length) blockers.push(`须先研习 ${missing.join('、')}`);
        const missingImm = (tech.requiresImmortal || [])
          .filter((r) => !isImmortalTechResearched(s, r))
          .map((r) => `「${IMMORTAL_TECH_MAP[r]?.name || r}」（仙道）`);
        if (missingImm.length) blockers.push(`须先参悟 ${missingImm.join('、')}`);
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

    updateImmortalTechs(s);

    const chip = $('tech-chip');
    const ready = researchableCount(s);
    chip.textContent = ready > 0
      ? `已研习 ${s.techs.length} / ${TECHS.length} · ${ready} 项可研习`
      : `已研习 ${s.techs.length} / ${TECHS.length}`;
    chip.className = `chip${ready > 0 ? ' chip-open' : ''}`;
    const techNav = document.querySelector('.pagetab[data-page="techs"]');
    if (techNav) techNav.dataset.ready = String(ready > 0 || researchableImmortalCount(s) > 0);
  }

  /**
   * 刷新仙道科技树。与 updateTechs 同构，但三处不同：
   *   · 货币是「灵石 · 银两」，所以「不够」要分开报
   *   · 前置缺口走 immortalTechMissing()，跨树前置的名字在里面
   *   · 未踏入炼气篇（没有修士）时整条线显示为「尚未开脉」——
   *     这是**软门槛**：不锁死，但告诉玩家「先去服一枚祛障丹」
   */
  function updateImmortalTechs(s) {
    const on = Boolean(s.cultivation?.cultivators?.length);
    for (const tech of IMMORTAL_TECHS) {
      const ref = immortalTechRefs[tech.id];
      if (!ref) continue;
      const status = immortalTechStatus(s, tech);

      ref.root.classList.toggle('is-done', status === 'done');
      ref.root.classList.toggle('is-locked', status === 'locked');
      ref.root.classList.toggle('is-ready', status === 'ready');
      ref.root.classList.toggle('is-open', status === 'open');

      ref.cost.textContent = status === 'done'
        ? '已参悟'
        : `${tech.stones || 0} 石 · ${fmt(tech.cost || 0)} 两`;

      ref.req.textContent = status === 'locked'
        ? immortalTechMissing(s, tech).join(' · ')
        : (on ? '' : '尚未有修士，仙道无处落地');

      ref.btn.disabled = status !== 'ready';
      ref.btn.textContent = status === 'done' ? '已参悟'
        : status === 'locked' ? '需前置'
          : status === 'open' ? '资源不足' : '参悟';
      ref.btn.title = status === 'open'
        ? immortalTechMissing(s, tech).join('；') || tech.desc
        : tech.desc;
    }

    const chip = $('immortal-tech-chip');
    if (!chip) return;
    const owned = (s.immortalTechs || []).length;
    const ready = researchableImmortalCount(s);
    chip.textContent = ready > 0
      ? `仙道 ${owned} / ${IMMORTAL_TECHS.length} · ${ready} 项可参悟`
      : `仙道 ${owned} / ${IMMORTAL_TECHS.length}`;
    chip.className = `chip${ready > 0 ? ' chip-open' : ''}`;
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
    // 【策划 C1 / 任务 T-4-A4】勾选是**活的**：勾选框不重渲染（否则勾选会丢），
    // 所以投帖入口的可用性必须由一次 `change` 就地刷新 —— 否则它永远停在
    // 「渲染那一刻的勾选数」上，玩家勾了人也按不动（缺陷① 的第二种形态）。
    // 用事件委托绑在容器上：容器不换、委托不丢。
    if(!updateCultivatorRoster._wired){
      updateCultivatorRoster._wired=true;
      const listNode=$('cultivator-list');
      listNode.addEventListener('change',(ev)=>{
        const box=ev.target&&ev.target.closest?ev.target.closest('[data-errand-check]'):null;
        if(!box)return;
        const btns=listNode.querySelectorAll('[data-errand]');
        const n=[...listNode.querySelectorAll('[data-errand-check]')].filter(x=>x.checked).length;
        for(const b of btns){
          b.disabled=n===0;
          b.textContent=`投帖 · 派出门（已勾选 ${n} 人）`;
          // 【修复 t13 §14.4 · 低危但没有理由留】`data-errand-count` 必须与
          //   `:checked` 个数**在同一次 change 里**同步 —— 该属性只在渲染时由
          //   `checkedCount` 写入，而「勾选 → 尚未渲染」这个窗口里它会是旧值：
          //   实测勾 2 人但未渲染时 `:checked=2`、文案「已勾选 2 人」、而 attr=0，
          //   于是「三量恒等」（T-4-A7）在这个窗口不成立。
          //   对玩家无影响（派发读活动 DOM，窗口内点击仍派 2 人），但它是**测试锚点**：
          //   锚点与真值不一致，就等于给后来人留了一个会骗人的信号。
          b.dataset.errandCount=String(n);
        }
      });
    }
    const set=(id,value)=>{const el=$(id); if(el) el.textContent=value;};
    const formatPower=n=>Number(n).toLocaleString('zh-CN',{maximumFractionDigits:1,minimumFractionDigits:1});
    set('power-value',formatPower(d.totalPower));
    set('power-mortal',formatPower(d.mortalPower));
    set('power-cultivator',formatPower(d.cultivatorPower));
    set('power-guard','+'+formatPower(d.guardPower));
    set('power-chip',d.qi>0?'已有修士':'凡人立族');
    set('roster-count',`${d.qi} 位修士`);
    const people=s.cultivation?.cultivators || [];
    // 计数表由职责表推出来 —— 硬编码的清单在加了「镇守 / 炼丹 / 炼器 / 炼符」之后
    // 就会漏项，界面上直接显示 undefined。测试里有一条专门盯这个。
    const counts=Object.fromEntries(Object.keys(CULTIVATOR_JOBS).map((id)=>[id,0]));
    for(const p of people) if(counts[p.job]!==undefined) counts[p.job]+=1;
    const jobNode=$('cultivator-job-stats');
    const newJobSig=Object.entries(counts).map(([k,v])=>k+v).join(':');
    if(jobNode.dataset.signature!==newJobSig){
      jobNode.dataset.signature=newJobSig;
      jobNode.innerHTML=Object.entries(CULTIVATOR_JOBS).map(([id,def])=>`<div class="job-stat"><strong>${counts[id]}</strong><span>${def.name}</span></div>`).join('');
    }
    const host=$('cultivator-list');
    // 【策划 C1 / 任务 T-4-A4】勾选状态必须**活过重渲染**，否则投帖入口是个死按钮：
    //   用户勾人 → 挂机时每几秒就有一次重渲染 → 勾选框被重建、勾选丢掉 →
    //   「勾选 0 人 ⇒ 入口 disabled」永远成立，玩家永远按不动投帖。
    //   做法：把「谁被勾了」并进下面的脏检查签名（它一变就重渲染），
    //   渲染时再按这个集合回填 checked。于是勾选数、按钮的 disabled 文案都跟着走。
    const checkedIds=[...document.querySelectorAll('[data-errand-check]')]
      .filter(n=>n.checked)
      .map(n=>Number(n.dataset.errandCheck))
      .filter(n=>Number.isFinite(n)&&n>0);
    // 【修复 t9 缺陷③ / 主策加固 1】**谁真的能被派**这条规则必须只写一处。
    //   原来勾选框的候选判定散在模板里、而计数只数 DOM 上的勾 ⇒ 两者会脱钩：
    //   某人刚死、刚被派走、刚过炼气期（不再走候选分支 ⇒ 不会被回填 checked），
    //   但勾选集合里还留着他的 id ⇒ 按钮文案**多报 1**，且持续一个渲染周期。
    //   现在 `live` 用「本轮仍走候选分支的人」重算，并统一供：
    //   回填 checked / 文案计数 / disabled / 派发取值 —— 四者同一个来源，不可能各说各话。
    const canErrandPerson = (p) => p.realmIndex>=1 && p.realmIndex<=9
      && p.job!=='sect' && p.job!=='garrison' && p.job!=='errand';
    // ⚠ 卡片是否**显示**投帖相关控件，是**另一条**规则，不是上面那条的重复抄写：
    //   它比「能被派」多放行一种人 —— 已经在外（`errand`）的人也要显示控件（显示的是「召回」）。
    //   所以本判定**必须由 `canErrandPerson` 派生**，而不是再手抄一遍境界/职责条件：
    //   手抄版与 `canErrandPerson` 可以独立漂移，且**危险方向不对称** ——
    //   若有人给卡片守卫加一个新的排除条件而忘了改 `canErrandPerson`，那个人的 id 仍会在
    //   `liveIds` 里被计数、但卡片不渲染勾选框 ⇒ `data-errand-count` 比 DOM 里真实的
    //   `:checked` 多 1 ⇒ **A7「三者恒等」当场破**。
    //   派生之后这条不变量从「靠两处保持同步」变成「结构上不可能不同步」。
    const showsErrandControls = (p) => canErrandPerson(p) || p.job==='errand';
    const liveIds = checkedIds.filter((id)=>people.some((p)=>p.id===id && canErrandPerson(p)));
    const checkedCount=liveIds.length;
    const outCount=people.filter(p=>p.job==='errand').length;
    const canErrand=people.some(canErrandPerson);
    // 脏检查要把「会影响卡片上一切按钮状态的东西」都算进去：
    // 境界、修为、失败次数、灵石与线索（否则材料变少了按钮不会变灰），
    // 以及本轮新增的 push / stalled / 在外 / 道基 / 丹纹 / 年份
    // （**不加就不会刷新** —— 这是一个静默失败，见 docs/91 §六.10）。
    const sig=people.map(p=>{
      const st=breakthroughState(p);
      const need=cultivateXpNeeded(p.realmIndex)||1;
      return `${p.id}:${p.job}:${p.realmIndex}:${p.talent}:${Math.floor(100*(p.xp/need))}:${st.kind}:${p.breakFailures||0}`
        + `:${p.root?.grade||'-'}:${(p.root?.elements||[]).join('')}:${p.root?.rerolls||0}`
        + `:${p.push?1:0}:${Math.floor((Number(p.stalled)||0)/30)}`
        + `:${p.foundation?`${p.foundation.nodeId}${p.foundation.grade}`:'-'}`
        + `:${coreOf(p).marks}:${Object.keys(coreOf(p).used).join('')}`
        + `:${p.realmEnteredYear||0}:${Math.floor((Number(p.stalled)||0)>0?1:0)}`
        // 【策划 C8 / 任务 T-7 · docs/91 §六.10】圣胎状态必须进脏检查签名，否则
        //   稳固度条**永远不刷新**（改完看不见变化 = 静默失败）。
        //   这是 §六.10 那条硬约定第 N 次生效：每加一个会显示在卡片上的字段，
        //   都要同步加进这里。`Math.floor(stability)` 而不是原值 —— 小数位变化
        //   每帧都在跳，不取整会让挂机时每秒都重渲染整张卡片。
        + `:${hasNascent(p)?`${Math.floor(nascentOf(p).stability)}${nascentOf(p).out?1:0}${nascentOf(p).lost?1:0}${nascentOf(p).place||'-'}`:'-'}`;
    }).join('|')+`#${Math.floor(s.spiritStones||0)}:${s.cultivation?.clues||0}:${Math.floor(Number(s.clock?.year)||0)}`
      +`:${worldOf(s).reached.join(',')}:${(s.cultivation?.alchemy?.herbs?.grass||0)>0?1:0}`
      +`:errand-check=${checkedIds.join('.')}`;
    if(host.dataset.signature===sig) return;
    host.dataset.signature=sig;
    if(!people.length){
      host.innerHTML='<div class="cultivator-empty">尚无炼气修士。必须先通过祛障丹或灵池获得第一名修士；没有修士血脉时，绝不会天生修士。</div>';
      return;
    }
    // 【策划 C1 / 任务 T-4-A1/A4】投帖工具栏：**恰好一个** `[data-errand]`。
    // A4 要求「勾选 0 人时按钮必须 disabled」—— 否则点下去只会得到一条
    // 「请先勾选族人」的 toast，那个入口在语义上是死的。
    // 【修复 t9 缺陷③ / 主策加固 2】按钮带 **`data-errand-count`**（= 本轮真正会被派出去的人数）。
    //   没有它，断言只能解析中文文案（「已勾选 N 人」），改一次文案就废一批断言 ——
    //   而 A7 要求的「回填集 / 计数 / 派发取值 三者恒等」正需要这个可机读的数。
    const errandBar=canErrand
      ? `<div class="errand-bar"><span class="errand-hint">勾选族人后可投帖问路（在外不涨修为，有去无回的风险，可随时召回）</span>`
        +`<button class="btn errand" data-errand="1" data-errand-count="${checkedCount}" ${checkedCount?'':'disabled'}`
        +` title="把勾选的族人派出去打探秘闻线索">投帖 · 派出门（已勾选 ${checkedCount} 人）</button>`
        +(outCount?`<span class="errand-out">在外 ${outCount} 人</span>`:'')
        +`</div>`
      : '';
    host.innerHTML=errandBar+people.map(p=>{
      const cap=cultivateLevelCap(p);
      const st=breakthroughState(p);
      const pState=personState(p);
      const stateTag=PERSON_STATE_LABELS[pState]||PERSON_STATE_LABELS.mortal;
      const need=cultivateXpNeeded(p.realmIndex);
      const atCeiling=st.kind==='max';
      const pct=atCeiling?100:Math.min(100,100*p.xp/(Number.isFinite(need)?need:1));
      const role=Object.entries(CULTIVATOR_JOBS).map(([id,def])=>`<option value="${id}" ${id===p.job?'selected':''}>${def.name}</option>`).join('');
      // 【策划 C14 / 任务 T-2b 验收标准 4、5】族谱上的「寿 X，余 Y」+ 三档配色
      const life=lifeSpanText(s,p);

      // 底部一行：平时显示修炼进度，卡在瓶颈上时换成「缺什么」
      let footText;
      if(atCeiling) footText='已至此界尽头';
      else if(pState==='out') footText=`<b>差事在外</b> · 修为暂停，一条条带回线索`;
      else if(pState==='stalled') footText=`<b>气机滞住</b> · 还需 ${Math.ceil(Number(p.stalled)||0)} 刻才能再修`;
      else if(pState==='folding') footText='<b>丹成待决</b> · 晋升，还是结丹？';
      else if(st.kind==='blocked') footText='<b>瓶颈</b> · 可冲关';
      else if(st.kind==='filling') footText=`待冲关 · 还需 ${Math.ceil(st.remaining)} 点修为`;
      else if(p.job==='retreat') footText=`修炼 ${pct.toFixed(1)}%`;
      else footText='未闭关 · 修为暂停';

      // 【策划 C2 / 任务 T-3】猛进行气开关：**只在**炼气（1–9）且闭关时出现。
      // 宗门弟子不给（那会变成 3.5 × 2.2 = 7.7 倍，宗门立刻成为唯一解）。
      // 出处：docs/91-落地任务清单.md §三 T-3 验收标准 1 与「为什么猛进只对 retreat 开放」。
      let pushBtn='';
      if(p.realmIndex>=1&&p.realmIndex<=9&&p.job==='retreat'){
        const exp=pushFireExpectation(p);
        // 验收标准 5：必须写出**可算的**风险，文案里带一位小数的数字
        const tip=p.push
          ?`正在猛进：本层期望走火 ${exp.toFixed(1)} 次；走火即本层修为清零（无死亡）`
          :`改为猛进：修为快 ${PUSH_RATE_MULT} 倍；本层期望走火 ${exp.toFixed(1)} 次，走火即本层修为清零`;
        pushBtn=`<button class="btn push ${p.push?'is-on':''}" data-push="${p.id}" title="${tip}">`
          +`${p.push?'猛进中':'缓修'} · 期望走火 ${exp.toFixed(1)} 次</button>`;
      }

      // 【策划 C1 / 任务 T-4】投帖问路：勾选框（每张卡片一个）+ **一个**提交工具栏。
      // 只对炼气族人与在外的人显示 —— 过了炼气期的人不该看见这个勾选框。
      // ⚠【修复 t4 缺陷①】`p.job !== 'errand'` 这一支原来只渲染勾选框、**没有任何
      //   `data-errand` 元素**，而处理器监听的是 `[data-errand]` ⇒ 勾选后点遍卡片上
      //   所有按钮都不会触发投帖，整条 C1 玩法在真实游戏里不可用
      //   （docs/92-调试报告.md §五 缺陷①，真浏览器复现）。
      //   提交按钮**只渲染一次**（工具栏），不是每张卡片一个 —— 它是全局动作
      //   （一次派一批），渲染成 N 个会让 `[data-errand]` 的数量随人数变化，
      //   也会给出 N 个入口去做同一件事。docs/91 §十二 T-4-A1 要求它恰好 1 个。
      let errandBox='';
      if(showsErrandControls(p)){
        if(p.job==='errand'){
          errandBox=`<label class="errand-box"><input type="checkbox" data-errand-check="${p.id}">在外中</label>`
            +`<button class="btn recall" data-recall="${p.id}" title="召回瞬时生效、无冷却">召回</button>`;
        }else{
          // ⚠【修复 t9 发现的缺陷③】这里**必须回填 `checked`**。
          //   上面注释原本就承诺了「渲染时按这个集合回填」，但代码没写 —— 于是
          //   勾选后只要发生一次重渲染（挂机时每几秒一次），勾选框就被重建为空，
          //   而按钮的 disabled/文案用的是**重建前**的计数 ⇒ **同一画面自相矛盾**：
          //   按钮写着「已勾选 2 人」且可点，点下去却一个人也不出门。
          //   这是投帖缺陷的第三种形态：入口有了、处理器对了，但**勾选状态活不过重渲染**。
          //   回填用 `liveIds`（= 已勾 ∩ 本轮仍走候选分支），不是原始 `checkedIds` ——
          //   这样「回填集 / 文案计数 / 派发取值」三者同源，A7 的恒等式才成立。
          //   对照实验：勾选→立刻点（成功）vs 勾选→重渲染→点（不出门）。
          //   断言 T-4-A5/A6 专门盯这条路径（原来 856 条全绿也抓不到，因为旧断言中间没有重渲染）。
          errandBox=`<label class="errand-box"><input type="checkbox" data-errand-check="${p.id}"${liveIds.includes(p.id)?' checked':''}>选去投帖</label>`;
        }
      }

      // 【策划 C6 / 任务 T-6 验收标准 2、4】丹成待决时给两个按钮：
      // 「晋升」（无风险，进下一层）与「结丹」（留在本层，把这份修为烧成丹纹）。
      // 三档火候的成率与丹纹**明文写在按钮上**，含文火的「止于六纹」。
      // ⚠ 选中档位用 data-* 而不是 select.value：垫片里读不到 select 的当前值，
      //   而那正是「按钮文案与实际结算不一致」这类静默失败的来源。
      let foldRow='';
      if(pState==='folding'){
        const fp=foldPlan(s,p.id,CORE_FOLDS[0].id);
        const marks=coreOf(p).marks;
        const grade=coreGradeOf(marks);
        foldRow=`<div class="fold-box"><div class="fold-head">丹图：<b>${marks} 纹</b> · ${grade.name}`
          +` · 本层余 ${fp.chancesLeft} 次机会</div><div class="fold-actions">`
          +`<button class="btn fold promote" data-breakthrough="${p.id}" data-force="1" title="无风险，直接进入下一层">晋升${realmName(p.realmIndex+1)}</button>`
          +CORE_FOLDS.map(f=>{
            const plan=foldPlan(s,p.id,f.id);
            const capText=f.cap===null?'无上限':`止于 ${f.cap} 纹`;
            const costText=f.stones||f.herb?` · 耗 ${f.herb?`药草×${f.herb}`:''}${f.herb&&f.stones?' + ':''}${f.stones?`${f.stones} 灵石`:''}`:'';
            // 【策划 C6 / 任务 T-6-C7「风险披露」，docs/91 §十二】按钮必须**同时**写出
            // 「成率」与「上限纹数」。理由不是数值而是**公平性**：
            //   真火贵 6 倍（60 灵石 vs 武火 10）却**均值更低**（枚举：真火 5.33203125 < 武火 5.80738125），
            //   它买的是**上限**（无 cap，能突破 12 纹）。玩家若把「60 灵石」读成「更高级所以更好」，
            //   就会觉得被坑 —— 界面不披露「上限更高、均值更低」就是在利用信息不对等，
            //   违反 docs/00「不做隐藏公式」原则。
            //   所以真火额外写「约三成概率只得九品」（0 次成功 = 0.75⁴ = 31.6%）。
            const riskNote=f.id==='zhen'?' · 约三成概率只得九品':'';
            const title=plan.ok
              ?`成算 ${(f.rate*100).toFixed(0)}%，成则 +${f.marks} 纹（${capText}）；失败丹裂掉一纹（当前 ${marks} → ${Math.max(0,marks-1)}）${costText}${riskNote}`
              :plan.reason;
            return `<button class="btn fold ${plan.ok?'':'is-locked'}${f.id==='wen'?'':' fold-'+f.id}" data-fold="${f.id}" data-person="${p.id}" ${plan.ok?'':'disabled'}`
              +` title="${title}">${f.name} ${(f.rate*100).toFixed(0)}% · ${f.marks>0?'+':''}${f.marks} 纹`
              +`${f.cap!==null?` · 止于${f.cap===6?'六':f.cap}纹`:''}${f.cap===null?' · 无上限':''}`
              +`${f.id==='zhen'?' · 三成只得九品':''}${costText}</button>`;
          }).join('')
          +`</div></div>`;
      }

      /* ── 【策划 C8 / 任务 T-7 验收标准 1】圣胎面板：0–100 稳固度条
       *    （绿/黄/红三色）+「出窍 / 回体」+ 驻地。只在元婴及以上渲染。──
       * ⚠ 三色阈值与 config.js 的 NASCENT_RESTLESS_BELOW 同源，不在这里再写魔数。 */
      let nascentRow='';
      if(hasNascent(p)){
        const na=nascentOf(p);
        const pct=Math.max(0,Math.min(100,na.stability));
        const tone=na.lost?'lost':(pct<NASCENT_RESTLESS_BELOW?(pct<NASCENT_RESTLESS_BELOW/2?'low':'mid'):'ok');
        const stateText=na.lost?'元婴已离体不返（不再涨修为，战力仍在）'
          :na.out?`元婴在外 · ${mapNode(na.place)?.name||na.place}（本体修为停涨）`
          :'元婴在体温养中';
        // 出窍目的地：只列**已占领**的节点（未占领的地没有「压着」的意义）
        const placeOpts=worldOf(s).held.map(id=>`<option value="${id}" ${na.place===id?'selected':''}>${mapNode(id)?.name||id}</option>`).join('');
        const risk=na.out&&pct<NASCENT_RESTLESS_BELOW
          ?`<span class="nascent-warn">躁动中：修为 −40%，每次判定有陨落之险</span>`:'';
        nascentRow=`<div class="nascent-box nascent-${tone}">`
          +`<div class="nascent-head">圣胎：<b>稳固 ${Math.floor(pct)}</b> · ${stateText}</div>`
          +`<div class="nascent-bar"><i style="width:${pct}%"></i></div>${risk}`
          +`<div class="nascent-actions">`
          +(na.lost?''
            :na.out
              ?`<button class="btn nascent-recall" data-nascent-recall="${p.id}" title="瞬时回体，无冷却">回体</button>`
              :`<select data-nascent-place="${p.id}">${placeOpts||'<option value="">无可去之处</option>'}</select>`
                +`<button class="btn nascent-out" data-nascent-out="${p.id}" ${placeOpts?'':'disabled'} title="元婴替你压住那块地（不占镇守名额），但本体修为停涨、稳固持续下降">出窍</button>`)
          +`</div></div>`;
      }

      /* ── 【策划 C11 / 任务 T-8 验收标准 1】渡劫准备界面：列出全部减免来源与各自数值，
       *    最末一行明写「缺口 N 点 —— 每 2 点缺口，城内落雷一道」。
       *    只在化神三层且修为已满时出现；**不出现**原来的「冲关」按钮。── */
      let trialRow='';
      if(isTribulationRealm(p.realmIndex)){
        const tp=tribulationPlan(s,p.id);
        if(tp.ok){
          trialRow=`<div class="trial-box"><div class="trial-head">天劫将至：${tp.fromName} → ${tp.toName}`
            +` · 雷伤 ${tp.base} 点</div><ul class="trial-list">`
            +tp.sources.map(src=>`<li class="${src.count>0?'is-on':''}"><span>${src.name}</span>`
              +`<b>${src.isBolt?(src.count?'免一道雷':'—'):(src.value>0?`−${Math.round(src.value*100)}%`:(src.value<0?`+${Math.round(-src.value*100)}%`:'—'))}</b>`
              +`<small>${src.note}</small></li>`).join('')
            +`</ul><div class="trial-gap">缺口 <b>${tp.damage}</b> 点 —— 每 2 点缺口，城内落雷一道`
            +`（本次 ${tp.bolts} 道）</div>`
            +`<div class="trial-verdict">${tp.verdict}</div>`
            +`<button class="btn trial-go${tp.perish?' trial-deadly':''}" data-tribulation="${p.id}"`
            +` title="${tp.tierDesc}">引雷渡劫${tp.perish?'（此劫会要命）':''}</button></div>`;
        }
      }

      // 【策划 C4 / 任务 T-5 验收标准 1、2】择地下拉框：**只列出走到过的节点**，
      // 每项下面写清三行字（地气 / 品阶 / 词条效果数值，含 ×1.5 / ×0.6 的预览）。
      // ⚠ 这一段必须算在 gateBtn **之前**：冲关按钮的询价要读 `[data-site-for]`，
      //   而卡片 HTML 是一次性写进 host 的 —— 先算谁不影响最终顺序，但影响能否读到。
      let siteRow='';
      // 「本次实际用的那块地」＝上次渲染留下的选择；没有就取候选清单的第一项
      // （下拉框默认就是选中第一项，两处必须一致，否则界面写的与实际落库的不是同一块）。
      let siteIdForGate=null;
      if(st.kind==='blocked'&&st.gate?.requiresSite){
        const fplan=foundationPlan(s,p.id);
        if(fplan.ok){
          const prev=host.querySelector(`[data-site-for="${p.id}"]`);
          const chosen=(prev&&prev.value)||fplan.sites[0].id;
          siteIdForGate=chosen;
          const pv=(foundationPreview(p,chosen,!!(fplan.sites.find(n=>n.id===chosen)||{}).held))||fplan.preview;
          const opts=fplan.sites.map(n=>`<option value="${n.id}"${n.id===chosen?' selected':''}>${n.name} · T${n.tier}${n.held?' · 已镇守（晋一档）':''}</option>`).join('');
          const relText=pv.relation==='match'?'相合 ×1.5':pv.relation==='clash'?'相冲 ×0.6':'无涉';
          siteRow=`<div class="site-box"><div class="site-head">择地筑基：先挑一块走到过的地</div>`
            +`<select class="site-select" data-site-for="${p.id}">${opts}</select>`
            +`<div class="site-preview">`
            +`<span>地气 <b>${pv.elementName}</b>（${pv.label}）</span>`
            +`<span>品阶 <b>${pv.gradeName}</b> ×${pv.gradeMult.toFixed(2)}</span>`
            +`<span>词条 <b>×${pv.entryMult.toFixed(2)}</b>（${relText}）</span>`
            +`</div></div>`;
        }else{
          siteRow=`<div class="site-box"><div class="site-head is-short">${fplan.reason}</div></div>`;
        }
      }

      // 冲关按钮：blocked 时才出现（择地那一道要先选地，见 plan.ok）
      let gateBtn='';
      if(st.kind==='blocked'){
        const plan=breakthroughPlan(s,p.id,siteIdForGate||undefined);
        const rate=realmBreakRate(p.realmIndex,p.talent,p.breakFailures);
        const cls=plan.ok?'btn break is-ready':'btn break';
        const tip=plan.ok
          ? `${plan.pillName?`需 ${plan.pillName} ×1，`:''}耗 ${plan.stones} 灵石 + ${plan.clues} 线索，成功率 ${(plan.rate*100).toFixed(0)}%；失败修为倒退 ${plan.loss} 点`
          : plan.reason;
        // ⚠【修复 t4 缺陷②】这里原来还挂着 `data-force="1"`，但**没有任何读取侧**
        //   ⇒ 一个死属性。筑基冲关走的是正常冲关（不是强制晋升），所以直接删掉，
        //   不要留一个「看起来能强制、其实没人读」的钩子（docs/92-调试报告.md §五 缺陷②）。
        gateBtn=`<button class="${cls}" data-breakthrough="${p.id}" ${plan.ok?'':'disabled'} title="${tip}">`
          + `冲关 ${realmName(p.realmIndex+1)} · ${(rate*100).toFixed(0)}%</button>`;
        const pillTxt=plan.pillName?`<b>${plan.pillName}</b> + `:'';
        if(plan.ok) gateBtn+=`<span class="break-cost">${pillTxt}${plan.stones} 灵石 + ${plan.clues} 线索</span>`;
        else gateBtn+=`<span class="break-cost is-short">${plan.reason}</span>`;
      }

      // 【策划 C4 / 任务 T-5 验收标准 6】散功重修：昂贵但不致命的后悔药
      let dissolveBtn='';
      if(p.foundation){
        const dp=dissolveFoundationPlan(s,p.id);
        if(dp.ok){
          dissolveBtn=`<button class="btn dissolve" data-dissolve="${p.id}" `
            +`title="境界回退到炼气九层、修为清零、${dp.hours} 游戏小时不能修炼、家族道心 ${dp.morality}">`
            +`散功重修 · 道心 ${dp.morality}</button>`;
        }
      }

      const coreText=p.core&&coreOf(p).marks>0
        ?`<span class="core-tag">丹纹 ${coreOf(p).marks} · ${coreGradeOf(coreOf(p).marks).name}</span>`:'';

      // 【修复 t4 缺陷②/⑦】`data-site-preview` 原本是渲染了却无人读的死属性，已删。
      //   `data-pstate` 保留并**接上读取侧**：它现在既驱动卡片上的状态徽标（下面是同一份
      //   `PERSON_STATE_LABELS[pState]`），也让样式能只靠属性选中非默认态的人。
      //   死交互属性扫描（smoke §15.9 ⑦）会盯住这一类：渲染了就必须有人读。
      return `<article class="cultivator-card" data-person="${p.id}" data-pstate="${pState}">
        <div class="cultivator-card-top"><span class="cultivator-name">${p.name}</span><span class="cultivator-origin ${p.origin==='innate'?'is-innate':''}">${p.origin==='innate'?'天生':'后天'}</span>
          <span class="state-tag ${stateTag.cls}">${stateTag.text}</span></div>
        <div class="cultivator-realm"><strong>${realmName(p.realmIndex)}</strong><em>最多可至 ${realmName(cap)}</em>
          <span class="cultivator-life ${life.cls}">${life.text}</span>${coreText}</div>
        <div class="cultivator-root" title="${rootGradeOf(p).desc}">
          <span class="root-grade grade-${rootGradeOf(p).id}">${rootGradeOf(p).name}</span>
          <span class="root-elements">${rootElementsOf(p).map((e)=>`<i class="el-${e}">${elementName(e)}</i>`).join('') || '—'}</span>
          <span class="root-meta">天赋 ${Number(p.talent||1).toFixed(2)} · 修炼 ×${rootSpeedMult(p).toFixed(2)} · 冲关 ${rootBreakBonus(p)>=0?'+':''}${(rootBreakBonus(p)*100).toFixed(0)}%</span>
        </div>
        <div class="cultivator-progress"><span style="width:${pct.toFixed(1)}%"></span></div>
        <div class="cultivator-foot"><span>${footText}</span>
        <select class="cultivator-assignment" data-assign-id="${p.id}" aria-label="指派${p.name}的工作">${role}</select></div>
        <div class="cultivator-errand">${errandBox}${pushBtn}</div>
        ${siteRow}${foldRow}${nascentRow}${trialRow}
        <div class="cultivator-break">${gateBtn}${(()=>{
          const cost=rootRerollCost(p);
          const rp=rootRerollPlan(s,p.id);
          return `<button class="btn reroll" data-root-reroll="${p.id}" ${rp.ok?'':'disabled'}`
            + ` title="${rp.ok?`消耗 ${cost} 灵石重测灵根。测得更差会保留原有的，只扣灵石。`:rp.reason}">`
            + `测灵根 · ${cost} 灵石</button>`;
        })()}${dissolveBtn}</div>
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
        else if (action === 'researchImmortal') actions.researchImmortal(actEl.dataset.tech);
        else if (action === 'tech-line') setTechLine(actEl.dataset.line);
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
  buildImmortalTechs();
  syncTechLine();
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

  /**
   * 【策划 C16 / 任务 T-9 验收标准 2】冲关过场：3–5 秒的可跳过念白。
   *
   * 「第一次必播、之后按 `state.ui.ritesSeen` 记忆」——
   * 记忆存在 state 里（随存档），待播的那一段只活在内存（见 breakthrough.js 的说明）。
   * 过场**不挡操作**：它是一层浮层，点任意处或点「跳过」即收，
   * 所以挂机时它不会把玩家的手按住（这也是「跳过是玩家的权利」那条非目标的落点）。
   */
  function renderRite() {
    const s = state();
    if (!s) return;
    const host = $('rite-overlay');
    if (!host) return;
    const rite = typeof peekRite === 'function' ? peekRite() : null;
    if (!rite || !rite.text) { host.hidden = true; host.innerHTML = ''; return; }
    host.hidden = false;
    host.innerHTML = `<div class="rite-card rite-${rite.phase}">`
      + `<div class="rite-text">${rite.text}</div>`
      + `<button class="btn rite-skip" data-rite-skip="1">跳过</button></div>`;
  }

  function render() {
    const s = state();
    if (!s) return;
    const d = derive(s);
    const now = Date.now();

    updateTopbar(s, d);
    updateOverview(s, d);
    updateDashboard(s);
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
    renderRite();   // 【策划 C16 / 任务 T-9】过场浮层（无待播念白时自动收起）
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
    setTechLine,
    askQuiz,
    quiz: quizView,
    /** 暴露给调试用：控制台里能直接调 ui.actions.buy('field') 之类。 */
    actions,
    /** 给测试看的：某个面板是否折叠 */
    isPanelCollapsed: panelCollapsed,
  };
}
