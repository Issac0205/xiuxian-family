/* ─────────────────────── 载入与离线结算─────────────────────── */

let state = readSave() || createState();
const isFresh = state.stats.playSeconds === 0 && state.log.length === 0;

/**
 * 全局随机源。默认就是Math.random；测试可以换成播过种的，
 * 这样「轻松模式掷骰子」「祛障丹成算」「商路1% 秘闻」都能复现。
 */
let rng = Math.random;

/** @type {ReturnType<typeof createUI>} */
let ui;

/**
 * 所有要花银两的操作都走这里：先算好代价（plan），答对才兑现（commit）。
 * 答错时普通难度什么都不做（材料返还），地狱难度按 plan.cost 扣钱。
 *
 * 答题频率由settings.quizMode 决定：
 *   学习 always ——每次都问；轻松half ——掷骰子；免答 off ——直接执行。
 */
function requestOperation(kind, id, mode) {
  const plan = planStatus(state, kind, id, mode === undefined ? state.ui.buyMode : mode);

  if (!plan.ok) {
    ui.toast(plan.reason, 'warn', 1700);
    ui.render();
    return plan;
  }

  // 免答 / 轻松模式下这次不抽题，直接执行
  if (!shouldAsk(state, rng)) {
    const done = commitPlan(state, plan, Date.now(), rng);
    if (!done.ok) ui.toast(done.reason || '操作未能生效', 'warn', 1600);
    ui.render();
    return plan;
  }

  ui.askQuiz(plan, (correct, question, pickedIndex) => {
    recordAnswer(state, question, pickedIndex);

    if (correct) {
      const done = commitPlan(state, plan, Date.now(), rng);
      if (!done.ok) ui.toast(done.reason || '操作未能生效', 'warn', 1600);
    } else if (state.settings.difficulty === 'hell') {
      const lost = applyPenalty(state, plan);
      if (lost > 0) {
        const unit = plan.currency === 'stones' ? `${fmtStones(lost)} 枚灵石` : `${fmt(lost)} 两银`;
        writeLog(
          state,
          `答错「{question.word}」，地狱难度下损失${unit}（正确释义：${question.answer}）。`,
          'quiz',
          null,
          Date.now(),
        );
      }
    } else {
      writeLog(
        state,
        `答错「{question.word}」（正确释义：{question.answer}），操作未生效，材料已返还。`,
        'quiz',
        `quiz:${question.wordId}`,
        Date.now(),
      );
    }

    ui.render();
  });

  return plan;
}

ui = createUI({
  getState: () => state,
  actions: {
    buy(id) {
      return requestOperation('buy', id);
    },

    research(techId) {
      return requestOperation('research', techId);
    },

    /**
     * 参悟仙道科技。与 research 同构，但代价是**灵石 + 银两双付**，
     * 所以走自己的 plan/commit 一对（见 core/engine.js 的 planImmortalResearch）。
     */
    researchImmortal(techId) {
      return requestOperation('immortalResearch', techId);
    },

    trade(routeId) {
      return requestOperation('trade', routeId);
    },

    /** 批量派遣：整批只出一道题。*/
    tradeFleet(routeId, fleet) {
      return requestOperation('tradeFleet', routeId, fleet === 'half' ? 'half' : 'all');
    },

    /** 云深谷坊市：银两换灵石。走答题。*/
    exchange() {
      return requestOperation('exchange', 'yunshen');
    },

    /** 服祛障丹：灵石换炼气人口的几率。走答题。*/
    pill(pillId) {
      return requestOperation('pill', pillId);
    },

    /** 切换页面。*/
    setPage(page) {
      // 还没露出来的页签不接受跳转（比如开局时按了「轮回」的锚点。
      if (!PAGES.includes(page) || state.ui.page === page) return;
      if (!pageVisible(state, page)) return;
      state.ui.page = page;
      ui.syncPage();
      ui.render();
      window.scrollTo({ top: 0, behavior: 'instant' in window ? 'instant' : 'auto' });
    },

    /** 格物页的两条线：'mortal' 或 'immortal'。 */
    setTechLine(line) {
      ui.setTechLine(line);
    },

    /** 格物页：隐藏 / 显示已研习的科技。*/
    toggleHideDone() {
      state.ui.hideDoneTechs = !state.ui.hideDoneTechs;
      ui.syncHideDone();
    },

    /** 折叠 / 展开某个面板。*/
    togglePanel(key) {
      if (!key) return;
      const collapsed = state.ui.collapsed;
      if (collapsed[key]) delete collapsed[key];
      else collapsed[key] = true;
      ui.syncCollapsed();
    },

    /** 拆售建筑。不触发答题——它是纠错动作，不是收益动作。*/
    sell(id) {
      const r = sellBuilding(state, id, 1);
      if (!r.ok) ui.toast(r.reason, 'warn', 1900);
      ui.render();
      return r;
    },

    setQuizMode(modeId) {
      const mode = QUIZ_MODE_MAP[modeId];
      if (!mode || state.settings.quizMode === modeId) return;
      state.settings.quizMode = modeId;
      ui.syncQuizMode();
      ui.render();
      ui.toast(`答题<b>${mode.name}</b>  ${mode.desc}`, modeId === 'always' ? 'info' : 'ok', 3200);
    },

    setDifficulty(mode) {
      if (!DIFFICULTIES[mode] || state.settings.difficulty === mode) return;
      state.settings.difficulty = mode;
      ui.syncDifficulty();
      ui.render();
      ui.toast(
        `难度<b>${DIFFICULTIES[mode].name}</b>  ${DIFFICULTIES[mode].desc}`,
        mode === 'hell' ? 'warn' : 'ok',
        3400,
      );
    },

    setSpeed(mode) {
      const speed = Number(mode);
      if (!SPEED_OPTIONS.includes(speed) || state.settings.speed === speed) return;
      state.settings.speed = speed;
      ui.syncSpeed();
      ui.render();
      ui.toast(
        speed === 1
          ? '游戏速度<b>1×</b>（原速）'
          : `游戏速度<b>${speed}×</b>　离线收益仍按 1× 结算`,
        speed > 1 ? 'ok' : 'info',
        2600,
      );
    },

    assignCultivator(id,job) {
      const p=state.cultivation?.cultivators?.find(person=>person.id===id);
      if(!p || !CULTIVATOR_JOBS[job] || p.job===job)return;
      if(job==='sect'){ui.toast('高天赋修士请使用宗门界面的入宗按钮','warn');return;}
      if(p.job==='sect'){ui.toast('宗门修士不得随意召回','warn');return;}
      p.job=job;
      writeLog(state,`${p.name}受命${CULTIVATOR_JOBS[job].name}。`,'cultivate',null,Date.now());
      ui.render();
      ui.toast(`${p.name}已指派：<b>${CULTIVATOR_JOBS[job].name}</b>`, 'ok', 1600);
    },

    setTheme(themeId) {
      if (!THEMES[themeId]) return;
      const current = document.body?.dataset.theme || document.documentElement.dataset.theme || 'classic';
      if (current === themeId) return;
      const applied = applyThemeChoice(themeId, true);
      ui.syncTheme();
      ui.render();
      ui.toast(`界面风格<b>${THEMES[applied].name}</b>`, 'ok', 2200);
    },

    bankError(message) { ui.toast(message,'warn',5000); },

    toggleBankAiPrompt() {
      const wrap=document.getElementById('bank-ai-preview-wrap');
      const toggle=document.getElementById('bank-ai-show');
      if(!wrap || !toggle) return;
      wrap.hidden=!wrap.hidden;
      toggle.setAttribute('aria-expanded', String(!wrap.hidden));
      toggle.textContent=wrap.hidden?'查看完整提示':'收起完整提示';
      if(!wrap.hidden) updateBankAiPreview();
    },

    async copyBankAiPrompt() {
      const value=makeBankAiPrompt();
      try {
        if(!navigator.clipboard?.writeText) throw new Error('剪贴板API不可用');
        await navigator.clipboard.writeText(value);
        ui.toast('已复制 AI 制题提示词。将它和复习资料一起发送给 AI 即可生成题库。','ok',4200);
      } catch(err) {
        // 离线本地文件或无剪贴板权限时，尝试旧版复制方式。
        const preview=document.getElementById('bank-ai-preview');
        const wrap=document.getElementById('bank-ai-preview-wrap');
        const toggle=document.getElementById('bank-ai-show');
        if(!preview || !wrap) return;
        wrap.hidden=false;
        if(toggle) { toggle.setAttribute('aria-expanded','true'); toggle.textContent='收起完整提示'; }
        preview.value=value;
        preview.focus(); preview.select();
        let copied=false;
        try { copied=document.execCommand('copy'); } catch(_) { /* 用户手动复制 */ }
        ui.toast(copied?'已复制提示词' : '浏览器不允许自动复制，提示词已全选，请按 Ctrl+C（手机长按）复制',copied?'ok':'warn',4700);
      }
    },

    downloadBankTemplate() {
      downloadJsonFile('修仙世家_题库模板.json',QUESTION_BANK_TEMPLATE);
      ui.toast('已下载题库模板，请将它连同复习资料交给 AI 生成正式题库。','ok',3600);
    },

    exportBank() {
      const b=activeQuestionBank();
      if (!b) return;
      const safe=b.title.replace(/[\\/:*?"<>|]/g,'_').slice(0,70);
      downloadJsonFile(`${safe}.json`,{
        format:'xiuxian-question-bank',version:1,title:b.title,description:b.description,
        questions:b.questions.map(q=>({...q,answer:'ABCD'[q.answer]}))
      });
      ui.toast(`已导出题。<b>${escapeBankHtml(b.title)}</b> 的备份。`,'ok',2500);
    },

    async importBankFile(file) {
      try {
        if (file.size>BANK_MAX_FILE_BYTES) throw new Error('文件超过 2 MB，请拆分为多份题目');
        if (questionBankLibrary.banks.length>=BANK_MAX_ITEMS) throw new Error('最多可保存 12 份自定义题库，请先删除不需要的题库');
        const raw=JSON.parse(await file.text());
        const parsed=normalizeQuestionBank(raw);
        const b={id:'bank-'+Date.now().toString(36)+'-'+Math.random().toString(36).slice(2,10),
          ...parsed};
        const next={selected:b.id,banks:[...questionBankLibrary.banks,b]};
        const saved=saveBankLibrary(next);
        if(!saved.ok)throw new Error(saved.message);
        ui.render();
        ui.toast(`成功导入 <b>${escapeBankHtml(b.title)}</b>，共 ${b.questions.length} 道题，已切换为当前题库。`,'ok',5000);
      } catch(err) {
        ui.toast('导入失败：'+(err instanceof SyntaxError?'JSON 文件语法错误，检查引号和逗号':err.message),'warn',6500);
      }
    },

    selectBank(id) {
      if (!id || (id!==BUILTIN_BANK_ID && !questionBankLibrary.banks.some(b=>b.id===id))) return;
      const saved=saveBankLibrary({...questionBankLibrary,selected:id});
      if(!saved.ok){ui.toast(saved.message,'warn',5000);return;}
      ui.render();ui.toast(`当前题库。b>${escapeBankHtml(currentBankLabel())}</b>`,'ok',2500);
    },

    deleteBank(id) {
      const bank=questionBankLibrary.banks.find(b=>b.id===id);
      if(!bank)return;
      if(!window.confirm(`确认删除题库。{bank.title}」？如无原始 JSON 文件，将无法恢复。`))return;
      const next={selected:questionBankLibrary.selected===id?BUILTIN_BANK_ID:questionBankLibrary.selected,
        banks:questionBankLibrary.banks.filter(b=>b.id!==id)};
      const saved=saveBankLibrary(next);
      if(!saved.ok){ui.toast(saved.message,'warn',5000);return;}
      ui.render();ui.toast(`题库。{escapeBankHtml(bank.title)}」已删除`,'ok');
    },

    save() {
      const ok = writeSave(state);
      ui.toast(ok ? '已存档' : '存档失败：浏览器本地存储不可用', ok ? 'ok' : 'warn', 1500);
    },

    reset() {
      if (!window.confirm('确定重开？当前世家进度与背单词记录都将清空，无法找回。）')) return;
      clearSave();
      state = createState();
      ui.quiz.reset();
      ui.syncBuyMode();
      ui.syncDifficulty();
      ui.syncSpeed();
      ui.syncTheme();
      ui.syncQuizMode();
      ui.syncPage();
      ui.syncHideDone();
      ui.render();
      ui.toast('世家重立，自凡尘再起', 'ok', 2200);
    },

    setBuyMode(mode) {
      if (!['1', '10', 'max'].includes(mode)) return;
      state.ui.buyMode = mode;
      ui.syncBuyMode();
      ui.render();
    },
  },
});

// 离线（含关闭页面后重开）结。
const bootTime = Date.now();
const away = (bootTime - (state.lastSeen || bootTime)) / 1000;

if (away > 5) {
  const rep = settleOffline(state, away, bootTime);
  if (rep) {
    writeLog(
      state,
      `离山 ${fmtDuration(rep.seconds)}，归时得。${fmt(rep.silverGain)} 两，` +
        `族中人口 ${fmt(rep.popFrom, 1)} 。${fmt(rep.popTo, 1)}。`,
      'offline',
      null,
      bootTime,
    );
    ui.render();
    ui.reportOffline(rep);
  }
}

state.lastSeen = bootTime;
ui.render();

if (isFresh) {
  ui.toast(
    '世家初立：先。b>田地</b>催生人口。此后每次营造、研习、派遣，' +
      '都要先答对一道当前题库的题目。',
    'info',
    7000,
  );
  writeLog(state, '世家初立，凡尘之路自此始。', 'unlock', null, bootTime);
  ui.render();
}

/* ─────────────────────── 主循是─────────────────────── */

let last = Date.now();
let saveAccum = 0;

/** 当前倍速，兜底。1。*/
function currentSpeed() {
  const v = Number(state.settings.speed);
  return v > 0 ? v : 1;
}

const timer = setInterval(() => {
  const now = Date.now();
  const realDt = Math.max(0, (now - last) / 1000);
  last = now;

  if (realDt > MAX_FRAME_SECONDS) {
    // 定时器被挂起了（合盖、休眠、浏览器冻结标签页）。
    // 这一段按离线处理。 倍速、有上限，免得「开 5 倍速挂后台」变成刷收益2
    settleOffline(state, realDt, now);
  } else {
    advanceTick(state, realDt * currentSpeed(), now, rng);
  }

  ui.render();

  saveAccum += realDt;
  if (saveAccum * 1000 >= SAVE_INTERVAL_MS) {
    saveAccum = 0;
    writeSave(state);
  }
}, TICK_MS);

/* ─────────────────────── 生命周期 ─────────────────────── */

document.addEventListener('visibilitychange', () => {
  // 后台标签页的定时器会被节流，但仍在跑，所以这里只需要对齐时间基2+ 存档，
  // 真正的「长时间没跑」由主循环里，MAX_FRAME_SECONDS 分支兜底。
  last = Date.now();
  if (document.hidden) {
    writeSave(state);
    return;
  }
  ui.render();
});

function persist() {
  state.lastSeen = Date.now();
  writeSave(state);
}

window.addEventListener('pagehide', persist);
window.addEventListener('beforeunload', persist);

// 便于调试：控制台可访。__xiuxian.state
window.__xiuxian = {
  get state() { return state; },
  get ui() { return ui; },
  /** 界面上所有可发起的操作，控制台里可以直接调定*/
  get actions() { return ui.actions; },
  quiz: () => ui.quiz.snapshot(),
  speed: () => currentSpeed(),
  /** 换掉全局随机源；。null 恢复 Math.random。测试与复现 bug 用。*/
  setRng: (fn) => { rng = typeof fn === 'function' ? fn : Math.random; },
  /** 换成可播种的随机源，同一种子跑出同一局。*/
  seedRng: (seed) => { rng = createRng(seed); return rng; },
  /** 造一个新的可播种随机源（不改全局的），测试里用来做大样本。*/
  makeRng: (seed) => createRng(seed),
  /** 凡人科技：与人脑里那张「格物」表一一对应。 */
  tech: {
    tiers: () => TECH_TIERS,
    catalog: () => TECHS,
    status: (id) => techStatus(state, TECH_MAP[id]),
    researched: (id) => isResearched(state, id),
    unlocked: (id) => isTechUnlocked(state, TECH_MAP[id]),
    researchable: () => researchableCount(state),
    /** 界面上的收益文案（与 commitResearch 记进纪事的那一份是同一个函数）。 */
    gains: (id) => techGainText(TECH_MAP[id], BUILDING_MAP[TECH_MAP[id]?.unlocksBuilding]?.name),
  },
  /** 仙道科技：两条线咬合的另一半。查询与研习都从这里走。*/
  immortal: {
    tiers: () => IMMORTAL_TECH_TIERS,
    catalog: () => IMMORTAL_TECHS,
    map: () => IMMORTAL_TECH_MAP,
    owned: () => (state.immortalTechs || []).slice(),
    researched: (id) => isImmortalTechResearched(state, id),
    status: (id) => immortalTechStatus(state, IMMORTAL_TECH_MAP[id]),
    plan: (id) => planImmortalResearch(state, id),
    missing: (id) => immortalTechMissing(state, IMMORTAL_TECH_MAP[id]),
    research: (id) => researchImmortal(state, id),
    /** 两条线的全部咬合点：谁 require 了谁。文档与审计都读这个。*/
    crossLinks: () => {
      const mortalIds = new Set(TECHS.map((t) => t.id));
      const out = [];
      for (const t of IMMORTAL_TECHS) {
        for (const r of t.requires || []) {
          if (mortalIds.has(r)) out.push({ from: r, fromTree: 'mortal', to: t.id, toTree: 'immortal' });
        }
      }
      for (const t of TECHS) {
        for (const r of t.requiresImmortal || []) {
          out.push({ from: r, fromTree: 'immortal', to: t.id, toTree: 'mortal' });
        }
      }
      return out;
    },
  },
  /** 仙凡经济：城里的作坊、坊市的兑率、矿场。一条命令看全咬合面。*/
  cityEconomy: () => {
    const d = derive(state);
    return {
      laborWorkers: d.laborWorkers,
      laborDeath: d.laborDeath,
      marketWorkerBonus: d.marketWorkerBonus,
      cityMaterialMult: d.cityMaterialMult,
      herbPerSec: d.cityHerbPerSec,
      orePerSec: d.cityOrePerSec,
      runePerSec: d.cityRunePerSec,
      workshopWorkers: (id) => cityWorkersOf(state, id),
      exchange: marketExchangeQuote(state),
      exchangeCount: marketExchangeCount(state),
      exchangeLimit: marketExchangeLimit(state),
      immortalCap: cultivatorLimit(state),
      innatePoolBonus: innatePoolBonus(state),
    };
  },
  /** 秘籍：目录、当前加成、掉落、换装、参悟。控制台与测试都用它。*/
  manual: {
    catalog: () => CULTIVATION_MANUALS,
    bonus: () => manualBonus(state),
    /** 某个人实际吃到的加成（过了灵根与专精）。*/
    bonusFor: (pid) => manualBonusFor(state, findCultivator(state, pid)),
    /** 某个人实际吃到的修炼倍率。*/
    trainingFor: (pid) => manualTrainingMultiplierFor(state, findCultivator(state, pid)),
    training: () => manualTrainingMultiplier(state),
    owned: () => (state.cultivation.manuals || []).slice(),
    attuneOf: (id) => manualAttune(state, id),
    grant: (tier, rngFn) => grantManual(state, tier, rngFn || rng),
    equip: (id, slot) => equipManual(state, id, slot),
    attune: (id) => attuneManual(state, id, rng),
    daoTaken: (dao, exceptId) => manualDaoTaken(state, dao, exceptId),
    /** 洞天生还率（面板预估、确认框、结算三处共用同一个函数）。*/
    survival: (personId, nodeId) => caveSurvival(
      state,
      state.cultivation.cultivators.find((p) => p.id === Number(personId)),
      mapNode(nodeId),
    ),
  },
  /** 地图：抵达、占领、镇守、产出。*/
  map: {
    nodes: () => MAP_NODES,
    node: (nodeId) => mapNode(nodeId),
    neighbors: (nodeId) => mapNeighbors(mapNode(nodeId)),
    nodeStatus: (nodeId) => mapNodeStatus(state, nodeId),
    accessible: (nodeId) => mapAccessible(state, nodeId),
    reached: () => worldOf(state).reached.slice(),
    held: () => worldOf(state).held.slice(),
    plan: (nodeId) => mapPlan(state, nodeId),
    explore: (personId, nodeId, rngFn) => commitExplore(state, nodeId, personId, Date.now(), rngFn || rng),
    attack: (nodeId, rngFn) => commitAttack(state, nodeId, Date.now(), rngFn || rng),
    yieldPerSec: () => mapYieldPerSec(state),
    holdPower: (nodeId) => mapHoldPower(mapNode(nodeId)),
    holdStrength: (nodeId) => mapHoldStrength(state, nodeId),
    isPacified: (nodeId) => mapIsPacified(state, nodeId),
    garrison: (nodeId, pid) => mapAssignGarrison(state, nodeId, pid),
    garrisonCandidates: () => mapGarrisonCandidates(state).map((p) => p.id),
    clearGarrison: (nodeId) => mapClearGarrison(state, nodeId),
    unrest: (nodeId) => Number(worldOf(state).unrest[nodeId]) || 0,
    tick: (seconds) => advanceTerritories(state, seconds, Date.now()),
  },
  /** 炼丹：药材、丹药、丹方成功率、丹炉。*/
  alchemy: {
    table: () => ({ herbs: ALCHEMY_HERBS, recipes: ALCHEMY_RECIPES, furnace: ALCHEMY_FURNACE }),
    herbs: () => ({ ...alchemyOf(state).herbs }),
    herb: (id) => herbCount(state, id),
    herbPerSec: () => herbPerSec(state),
    pills: () => ({ quzhang: pillCount(state, 'quzhang'), ...alchemyOf(state).pills }),
    pill: (id) => pillCount(state, id),
    addPills: (id, n) => { addPills(state, id, n); return pillCount(state, id); },
    addHerbs: (id, n) => { addHerbs(state, id, n); return herbCount(state, id); },
    furnace: () => alchemyOf(state).furnace,
    furnacePlan: () => furnaceUpgradePlan(state),
    upgradeFurnace: () => commitFurnaceUpgrade(state),
    alchemist: () => alchemist(state),
    woodBonus: () => alchemyWoodBonus(state),
    proficiency: (id) => proficiency(state, id),
    rate: (id) => recipeRate(state, id),
    out: (id) => recipeYield(state, id),
    plan: (id) => recipePlan(state, id),
    craft: (id, rngFn) => commitCraft(state, id, Date.now(), rngFn || rng),
  },
  /** 炼器：矿料、法器、装备与耐久、锻造台。*/
  forge: {
    table: () => ({ ores: FORGE_ORES, slots: FORGE_SLOTS, items: FORGE_ITEMS, levels: FORGE_LEVELS }),
    ores: () => ({ ...forgeOf(state).ores }),
    ore: (id) => oreCount(state, id),
    orePerSec: () => orePerSec(state),
    addOres: (id, n) => { addOres(state, id, n); return oreCount(state, id); },
    owned: () => forgeOf(state).owned.slice(),
    equipped: () => ({ ...forgeOf(state).equipped }),
    durability: (id) => durabilityOf(state, id),
    level: () => forgeOf(state).level,
    levelPlan: () => forgeUpgradePlan(state),
    upgradeLevel: () => commitForgeUpgrade(state),
    smith: () => smith(state),
    metalBonus: () => forgeMetalBonus(state),
    proficiency: (id) => forgeProficiency(state, id),
    rate: (id) => forgeRate(state, id),
    plan: (id) => forgePlan(state, id),
    make: (id, rngFn) => commitForge(state, id, Date.now(), rngFn || rng),
    equip: (id) => equipArtifact(state, id),
    unequip: (slot) => unequipSlot(state, slot),
    repairPlan: (id) => repairPlan(state, id),
    repair: (id) => commitRepair(state, id, Date.now()),
    bonus: () => artifactBonus(state),
    wear: (reason) => wearArtifacts(state, reason),
    /** 直接塞一件法器进库（测试与调试用，照 runes.give 的形状）。*/
    give: (id, n) => {
      const f = forgeOf(state);
      if (!FORGE_ITEM_MAP[id]) return 0;
      const add = Math.max(1, Math.floor(Number(n) || 1));
      for (let i = 0; i < add; i += 1) {
        if (!f.owned.includes(id)) f.owned.push(id);
        f.durability[id] = FORGE_DURABILITY_MAX;
      }
      return f.owned.length;
    },
  },
  /** 炼符：符文、符箓存货与保质期、挂着的加成、符台。*/
  runes: {
    table: () => ({ mats: RUNE_MATERIALS, items: RUNE_ITEMS, bench: RUNE_BENCH_LEVELS, shelfHours: RUNE_SHELF_HOURS }),
    mats: () => ({ ...runesOf(state).mats }),
    mat: (id) => runeMatCount(state, id),
    matPerSec: () => runePerSec(state),
    addMats: (id, n) => { addRuneMats(state, id, n); return runeMatCount(state, id); },
    stock: (id) => runeCount(state, id),
    expiresIn: (id) => runeExpiresIn(state, id),
    bench: () => runesOf(state).bench,
    benchPlan: () => benchUpgradePlan(state),
    upgradeBench: () => commitBenchUpgrade(state),
    runist: () => runist(state),
    fireBonus: () => runeFireBonus(state),
    proficiency: (id) => runeProficiency(state, id),
    rate: (id) => runeRate(state, id),
    plan: (id) => runePlan(state, id),
    make: (id, rngFn) => commitRune(state, id, Date.now(), rngFn || rng),
    use: (id) => useRune(state, id, Date.now()),
    /** 直接塞一张符进存货（测试与调试用）。*/
    give: (id, n = 1, hours) => {
      if (!RUNE_ITEM_MAP[id]) return 0;
      const r = runesOf(state);
      const shelf = (hours === undefined ? RUNE_SHELF_HOURS : hours) * 3600 * 1000;
      const e = r.stock[id];
      if (!e || e.n <= 0) r.stock[id] = { n: Math.max(0, n), expiresAt: Date.now() + shelf };
      else e.n += Math.max(0, n);
      return runeCount(state, id);
    },
    pending: (kind) => ({ cave: runePending(state, 'cave'), attack: runePending(state, 'attack'), break: runePending(state, 'break') }),
    trainingMult: () => runeTrainingMult(state),
    advance: (seconds) => advanceRunes(state, seconds, Date.now()),
  },
  /** 可见性策略：此刻该让玩家看到什么。*/
  visible: {
    pages: () => visiblePages(state),
    page: (p) => pageVisible(state, p),
    block: (k) => immortalBlockVisible(state, k),
    anyCrafting: () => anyCraftingVisible(state),
    /** 【策划 C15 / 任务 T-2】境界仪表盘现在该渲染哪一格。*/
    dashboardKey: () => realmDashboardKey(state),
    dashboard: (key) => dashboardVisible(state, key),
    highestRealm: () => highestRealmIndex(state),
  },
  /** 各数据表。调试与测试。—。也方便在控制台里直接核对数值—*/
  data: {
    buildings: BUILDINGS, techs: TECHS, map: MAP_NODES,
    /** 仙道科技：两条线咬合的那一半。 */
    immortalTechs: IMMORTAL_TECHS, immortalTechTiers: IMMORTAL_TECH_TIERS,
    /** 效果键 → 展示文案。测试用来自查「每个键都登记了文案」。 */
    effectLabels: EFFECT_LABELS,
    /** 合法的 effect 键清单（凡人侧 / 仙道侧）。测试用来自查「数据表里没有野键」。 */
    mortalEffectKeys: MORTAL_EFFECT_KEYS,
    immortalEffectKeys: IMMORTAL_EFFECT_KEYS,
    realms: REALM_TIERS, gates: REALM_GATES, roots: ROOT_GRADES,
    herbs: ALCHEMY_HERBS, recipes: ALCHEMY_RECIPES, furnace: ALCHEMY_FURNACE,
    ores: FORGE_ORES, artifacts: FORGE_ITEMS, smithLevels: FORGE_LEVELS,
    runeMats: RUNE_MATERIALS, runes: RUNE_ITEMS, benchLevels: RUNE_BENCH_LEVELS,
    jobs: CULTIVATOR_JOBS, daos: MANUAL_DAOS, manuals: CULTIVATION_MANUALS,
    chapters: CODEX_CHAPTERS,
    /** 流派与道心：R10 新增。测试要拿它们核对数量与档位边界。 */
    schools: MANUAL_SCHOOLS, moralityTiers: MORALITY_TIERS,
  },
  /** 道心：读写与三条后果。 */
  morality: {
    get: () => moralityOf(state),
    tier: () => moralityTierOf(state),
    tierOf: (v) => moralityTier(v),
    add: (d) => addMorality(state, d),
    advance: (dt) => advanceMorality(state, dt),
    caveBonus: () => moralityCaveBonus(state),
    warBonus: () => moralityWarBonus(state),
    taxMult: () => moralityTaxMult(state),
    goodDeedPlan: () => goodDeedPlan(state),
    goodDeed: () => commitGoodDeed(state),
  },
  /** 流派：主修位的机制与流血。 */
  school: {
    main: () => mainSchoolOf(state),
    fx: (k) => schoolFx(state, k),
    drift: () => schoolDrift(state),
    unlocks: (a) => schoolUnlocks(state, a),
    birthMult: () => schoolBirthMult(state),
    deathMult: () => schoolDeathMult(state),
    humanPill: {
      count: () => humanPillCount(state),
      plan: () => humanPillPlan(state),
      commit: () => commitHumanPill(state),
      usePlan: (id) => humanPillUsePlan(state, id),
      use: (id) => commitUseHumanPill(state, id),
    },
  },
  /** 百科：条目书与统计。*/
  codex: {
    book: () => codexBook(state),
    /** 【本轮新增】原始条目定义（lines 还是函数、seen/hint 都还在）——
     *  测试要核对「数据引文取自活表」时用它，book() 那一份已经算成字符串了。 */
    raw: () => CODEX_CHAPTERS,
    /** 用一份「假想状态」算书。测试解锁逻辑用（不影响真实存档）。*/
    bookFor: (s) => codexBook(s),
    stats: () => codexStats(state),
    search: (q, chapter) => codexSearch(state, q, chapter),
    latest: () => codexLatestSeen(state),
    /** 直接跑一条（可能不存在的）条目定义，测试兜底逻辑用。*/
    lines: (entry) => codexEntryLines(entry, state),
    chapter: (id) => state.ui.codexChapter = id,
    query: (q) => state.ui.codexQuery = q,
    render: (force) => renderCodex(force),
  },
  /** 轮回：周目与金手指。*/
  cycle: {
    fingers: () => GOLDEN_FINGERS,
    slots: () => GOLDEN_FINGER_SLOTS,
    minIndex: () => REINCARNATION_MIN_INDEX,
    meta: () => ({ ...metaOf(state), unlocked: metaOf(state).unlocked.slice(), active: metaOf(state).active.slice() }),
    progress: () => reincarnationProgress(state),
    reward: () => reincarnationReward(state),
    fx: () => ({
      train: metaTrainMult(state), material: metaMaterialMult(state),
      stone: metaStoneMult(state), break: metaBreakBonus(state), survival: metaSurvivalBonus(state),
    }),
    unlock: (id) => unlockFinger(state, id),
    setActive: (ids) => setActiveFingers(state, ids),
    /** 直接给点（测试与调试用）。*/
    grantPoints: (n) => { metaOf(state).points = Math.max(0, metaOf(state).points + Math.floor(n || 0)); return metaOf(state).points; },
    commit: (ids) => commitReincarnation(state, ids),
    render: (force) => renderCycle(force),
  },
  /** 派生数值。*/
  derive: () => derive(state),
  /** 境界与突破。控制台里查进度、算成功率、直接冲关。*/
  realm: {
    table: () => ({ tiers: REALM_TIERS, gates: REALM_GATES, max: REALM_MAX_INDEX, rate: REALM_XP_RATE }),
    at: (i) => realmInfo(i),
    name: (i) => realmName(i),
    xpNeeded: (i) => realmXpNeeded(i),
    power: (i) => realmPower(i),
    gate: (i) => realmGate(i),
    stateOf: (pid) => breakthroughState(findCultivator(state, pid)),
    // 【策划 C15 / 任务 T-2】统一状态机：一个入口给出九个状态之一。
    personState: (pid) => personState(findCultivator(state, pid)),
    /** 某人的境界寿元上限（年）与剩余（年）。出处：docs/91 §三 T-2b 表。 */
    lifespan: (pid) => {
      const p = findCultivator(state, pid);
      if (!p) return null;
      const max = realmLifespan(p.realmIndex);
      const used = Math.max(0, (Number(state.clock?.year) || 0) - (Number(p.realmEnteredYear) || 0));
      return { max, used, left: max - used };
    },
    /** 【策划 C6 / 任务 T-6】丹纹档位与金丹三档火候。测试要逐档核对。 */
    coreGrades: () => CORE_GRADES,
    coreFolds: () => CORE_FOLDS,
    coreOf: (pid) => coreOf(findCultivator(state, pid)),
    coreGradeOf: (marks) => coreGradeOf(marks),
    coreChancesLeft: (pid) => coreChancesLeft(findCultivator(state, pid)),
    dashboard: () => coreDashboard(state),
    foldPlan: (pid, foldId) => foldPlan(state, pid, foldId),
    /** 【策划 C6 / 任务 T-6】兑现一次结丹（测试与调试用；界面走 data-fold 按钮）。 */
    fold: (pid, foldId, rngFn) => commitFold(state, pid, foldId, Date.now(), rngFn || rng),
    /** 【策划 C4 / T-5】兑现一次冲关（带 siteId），测试与调试用。 */
    commitWith: (pid, siteId, rngFn) => commitBreakthrough(state, pid, Date.now(), rngFn || rng, siteId),
    /** 【策划 C4 / 任务 T-5】择地筑基的候选 / 预览 / 散功重修。 */
    foundationSites: () => foundationSiteOptions(state),
    foundationPlan: (pid, siteId) => foundationPlan(state, pid, siteId),
    foundationGrade: (tier, held) => foundationGrade(tier, held),
    /** 【策划 C4 / 任务 T-5】某人的道基词条倍率。
     *  - `siteHeld`（默认 true）：地块是否仍被有效镇守 —— 丢了就 −50%。出处：docs/91 §三 T-5 验收标准 7。
     *  - `useSite`（默认 true）：是否按**地块当前状态**重算品阶（晋档/掉档）；
     *    传 false 时只按落库时冻结的品阶算 —— 用来单独验证「减半」这一条。 */
    foundationEntryMult: (pid, siteHeld = true, useSite = true) => {
      const p = findCultivator(state, pid);
      if (!p || !p.foundation) return 1;
      const site = useSite && p.foundation.nodeId ? mapNode(p.foundation.nodeId) : null;
      return foundationEntryMult(p, site, siteHeld);
    },
    /** 该修士的道基所在地现在是否仍被有效镇守。 */
    foundationSiteHeld: (pid) => {
      const p = findCultivator(state, pid);
      if (!p || !p.foundation) return false;
      return mapHeld(state, p.foundation.nodeId) && mapIsPacified(state, p.foundation.nodeId);
    },
    /** 【策划 C4 / 任务 T-5】单块领地每秒的赋税（已含土系道基）。 */
    mapYieldOf: (nodeId) => mapYieldOf(state, nodeId),
    earthQi: () => EARTH_QI,
    dissolvePlan: (pid) => dissolveFoundationPlan(state, pid),
    dissolve: (pid) => commitDissolveFoundation(state, pid, Date.now()),
    // 【策划 C4 / 任务 T-5】第三个参数是 siteId（择地筑基的那块地）
    plan: (pid, siteId) => breakthroughPlan(state, pid, siteId),
    rate: (pid, failures) => {
      const p = findCultivator(state, pid);
      return p ? realmBreakRate(p.realmIndex, p.talent,
        failures === undefined ? p.breakFailures : failures, rootBreakBonus(p)) : null;
    },
    commit: (pid, rngFn) => commitBreakthrough(state, pid, Date.now(), rngFn || rng),
    // 【策划 C4 / 任务 T-5】择地那一道要带 siteId 才询得动价
    best: (siteId) => bestBreakthroughCandidate(state, siteId),
    pacing: () => realmPacing(),
  },
  /** 灵根。控制台里查资质、算效果、重测。*/
  root: {
    table: () => ({ grades: ROOT_GRADES, elements: ROOT_ELEMENTS, daoElement: MANUAL_DAO_ELEMENT }),
    roll: (innate, rngFn) => rollRoot(rngFn || rng, Boolean(innate)),
    text: (pid) => rootText(findCultivator(state, pid)),
    grade: (pid) => rootGradeOf(findCultivator(state, pid)),
    speed: (pid) => rootSpeedMult(findCultivator(state, pid)),
    breakBonus: (pid) => rootBreakBonus(findCultivator(state, pid)),
    cap: (pid) => rootLevelCap(findCultivator(state, pid)),
    elements: (pid) => rootElementsOf(findCultivator(state, pid)),
    canLearn: (pid, manualId) => rootCanLearn(findCultivator(state, pid), CULTIVATION_MANUAL_MAP[manualId]),
    focus: (pid, manualId) => rootFocusMult(findCultivator(state, pid), CULTIVATION_MANUAL_MAP[manualId]),
    /** 直接改某个人的灵根，方便调试与测试。*/
    set: (pid, gradeId, elements) => {
      const p = findCultivator(state, pid);
      if (!p || !ROOT_GRADE_MAP[gradeId]) return null;
      const g = ROOT_GRADE_MAP[gradeId];
      p.root = {
        grade: gradeId,
        elements: Array.isArray(elements) ? elements.filter((e) => ROOT_ELEMENTS[e]).slice(0, g.count)
          : ROOT_ELEMENTS && pickElements(g.count, rng),
        rerolls: p.root?.rerolls || 0,
      };
      ui.render();
      return p.root;
    },
    rerollCost: (pid) => rootRerollCost(findCultivator(state, pid)),
    rerollPlan: (pid) => rootRerollPlan(state, pid),
    reroll: (pid, rngFn) => commitRootReroll(state, pid, rngFn || rng),
    referral: (pid) => sectReferralReward(findCultivator(state, pid)),
  },
  /**
   * 推进游戏时间，走的是主循环同一条路径。
   * 控制台里 __xiuxian.step(3600) 就是「快进一小时」。
   */
  step: (gameSeconds) => {
    tick(state, Number(gameSeconds) || 0, Date.now(), rng);
    ui.render();
    repaintExpansion(true);
    return state;
  },
  /**
   * 只推进数值，不重绘。
   * `step` 每次都会走一遍完整重绘，跑长程数值仿真时开销全在画界面上；
   * 平衡工具（scripts/balance.mjs）需要连续推进几万次 tick，所以单独开这个口子。
   * 语义与 `step` 完全一致，只少了渲染那一步。
   */
  tick: (gameSeconds) => tick(state, Number(gameSeconds) || 0, Date.now(), rng),
  /** 直接塞一名修士，方便调试。*/
  addCultivator: (origin = 'innate') => {
    const p = addCultivator(state, origin, Date.now(), true, origin === 'innate' ? 'cultivator-mortal' : '', rng);
    ui.render();
    repaintExpansion(true);
    return p;
  },
  timer,
  offlineCapHours: OFFLINE_CAP_HOURS,
  /** 【策划 C14 / 任务 T-2b】世界钟：只读快照，改年份请走 step()。*/
  clock: () => ({ year: Number(state.clock?.year) || 0 }),
  /** 【策划 T-0】线索经济：小数池与两条常驻速率，方便核对「产出 ≥ 门槛需求」。*/
  clues: () => ({
    clues: state.cultivation?.clues || 0,
    pool: Number(state.cultivation?.cluePool) || 0,
    perSec: Number(techEffects(state).cluePerSecFlat) || 0,
    secrets: state.secrets.length,
    poolTotal: SECRETS.length,
    /** 四道门槛累计需求（线索）。出处：data/realms.js 的 REALM_GATES。*/
    gateDemand: Object.values(REALM_GATES).reduce((a, g) => a + (g.clues || 0), 0),
  }),
  /**
   * 【策划 T-0 / 验收标准 2】直接走一次 `grantSecret()`。
   * 测试要验「秘闻池集齐之后，寻秘事件仍然产出线索」——
   * 池空即 return null 是旧行为，现在必须仍然 +1 线索。
   */
  grantSecretForTest: (random) => grantSecret(state, Date.now(), random || rng),
  /**
   * 【策划 T-1 / 任务 T-1 验收标准 1、2】存档往返与离线结算的调试出口。
   * 测试要能「完整走一遍 serialize → hydrate」并断言**值**不丢 ——
   * 这正是当初漏掉三个顶层字段却全绿的原因（旧断言只查 cultivation.* 内部）。
   */
  save: {
    serialize: () => serialize(state),
    hydrate: (raw) => hydrate(raw),
    /** 走一遍真实的「写出 → JSON → 读回」，返回读回后的状态。 */
    roundTrip: () => hydrate(JSON.parse(JSON.stringify(serialize(state)))),
    /** 只读一份存档（不改当前状态）。 */
    peek: () => JSON.parse(JSON.stringify(serialize(state))),
  },
  /** 【策划 C14 / 任务 T-2b 验收标准 2】离线结算：用来断言「离线不推年份」。 */
  offline: (seconds) => runOffline(state, Number(seconds) || 0, Date.now()),
};

/* ────────────── 新版仙途展示与操作 ────────────── */
function renderImmortalExpansion(){
 const el=document.getElementById('immortal-expansion');if(!el)return;
 const c=state.cultivation;repairCultivation(state);
 const ps=c.cultivators||[];
 const ready=c.veins.filter(v=>v.reserve>0);
 const activeMine=ready[0];
 const chosenCavePerson=document.getElementById('cave-person')?.value;
 const peopleSelect=ps.filter(p=>p.job!=='sect').map(p=>`<option value="${p.id}" ${String(p.id)===chosenCavePerson?'selected':''}>${p.name} · ${realmName(p.realmIndex)} · 天赋${Number(p.talent||1).toFixed(2)}</option>`).join('');
 const sectOptions=ps.filter(p=>p.job!=='sect'&&rootRank(p)>=SECT_MIN_ROOT_RANK).map(p=>`<option value="${p.id}">${p.name}（${rootText(p)}）</option>`).join('');
 const mainManual=c.equippedManual?CULTIVATION_MANUAL_MAP[c.equippedManual]:null;
 const assistManual=c.assistManual?CULTIVATION_MANUAL_MAP[c.assistManual]:null;

 /* 仙途页的每个分块都是可折叠的。
    折叠状态存在 ui.collapsed[key]，与其它面板共用同一套 syncCollapsed。
    visible=false 时加 hidden —— 用属性而不是不渲染，免得闭合标签对不上。 */
 const blk = (key, title, visible = true) => {
   const open = !state.ui.collapsed[key];
   return `<div class="immortal-block${open ? '' : ' is-collapsed'}" data-panel="${key}"${visible ? '' : ' hidden'}>`
     + `<div class="immortal-block-head"><h3>${title}</h3>`
     + `<button class="panel-toggle" type="button" data-toggle="${key}" title="折叠 / 展开" aria-expanded="${open}">▾</button></div>`;
 };
 el.innerHTML=`
${blk('pool','🌿 灵池 · 后天祛障')}<p>秘闻≥12后可在坊市购得灵池蓝图。灵池每秒消耗灵石，使凡人有机会后天祛障，初始天赋为1。无灵石时自动停运。</p>
<div class="immortal-statline"><span>灵池 ${c.pool}/10 座</span><span>灵石消耗 ${(c.pool*.00013).toFixed(5)}/秒</span><span>蓝图 ${c.poolBlueprint?'已得':'未得'}</span></div>
<div class="immortal-actions"><button class="btn" data-immortal-action="pool-blueprint" ${c.poolBlueprint||state.secrets.length<12?'disabled':''}>坊市购蓝图 · 2灵石</button><button class="btn" data-immortal-action="pool-build" ${!c.poolBlueprint?'disabled':''}>营造灵池 · 3灵石+5万银两</button></div></div>
${blk('mine','⛏️ 寻龙探脉 · 灵石矿场')}<p>秘闻≥15后研习寻龙尺，耗费灵石勘探不同品阶与储量的灵脉。矿场将持续产出灵石，并因危险作业额外损失凡人人口。</p>
<div class="immortal-statline"><span>寻龙尺 ${c.compass?'已研习':'未研习'}</span><span>灵脉 ${ready.length} 处可采</span><span>矿场 ${c.mineLevel?'已建成':'未建成'}</span><span>矿工 ${c.mineWorkers} 人</span></div>
<p>${activeMine?`当前矿脉（${activeMine.grade}阶） · 储量 ${activeMine.reserve.toFixed(2)} 灵石`:'目前尚无可开采的灵脉。'}</p>
<div class="immortal-actions"><button class="btn" data-immortal-action="compass" ${c.compass||state.secrets.length<15?'disabled':''}>寻龙尺 · 3灵石</button><button class="btn" data-immortal-action="survey" ${!c.compass?'disabled':''}>探寻灵脉 · 1灵石</button><button class="btn" data-immortal-action="mine-build" ${!ready.length||c.mineLevel?'disabled':''}>开设矿场 · 2灵石+8万银两</button></div>
${c.mineLevel?`<div class="immortal-actions"><label>矿工人数 <input id="mine-workers" type="number" min="0" max="1000" step="10" value="${c.mineWorkers}" style="width:95px"></label><button class="btn" data-immortal-action="mine-workers">调整派工</button></div>`:''}
<p class="immortal-warning">矿场可能显著提高凡人死亡人数，灵脉储量耗尽后需重新勘探；修士不受凡人矿难死亡率影响。</p></div>
${blk('sect','🏯 宗门修行 · 上等资质的安全道路')}<p>三灵根及以上的修士可入宗门修炼：安全稳定、不受洞天与攻伐折损，但不再提供驻守／劳作／探索加成，也不向家族传授宗门功法。入宗时宗门会按资质赠一份引荐礼（灵石）。</p>
<div class="immortal-statline"><span>在宗 ${ps.filter(p=>p.job==='sect').length} 人</span><span>平均天赋 ${averageTalent(state).toFixed(2)}</span></div>
<div class="immortal-actions"><select id="sect-person">${sectOptions||'<option value="">暂无合适人选</option>'}</select><button class="btn" data-immortal-action="sect" ${!sectOptions?'disabled':''}>送入宗门</button></div></div>
${blk('cave','🌀 洞天秘境 · 赌命求机缘')}<p>探索消耗可用秘闻线索和灵石；任何非宗门修士都能挑战任何级别洞天，但修为不足会大幅降低生还概率，失败可能永久失去修士。</p>
<div class="immortal-statline"><span>可用线索 ${c.clues} 条</span><span>历练次数 ${c.caveRuns}</span></div>
<div class="immortal-actions"><label>派遣修士 <select id="cave-person">${peopleSelect||'<option value="">尚无修士</option>'}</select></label></div>
<div class="immortal-mini">${CAVES.map((v)=>{const p=ps.find(q=>q.id===Number(chosenCavePerson))||ps.find(q=>q.job!=='sect');const chance=p?caveSurvival(state,p,v):0;const st=mapNodeStatus(state,v.id);const ok=st!=='locked';return `<div class="immortal-mini-row${ok?'':' is-locked'}"><div><b>${v.name}</b><span class="map-tier">T${v.tier}</span><small>${ok?`建议 ${realmName(v.realm)} · 消耗 ${v.fee} 灵石 / ${v.clues} 线索 · 预估生还 ${(chance*100).toFixed(1)}%`:'与此地不相邻 · 需先打通沿途'}</small></div><button class="btn" data-immortal-action="cave" data-map-node="${v.id}" ${!peopleSelect||!ok?'disabled':''}>${ok?'冒险进入':'未打通'}</button></div>`}).join('')}</div></div>
${blk('foe','⚔️ 攻伐势力 · 占领领地')}<p>家族综合战力影响胜率。攻下后获得灵石，可能缴获功法；战败可能有修士阵亡。已占领势力不可重复攻伐。</p>
<div class="immortal-mini">${FOES.map(f=>{const chance=Math.max(.05,Math.min(.95,derive(state).totalPower/(derive(state).totalPower+f.power)));const st=mapNodeStatus(state,f.id);const held=st==='held';const ok=st!=='locked';const hold=mapHoldPower(f);const strength=held?mapHoldStrength(state,f.id):0;const pacified=held&&strength>=hold;const unrest=Math.round((worldOf(state).unrest[f.id]||0)*100);const opts=mapGarrisonCandidates(state).map(q=>`<option value="${q.id}" ${worldOf(state).garrison[f.id]===q.id?'selected':''}>${q.name}（${realmName(q.realmIndex)} · 战力 ${Math.round(cultivatorPower(state,q))}）</option>`).join('');return `<div class="immortal-mini-row${ok?'':' is-locked'}"><div><b>${f.name}</b><span class="map-tier">T${f.tier}</span><small>${held?(pacified?`镇守 ${Math.round(strength)} / ${hold} · 赋税 ${(f.yield*3600).toFixed(1)} 灵石/时`:`<span class="map-warn">镇守不足 ${Math.round(strength)} / ${hold} · 民怨 ${unrest}%（满则叛离）</span>`):ok?`敌方战力 ${f.power} · 胜算 ${(chance*100).toFixed(1)}% · 攻下得 ${f.stones} 灵石 · 占领后需镇守 ${hold}`:'与此地不相邻 · 需先打通沿途'}</small></div>${held?`<span class="map-garrison"><select data-garrison-for="${f.id}">${opts||'<option value="">无人可派</option>'}</select><button class="btn" data-immortal-action="garrison" data-map-node="${f.id}" ${opts?'':'disabled'}>派往镇守</button></span>`:`<button class="btn" data-immortal-action="attack" data-map-node="${f.id}" ${ok?'':'disabled'}>${ok?'发起攻伐':'未打通'}</button>`}</div>`}).join('')}</div></div>
${blk('alchemy','⚗️ 丹房 · 炼药', immortalBlockVisible(state,'alchemy'))}<p>药材只从<b>已占领且有效镇守</b>的领地来——所以想炼丹就得先打通商路。每炼一炉<b>失败会损失全部材料</b>，先把丹炉升上去、把熟练度刷起来才划算。丹道属木，灵根带木的丹师有额外成功率。</p>
<div class="immortal-statline">${(()=>{const a=alchemyOf(state);const dm=alchemist(state);return `<span>丹炉 ${a.furnace} 级 · ${furnaceAt(a.furnace).name}（+${(furnaceAt(a.furnace).rateBonus*100).toFixed(0)}%）</span><span>丹师 ${dm?`${dm.name}${alchemyWoodBonus(state)>0?` · 木灵根 +${(alchemyWoodBonus(state)*100).toFixed(0)}%`:' · 无木灵根'}`:'<span class="map-warn">未指派</span>'}</span><span>累计开炉 ${a.crafts||0} 次</span>`})()}</div>
<div class="immortal-mini">${ALCHEMY_HERBS.map(h=>{const have=herbCount(state,h.id);const per=herbPerSec(state)[h.id]||0;return `<div class="immortal-mini-row"><div><b>${h.name}</b><span class="map-tier">T${h.tier}</span><small>${have.toFixed(1)} 份 · 产地 ${mapNode(h.node)?.name||'—'}${per>0?` · ${(per*3600).toFixed(1)} 份/时`:' · <span class="map-warn">未产出（该地未占领或镇守不足）</span>'}</small></div><span class="herb-count">${Math.floor(have)}</span></div>`}).join('')}</div>
<div class="immortal-mini">${ALCHEMY_RECIPES.map(r=>{const plan=recipePlan(state,r.id);const mat=Object.entries(r.materials).map(([k,v])=>`${ALCHEMY_HERB_MAP[k].name}×${v}`).join(' ');const need=ALCHEMY_FURNACE[r.furnace-1].name;return `<div class="immortal-mini-row${plan.ok?'':' is-locked'}"><div><b>${r.name}</b><span class="map-tier">${plan.prof?`熟练 ${plan.prof}/${ALCHEMY_PROFICIENCY_MAX}`:''}</span><small>${mat} · 成功率 ${(recipeRate(state,r.id)*100).toFixed(0)}% · 出 ${recipeYield(state,r.id)} 枚 · 需 ${need}</small>${plan.ok?'':`<small class="map-warn">${plan.reason}</small>`}</div><button class="btn" data-immortal-action="craft" data-recipe="${r.id}" ${plan.ok?'':'disabled'}>开炉</button></div>`}).join('')}</div>
<div class="immortal-actions">${(()=>{const up=furnaceUpgradePlan(state);return up.ok?`<button class="btn" data-immortal-action="furnace">升炉 → ${up.next.name} · ${up.stones} 灵石 + ${(up.silver/10000).toFixed(0)}万银两</button>`:`<span class="setting-tip">${up.reason}</span>`})()}</div></div>
${blk('forge','🔨 器坊 · 铸器', immortalBlockVisible(state,'forge'))}<p>矿料与药材同源（都来自已占领且有效镇守的领地），但材料各自独立，所以炼丹与炼器可以同时推。铸器<b>失败会损失全部矿料</b>；法器有<b>耐久</b>，攻伐与洞天都会磨损，耐久越低效果越弱，耗尽则失效，需花矿料重祭。金主锋锐，灵根带金的器师有额外成功率。</p>
<div class="immortal-statline">${(()=>{const f=forgeOf(state);const sm=smith(state);const art=artifactBonus(state);return `<span>锻造台 ${f.level} 级 · ${forgeAt(f.level).name}（+${(forgeAt(f.level).rateBonus*100).toFixed(0)}%）</span><span>器师 ${sm?`${sm.name}${forgeMetalBonus(state)>0?` · 金灵根 +${(forgeMetalBonus(state)*100).toFixed(0)}%`:' · 无金灵根'}`:'<span class="map-warn">未指派</span>'}</span><span>法器加成 <b>+${(art.power*100).toFixed(0)}%</b> 战力${art.survive>0?` · +${(art.survive*100).toFixed(0)}% 生还`:''}${art.broken.length?` · <span class="map-warn">${art.broken.join('、')}已失效</span>`:''}</span>`})()}</div>
<div class="immortal-mini">${FORGE_ORES.map(o=>{const have=oreCount(state,o.id);const per=orePerSec(state)[o.id]||0;return `<div class="immortal-mini-row"><div><b>${o.name}</b><span class="map-tier">T${o.tier}</span><small>${have.toFixed(2)} 份 · 产地 ${mapNode(o.node)?.name||'—'}${per>0?` · ${(per*3600).toFixed(2)} 份/时`:' · <span class="map-warn">未产出（该地未占领或镇守不足）</span>'}</small></div><span class="herb-count">${Math.floor(have)}</span></div>`}).join('')}</div>
<div class="immortal-mini">${FORGE_ITEMS.map(it=>{const plan=forgePlan(state,it.id);const owned=forgeOf(state).owned.includes(it.id);const eq=forgeOf(state).equipped[it.slot]===it.id;const dur=durabilityOf(state,it.id);const mat=Object.entries(it.materials).map(([k,v])=>`${FORGE_ORE_MAP[k].name}×${v}`).join(' ');const rp=repairPlan(state,it.id);return `<div class="immortal-mini-row${plan.ok||owned?'':' is-locked'}"><div><b>${it.name}</b><span class="map-tier">${FORGE_SLOT_MAP[it.slot].name}</span>${owned?`<span class="map-tier">耐久 ${Math.round(dur)}%</span>`:''}<small>${mat} · 成功率 ${(forgeRate(state,it.id)*100).toFixed(0)}% · 战力 +${(it.power*100).toFixed(0)}%${it.survive?` · 生还 +${(it.survive*100).toFixed(0)}%`:''} · 需 ${FORGE_LEVELS[it.forge-1].name}</small>${plan.ok||owned?'':`<small class="map-warn">${plan.reason}</small>`}</div><span class="map-garrison">${owned
   ?`${eq?'<span class="map-tier">已装备</span>':`<button class="btn" data-immortal-action="artifact-equip" data-artifact="${it.id}">装备</button>`}${rp.ok?`<button class="btn" data-immortal-action="artifact-repair" data-artifact="${it.id}">祭炼</button>`:''}`
   :`<button class="btn" data-immortal-action="forge" data-artifact="${it.id}" ${plan.ok?'':'disabled'}>开炉</button>`}</span></div>`}).join('')}</div>
<div class="immortal-actions">${(()=>{const up=forgeUpgradePlan(state);return up.ok?`<button class="btn" data-immortal-action="forge-level">升级 → ${up.next.name} · ${up.stones} 灵石 + ${(up.silver/10000).toFixed(0)}万银两</button>`:`<span class="setting-tip">${up.reason}</span>`})()}</div></div>
${blk('runes','📜 符房 · 画符', immortalBlockVisible(state,'runes'))}<p>符文与药材、矿料同源（都来自已占领且有效镇守的领地）。符箓是<b>一次性</b>的：画好之后 <b>${RUNE_SHELF_HOURS} 小时</b>内不用就会作废，所以宜<b>用多少画多少</b>。前三张符挂成「下一次」加成，等对应的行动来消费。火主炎上，灵根带火的符师有额外成功率。</p>
<div class="immortal-statline">${(()=>{const r=runesOf(state);const ru=runist(state);const pend=r.pending;const train=runeTrainingMult(state);return `<span>符台 ${r.bench} 级 · ${runeBenchAt(r.bench).name}（+${(runeBenchAt(r.bench).rateBonus*100).toFixed(0)}%）</span><span>符师 ${ru?`${ru.name}${runeFireBonus(state)>0?` · 火灵根 +${(runeFireBonus(state)*100).toFixed(0)}%`:' · 无火灵根'}`:'<span class="map-warn">未指派</span>'}</span><span>${train>1?`<b>聚灵符生效中 ×${train.toFixed(2)}</b>`:'无聚灵符'}${pend.cave?` · 护身符 +${(pend.cave*100).toFixed(0)}%`:''}${pend.attack?` · 破阵符 +${(pend.attack*100).toFixed(0)}%`:''}${pend.break?` · 冲关符 +${(pend.break*100).toFixed(0)}%`:''}</span>`})()}</div>
<div class="immortal-mini">${RUNE_MATERIALS.map(m=>{const have=runeMatCount(state,m.id);const per=runePerSec(state)[m.id]||0;return `<div class="immortal-mini-row"><div><b>${m.name}</b><span class="map-tier">T${m.tier}</span><small>${have.toFixed(2)} 份 · 产地 ${mapNode(m.node)?.name||'—'}${per>0?` · ${(per*3600).toFixed(2)} 份/时`:' · <span class="map-warn">未产出（该地未占领或镇守不足）</span>'}</small></div><span class="herb-count">${Math.floor(have)}</span></div>`}).join('')}</div>
<div class="immortal-mini">${RUNE_ITEMS.map(it=>{const plan=runePlan(state,it.id);const n=runeCount(state,it.id);const left=runeExpiresIn(state,it.id);const mat=Object.entries(it.materials).map(([k,v])=>`${RUNE_MATERIAL_MAP[k].name}×${v}`).join(' ');return `<div class="immortal-mini-row${plan.ok?'':' is-locked'}"><div><b>${it.name}</b><span class="map-tier">${it.text}</span>${n>0?`<span class="map-tier">存 ${n} · ${(left/3600).toFixed(1)}h</span>`:''}<small>${mat} · 成功率 ${(runeRate(state,it.id)*100).toFixed(0)}% · 需 ${RUNE_BENCH_LEVELS[it.bench-1].name}</small>${plan.ok?'':`<small class="map-warn">${plan.reason}</small>`}</div><span class="map-garrison">${n>0?`<button class="btn" data-immortal-action="rune-use" data-rune="${it.id}">${it.kind==='train'?'启用':'挂上'}</button>`:''}<button class="btn" data-immortal-action="rune" data-rune="${it.id}" ${plan.ok?'':'disabled'}>画符</button></span></div>`}).join('')}</div>
<div class="immortal-actions">${(()=>{const up=benchUpgradePlan(state);return up.ok?`<button class="btn" data-immortal-action="rune-bench">升台 → ${up.next.name} · ${up.stones} 灵石 + ${(up.silver/10000).toFixed(0)}万银两</button>`:`<span class="setting-tip">${up.reason}</span>`})()}</div></div>
${blk('dao','☯ 道心 · 你在世上被当成什么人')}<p>道心不是善恶评分，而是<b>你在这个地界上被当成什么人</b>。它随时间<b>回归中道</b>（离 50 越远回得越快）—— 想守住正道必须主动行善，而堕落只需要换一本功法。主修血煞一脉会让它<b>持续下坠</b>。</p>
<div class="immortal-statline">${(()=>{const t=moralityTierOf(state);const v=moralityOf(state);return `<span>道心 ${v.toFixed(1)} / ${MORALITY_MAX} · <b>${t.name}</b></span><span>洞天生还 ${t.caveBonus>=0?'+':''}${(t.caveBonus*100).toFixed(0)}pp</span><span>攻伐胜算 ${t.warBonus>=0?'+':''}${(t.warBonus*100).toFixed(0)}pp</span><span>领地赋税 ×${t.taxMult.toFixed(2)}</span>`})()}</div>
<p class="setting-tip">${moralityTierOf(state).desc}</p>
<div class="immortal-actions">${(()=>{const p=goodDeedPlan(state);return p.ok?`<button class="btn" data-immortal-action="good-deed">施粥赈济 · ${fmt(p.silver)} 两银 → 道心 +${GOOD_DEED_GAIN}</button>`:`<span class="setting-tip">施粥赈济：${p.reason}</span>`})()}</div></div>
${blk('human-pill','🩸 人丹 · 以血养功', immortalBlockVisible(state,'humanPill'))}<p>血煞一门的看家手段。把凡人炼成一枚丹，服下者修为暴涨——<b>原料是人</b>，所以这是全篇最重的代价。凡人人口是银两的来源，道心是洞天里的保命符。</p>
<div class="immortal-statline"><span>人丹存量 <b>${humanPillCount(state)}</b> 枚</span><span>主修流派 ${mainSchoolOf(state).name}</span></div>
<div class="immortal-actions">${(()=>{const p=humanPillPlan(state);return p.ok?`<button class="btn" data-immortal-action="human-pill" title="献祭 ${p.mortals} 名凡人，道心 ${p.moralityCost}">炼人丹 · 献祭 ${p.mortals} 凡人 + ${p.stones} 灵石</button>`:`<span class="setting-tip">${p.reason}</span>`})()}</div>
${humanPillCount(state)>0?`<div class="immortal-mini">${(c.cultivators||[]).map(p=>{const up=humanPillUsePlan(state,p.id);return `<div class="immortal-mini-row${up.ok?'':' is-locked'}"><div><b>${p.name}</b><span class="map-tier">${realmName(p.realmIndex)}</span><small>${up.ok?`服下可得修为 +${up.gain}`:`<span class="map-warn">${up.reason}</span>`}</small></div>${up.ok?`<button class="btn" data-immortal-action="use-human-pill" data-person="${p.id}">服丹</button>`:''}</div>`}).join('')}</div>`:''}
</div>
${blk('manual','📜 家族功法')}<p>宗门修的是宗门的法，<b>家族功法只对闭关修士生效</b>——宗门弟子享受不到。当前主修 ${mainManual?`《${mainManual.name}》`:'无'}${assistManual?` · 辅修《${assistManual.name}》`:''}，闭关修炼倍率 <b>${manualTrainingMultiplier(state).toFixed(2)}×</b>，已收录 ${c.manuals.length} / ${CULTIVATION_MANUALS.length} 门。</p>
<div class="immortal-actions"><span class="setting-tip">装备、参悟与全部功法目录见上方「功法阁」面板</span></div></div>`;
}
/* ────────────── 百科 ────────────── */

/**
 * 渲染百科页。
 *
 * 脏检查只看「可见条目的数量 + 搜索。+ 选中章节」：
 * 条目正文与数据引文是纯函数派生的，条数没变就不必重画。
 * 但可见条数相同的解锁（比如换了一条）会漏掉，所以把 seen ：id 串也带上。
 */
let lastCodexSignature = '';
function renderCodex(force = false) {
  const host = document.getElementById('codex-list');
  if (!host) return;
  const book = codexBook(state);
  const stats = codexStats(state);
  const query = state.ui.codexQuery || '';
  const chapter = state.ui.codexChapter || 'all';
  const showLocked = Boolean(state.ui.codexShowLocked);
  const ids = book.map((c) => `${c.id}${c.seenCount}`).join(',');
  const sig = `${ids}|${query}|${chapter}|${showLocked}`;
  if (!force && sig === lastCodexSignature) return;
  lastCodexSignature = sig;

  const chip = document.getElementById('codex-chip');
  if (chip) chip.textContent = `${stats.seen} / ${stats.total} 条`;

  const chaptersHost = document.getElementById('codex-chapters');
  if (chaptersHost) {
    const all = [{ id: 'all', name: '全部', icon: '☰', seenCount: stats.seen, total: stats.total }, ...book];
    chaptersHost.innerHTML = all.map((c) =>
      `<button class="codex-chip${c.id === chapter ? ' is-active' : ''}" data-codex-chapter="${c.id}">`
      + `${c.icon} ${c.name}<em>${c.seenCount}/${c.total}</em></button>`).join('')
      + `<button class="codex-chip${showLocked ? ' is-active' : ''}" data-codex-locked="1">`
      + `${showLocked ? '隐藏未解锁' : `显示未解锁（${stats.total - stats.seen}）`}</button>`;
  }

  const results = codexSearch(state, query, chapter);
  const locked = (query || !showLocked) ? [] : renderCodexLocked(
    chapter === 'all' ? book : book.filter((c) => c.id === chapter));
  if (!results.length && !locked.length) {
    host.innerHTML = `<div class="codex-empty">${query ? '查无此条。' : '此处尚无可看之物，且去闯一闯。'}</div>`;
    return;
  }
  const body = results.map((e) => {
    const dataLines = (e.lines || []).map((l) => `<span>${l}</span>`).join('');
    return `<article class="codex-entry" data-codex-id="${e.id}">
      <div class="codex-entry-head">
        <h3>${e.title}</h3>
        <span class="codex-entry-chapter">${e.chapterIcon} ${e.chapterName}</span>
      </div>
      <p>${e.prose}</p>
      ${dataLines ? `<div class="codex-data">${dataLines}</div>` : ''}
    </article>`;
  }).join('');
  host.innerHTML = body + locked.join('');
}

/** 未解锁的条目也占一个位，让玩家知道还有东西没见到 —— 默认不显示，可用按钮展开。 */
function renderCodexLocked(book) {
  const out = [];
  for (const ch of book) {
    for (const e of ch.entries) {
      if (e.seen) continue;
      out.push(`<article class="codex-entry is-locked">
        <div class="codex-entry-head"><h3>？？？</h3>
        <span class="codex-entry-chapter">${ch.icon} ${ch.name}</span></div>
        <div class="codex-hint">${e.hint || '尚未得见'}</div>
      </article>`);
    }
  }
  return out;
}

/* 百科的交互：切章节、搜索、显示未解锁。与其它只读面板一致，不触发答题。 */
document.addEventListener('click', ev => {
  const ch = ev.target.closest('[data-codex-chapter]');
  if (ch) { state.ui.codexChapter = ch.dataset.codexChapter; renderCodex(true); return; }
  if (ev.target.closest('[data-codex-locked]')) {
    state.ui.codexShowLocked = !state.ui.codexShowLocked;
    renderCodex(true);
  }
});
document.addEventListener('input', ev => {
  if (ev.target?.id !== 'codex-search') return;
  state.ui.codexQuery = ev.target.value;
  renderCodex(true);
});

/* ────────────── 轮回 ────────────── */

/** 渲染轮回页。顺带把金手指的选项状态画出来。*/
let lastCycleSignature = '';
function renderCycle(force = false) {
  const host = document.getElementById('cycle-body');
  if (!host) return;
  const m = metaOf(state);
  const prog = reincarnationProgress(state);
  const sig = `${m.cycle}|${m.points}|${m.unlocked.join(',')}|${m.active.join(',')}|${prog.canEnd}|${prog.top}|${prog.reward.total}`;
  if (!force && sig === lastCycleSignature) return;
  lastCycleSignature = sig;

  const chip = document.getElementById('cycle-chip');
  if (chip) chip.textContent = `第 ${m.cycle} 世 · ${m.points} 点轮回`;

  const r = prog.reward;
  const rewardLines = [
    `基础 ${r.base} 点`,
    `占领领地 ${r.held} 处 → +${r.fromHold} 点`,
    `收录功法 ${r.manuals} 本 → +${r.fromManuals} 点`,
    `最高境界 ${r.top ? realmName(r.top) : '凡人'} → +${r.fromRealm} 点`,
  ];
  const activeFx = [
    `修炼 ×${metaTrainMult(state).toFixed(2)}`,
    `材料 ×${metaMaterialMult(state).toFixed(2)}`,
    `灵石 ×${metaStoneMult(state).toFixed(2)}`,
    `冲关 +${(metaBreakBonus(state) * 100).toFixed(0)}%`,
    `生还 +${(metaSurvivalBonus(state) * 100).toFixed(0)}%`,
  ].join(' · ');

  const cards = GOLDEN_FINGERS.map((f) => {
    const owned = m.unlocked.includes(f.id);
    const on = m.active.includes(f.id);
    const affordable = m.points >= f.cost;
    const btn = owned
      ? `<button class="btn${on ? ' is-ready' : ''}" data-cycle-toggle="${f.id}">${on ? '已携带' : '携带'}</button>`
      : `<button class="btn" data-cycle-unlock="${f.id}" ${affordable ? '' : 'disabled'}>解锁 · ${f.cost} 点</button>`;
    return `<article class="codex-entry${owned ? '' : ' is-locked'}">
      <div class="codex-entry-head">
        <h3>${f.name}</h3>
        <span class="codex-entry-chapter">${f.subtitle}</span>
        <span class="codex-entry-chapter">${owned ? (on ? '本世携带' : '已解锁') : `未解锁 · ${f.cost} 点`}</span>
      </div>
      <p>${f.lore}</p>
      <div class="codex-data"><span>${f.rule}</span><span class="cycle-price">${f.price}</span></div>
      <div class="cultivator-break">${btn}</div>
    </article>`;
  }).join('');

  host.innerHTML = `
    <article class="codex-entry">
      <div class="codex-entry-head"><h3>本周目结算</h3>
        <span class="codex-entry-chapter">第 ${m.cycle} 世</span></div>
      <p>${prog.canEnd
        ? `族中已有人修至 <b>${realmName(prog.top)}</b>，可以重入轮回。这一世可得 <b>${r.total}</b> 点轮回。`
        : `尚不能轮回：${prog.reason}。`}</p>
      <div class="codex-data">${rewardLines.map((l) => `<span>${l}</span>`).join('')}</div>
      <div class="cultivator-break">
        <button class="btn break ${prog.canEnd ? 'is-ready' : ''}" data-cycle-commit="1" ${prog.canEnd ? '' : 'disabled'}>重入轮回 · 得 ${r.total} 点</button>
        <span class="break-cost">已携带：${m.active.length ? m.active.map((id) => GOLDEN_FINGER_MAP[id].name).join('、') : '无'}（最多 ${GOLDEN_FINGER_SLOTS} 件）</span>
      </div>
      <div class="codex-data"><span>当前生效：${activeFx}</span></div>
    </article>
    <article class="codex-entry">
      <div class="codex-entry-head"><h3>金手指</h3>
        <span class="codex-entry-chapter">改变规则，而非数值</span></div>
      <p>每一件都会改掉一条第一周目里不存在的规则，也都带着一个代价。最多同时携带 ${GOLDEN_FINGER_SLOTS} 件。</p>
    </article>
    ${cards}
    <article class="codex-entry">
      <div class="codex-entry-head"><h3>历世</h3><span class="codex-entry-chapter">最近的 ${m.history.length} 世</span></div>
      ${m.history.length
        ? `<div class="codex-data">${m.history.slice().reverse().map((h) =>
            `<span>第 ${h.cycle} 世 · 修至 ${realmName(h.top)} · 得 ${h.points} 点</span>`).join('')}</div>`
        : '<p>尚未轮回过。</p>'}
    </article>`;
}

/* 轮回的交互：解锁、携带、重入轮回。与其它只读面板一致，不触发答题。 */
document.addEventListener('click', ev => {
  if (ui.quiz.isBusy()) return;
  const un = ev.target.closest('[data-cycle-unlock]');
  if (un && !un.disabled) {
    const r = unlockFinger(state, un.dataset.cycleUnlock);
    ui.toast(r.reason, r.ok ? 'ok' : 'warn', 3000);
    if (r.ok) { writeSave(state); renderCycle(true); }
    return;
  }
  const tg = ev.target.closest('[data-cycle-toggle]');
  if (tg && !tg.disabled) {
    const m = metaOf(state);
    const id = tg.dataset.cycleToggle;
    const next = m.active.includes(id) ? m.active.filter((x) => x !== id) : [...m.active, id];
    const r = setActiveFingers(state, next);
    ui.toast(r.reason, r.ok ? 'ok' : 'warn', 2600);
    if (r.ok) { writeSave(state); renderCycle(true); }
    return;
  }
  const cm = ev.target.closest('[data-cycle-commit]');
  if (cm && !cm.disabled) {
    const prog = reincarnationProgress(state);
    if (!prog.canEnd) { ui.toast(prog.reason, 'warn', 2600); return; }
    if (!window.confirm(`确认重入轮回？家业、修士、境界、领地、丹房器坊符房全部归零，`
      + `只保留轮回点与金手指（答题记录也会保留）。本世可得 ${prog.reward.total} 点轮回。`)) return;
    const r = commitReincarnation(state, metaOf(state).active);
    if (!r.ok) { ui.toast(r.reason, 'warn', 2800); return; }
    writeSave(state);
    ui.syncPage(); ui.render(); repaintExpansion(true); renderCycle(true);
    ui.toast(r.reason, 'ok', 4200);
  }
});

/* ────────────── 功法─────────────── */
const MANUAL_EFFECT_LABEL = {
  training: (v) => `闭关修为 +${Math.round(v*100)}%`,
  power:    (v) => `修士战力 +${Math.round(v*100)}%`,
  labor:    (v) => `劳作银两 +${Math.round(v*100)}%`,
  explore:  (v) => `秘闻发现 +${Math.round(v*100)}%`,
  survive:  (v) => `洞天生还 +${Math.round(v*100)} 个百分点`,
  stones:   (v) => `洞天灵石 +${Math.round(v*100)}%`,
};
const MANUAL_SOURCE_HINT = {
  1: '青苔小洞天 · 青木寨',
  2: '流霞洞天 · 玄阴秘境 · 黑水门',
  3: '太虚古境 · 玄铁宗',
};
function manualEffectText(effect) {
  const parts = [];
  for (const [k, v] of Object.entries(effect || {})) {
    if (!v) continue;
    parts.push((MANUAL_EFFECT_LABEL[k] || ((x) => `${k} +${Math.round(x*100)}%`))(v));
  }
  return parts.join(' · ') || '无加成';
}

/**
 * 功法阁阁
 * 三块：装备栏（主修辅修）→ 当前汇汇*15 本收录网格本
 * 没收录的也画出来（暗。+ 出处提示），收藏感靠它撑。
 */
function renderManualPavilion() {
  const grid = document.getElementById('manual-grid');
  if (!grid) return;
  repairCultivation(state);
  const c = state.cultivation;
  const owned = c.manuals || [];
  const mb = manualBonus(state);

  const chip = document.getElementById('manual-chip');
  if (chip) {
    chip.textContent = owned.length ? `${owned.length} / ${CULTIVATION_MANUALS.length} 门` : '尚无功法';
    chip.className = `chip${owned.length ? ' chip-open' : ' chip-locked'}`;
  }
  const empty = document.getElementById('original-manual-info');
  const slotsHost = document.getElementById('manual-slots');
  const sumHost = document.getElementById('manual-summary');
  if (empty) empty.hidden = owned.length > 0;
  if (slotsHost) slotsHost.hidden = owned.length === 0;
  if (sumHost) sumHost.hidden = owned.length === 0;
  if (!owned.length) { grid.innerHTML = ''; return; }

  // ── 装备───
  const slotHtml = (role, id, ratio, hint) => {
    const m = id ? CULTIVATION_MANUAL_MAP[id] : null;
    if (!m) {
      return `<div class="manual-slot is-empty"><div class="manual-slot-head"><span class="manual-slot-role">${role}</span></div><div class="manual-slot-body">${hint}</div></div>`;
    }
    const eff = manualEffectAt(state, m.id, ratio);
    return `<div class="manual-slot"><div class="manual-slot-head"><span class="manual-slot-role">${role}</span>`
      + `<span class="manual-card-tier t${m.tier}">${MANUAL_TIER_NAME[m.tier]}</span></div>`
      + `<div class="manual-slot-name">『${m.name}』</div>`
      + `<div class="manual-slot-meta">${MANUAL_DAOS[m.dao].name} · 参悟 ${manualAttune(state, m.id)}/${MANUAL_ATTUNE_MAX}</div>`
      + `<div class="manual-slot-effect">${manualEffectText(eff)}</div></div>`;
  };
  slotsHost.innerHTML =
    slotHtml('主修 · 吃满', c.equippedManual, 1, '点下方已收录功法的「主修」按钮，效果全额生效')
    + slotHtml('辅修 · 45%', c.assistManual, MANUAL_ASSIST_RATIO, '须与主修不同道途。只吃 45% 的效果');

  // ── 当前汇）──
  const sumParts = MANUAL_EFFECT_KEYS.filter((k) => mb[k] > 0)
    .map((k) => `<span class="manual-summary-chip">${(MANUAL_EFFECT_LABEL[k] || (() => k))(mb[k])}</span>`);
  sumHost.innerHTML = sumParts.length
    ? `<span class="manual-summary-chip is-zero">当前生效</span>${sumParts.join('')}`
    : '<span class="manual-summary-chip is-zero">当前没有任何加成</span>';

  // ── 收录网格 ──
  const canAttune = state.spiritStones >= MANUAL_ATTUNE_STONE_COST && c.clues >= MANUAL_ATTUNE_CLUE_COST;
  const rows = [];
  for (const dao of MANUAL_DAO_ORDER) {
    for (const m of CULTIVATION_MANUALS.filter((x) => x.dao === dao)) {
      const have = owned.includes(m.id);
      const att = manualAttune(state, m.id);
      const isMain = c.equippedManual === m.id;
      const isAssist = c.assistManual === m.id;
      const sc = schoolOf(m);
      const cls = ['manual-card', have ? '' : 'is-locked', isMain ? 'is-main' : '', isAssist ? 'is-assist' : '']
        .filter(Boolean).join(' ');
      const daoEl = MANUAL_DAO_ELEMENT[dao];
      const elTag = daoEl
        ? `<i class="el-${daoEl}">${elementName(daoEl)}</i>`
        : '<i class="el-none">无属性</i>';
      const head = `<div class="manual-card-head"><span class="manual-card-name">${have ? `《${m.name}》` : m.name}</span>`
        + `<span class="manual-card-tier t${m.tier}">${MANUAL_TIER_NAME[m.tier]}</span>`
        // 流派徽记：玄门不标（它是基准），其余标出来 —— 这一本就是这一世的路线
        + (sc.id === 'orthodox' ? '' : `<span class="manual-card-school s-${sc.tone}">${sc.name}</span>`)
        + `</div>`
        + `<div class="manual-card-dao">${MANUAL_DAOS[dao].name} ${elTag} · ${MANUAL_DAOS[dao].desc}</div>`
        + `<div class="manual-card-effect">${manualEffectText(m.effect)}</div>`;

      if (!have) {
        rows.push(`<div class="${cls}">${head}<div class="manual-card-locked">未收录 · ${MANUAL_SOURCE_HINT[m.tier]} 可得</div></div>`);
        continue;
      }

      const placed = isMain || isAssist;
      const conflict = !placed && manualDaoTaken(state, dao, m.id);
      const blockReason = placed ? `已列入${isMain ? '主修' : '辅修'}` : conflict ? `${MANUAL_DAOS[dao].name}一途已占另一个位置` : '';
      const pips = '●'.repeat(att) + '○'.repeat(MANUAL_ATTUNE_MAX - att);
      rows.push(`<div class="${cls}">${head}
        <div class="manual-card-foot">
          <span class="manual-card-attune">参悟 ${pips}</span>
          <button class="btn${isMain ? ' is-on' : ''}" data-manual-action="main" data-manual="${m.id}" ${placed || conflict ? 'disabled' : ''} title="${blockReason || '效果吃满 100%'}">主修</button>
          <button class="btn${isAssist ? ' is-on' : ''}" data-manual-action="assist" data-manual="${m.id}" ${placed || conflict ? 'disabled' : ''} title="${blockReason || '只吃 45%，须与主修不同道途'}">辅修</button>
          <button class="btn" data-manual-action="attune" data-manual="${m.id}" ${att >= MANUAL_ATTUNE_MAX || !canAttune ? 'disabled' : ''} title="需 ${MANUAL_ATTUNE_STONE_COST} 灵石 + ${MANUAL_ATTUNE_CLUE_COST} 条秘闻线索；重复获得同一本也会自动参悟">参悟</button>
        </div></div>`);
    }
  }
  grid.innerHTML = rows.join('');
}

let lastImmortalUiSignature='';
function repaintExpansion(force=false){const c=state.cultivation;if(!c)return;const w=worldOf(state);const al=alchemyOf(state);const fg=forgeOf(state);const ru=runesOf(state);const sig=JSON.stringify([state.secrets.length,Math.floor(state.spiritStones*100),Math.floor(state.silver/1000),c.pool,c.poolBlueprint,c.compass,c.mineLevel,c.mineWorkers,c.veins.map(v=>[v.grade,Math.floor(v.reserve*10)]),c.clues,c.caveRuns,c.manuals,c.equippedManual,c.assistManual,c.attune,w.reached,w.held,w.garrison,Object.entries(w.unrest).map(([k,v])=>[k,Math.floor(v*50)]),c.pills,al.furnace,al.crafts,Object.entries(al.herbs).map(([k,v])=>[k,Math.floor(v*10)]),al.pills,al.prof,fg.level,fg.crafts,fg.owned,fg.equipped,Object.entries(fg.ores).map(([k,v])=>[k,Math.floor(v*1000)]),ru.bench,ru.crafts,ru.pending,Object.entries(ru.mats).map(([k,v])=>[k,Math.floor(v*100)]),Object.entries(ru.stock).map(([k,v])=>[k,v.n,Math.floor(v.expiresAt/60000)]),Math.floor((ru.trainUntil||0)/60000),
 // 【策划 C2/C1/C14/T-0 / docs/91 §六.10】脏检查必须同步加新字段，否则新仪表不刷新（静默失败）：
 //   push / stalled（猛进与气机滞住）、errand 人数（投帖）、realmEnteredYear 与 clock.year（寿元钟）、
 //   cluePool（线索小数池进位时界面上的条数会变）。
 c.cultivators.map(p=>[p.id,p.realmIndex,p.talent,p.job,p.breakFailures||0,p.root?.grade,p.push?1:0,Math.floor((Number(p.stalled)||0)/30),p.foundation?`${p.foundation.nodeId}${p.foundation.grade}`:'-',coreOf(p).marks,Object.keys(coreOf(p).used).join(''),p.realmEnteredYear||0]),Math.floor(Number(state.clock?.year)||0),Math.floor((Number(c.cluePool)||0)*10)]);if(force||sig!==lastImmortalUiSignature){lastImmortalUiSignature=sig;renderImmortalExpansion();renderManualPavilion();}}

/* 冲关按钮。与炼气篇其他操作一致，不触发答题参*/
document.addEventListener('click',ev=>{
 const btn=ev.target.closest('[data-breakthrough]');if(!btn||btn.disabled)return;
 if(ui.quiz.isBusy())return;
 // 【策划 C4 / 任务 T-5】择地筑基：把下拉框里选中的那块地传给 commitBreakthrough。
 // 读的是 DOM 的当前值而不是重算一遍 —— 否则玩家看到的那一项与实际落库的可能不是同一块。
 const siteSel=document.querySelector(`[data-site-for="${btn.dataset.breakthrough}"]`);
 const siteId=siteSel?siteSel.value:'';
 // 【修复 t4 缺陷②】金丹期「晋升」按钮：读 data-force 走**无风险直接晋升**分支。
 // 原实现渲染了 data-force 却没有任何读取侧 ⇒ 按钮点了什么都不发生；而修为停在 need、
 // 自动晋升又只吃「超出 need 的部分」，玩家会被**永久卡在金丹期**。
 // 这是「渲染侧给了属性、处理侧不读」的静默失效 —— 与投帖那个缺陷正好相反方向，同一类病。
 const force=btn.dataset.force==='1';
 const result=commitBreakthrough(state,Number(btn.dataset.breakthrough),Date.now(),rng,siteId||undefined,force);
 ui.toast(result.ok
   ? (result.promoted?`${result.name}选择晋升${result.realm}（本层未结丹）`
      : result.success?`${result.name}冲关成功，晋${result.realm}！`
                     :`${result.name}冲关失败，修为倒退 ${result.loss} 点；下一次成功率 ${(result.nextRate*100).toFixed(0)}%`)
   : result.reason,
   result.ok&&!result.promoted&&!result.success?'warn':'ok', 3600);
 if(result.ok){writeSave(state);ui.render();}
 repaintExpansion(true);
});

/* 【策划 C2 / 任务 T-3】猛进行气的开关。per-person，不触发答题。 */
document.addEventListener('click',ev=>{
 const btn=ev.target.closest('[data-push]');if(!btn||btn.disabled)return;
 if(ui.quiz.isBusy())return;
 const r=immortalAction(state,'push',btn.dataset.push,rng);
 ui.toast(r.reason,r.ok?'ok':'warn',2600);
 if(r.ok){writeSave(state);ui.render();}
 repaintExpansion(true);
});

/* 【策划 C1 / 任务 T-4】投帖与召回。勾选框把 id 收集起来，一次提交一批。 */
document.addEventListener('click',ev=>{
 // 【修复 t4 缺陷①】选择器拆成两次 `closest`，**不用逗号选择器**。
 // 原因：逗号选择器在无头垫片里永远匹配不到（`scripts/dom-shim.mjs` 的
 // matchesCompound 只认单一复合选择器），于是这个处理器在 smoke 里
 // **永远不会被触发**，任何「点一下按钮」的断言都会静默落空 ——
 // 缺陷① 正是在这种「测试看起来覆盖了、其实一次都没跑」的情况下活下来的（docs/92 §五·缺陷⑦）。
 // 拆开后这个处理器在垫片里也能真跑，入口断言才有意义。
 const errandBtn=ev.target.closest('[data-errand]');
 const recallBtn=errandBtn?null:ev.target.closest('[data-recall]');
 const btn=errandBtn||recallBtn;if(!btn||btn.disabled)return;
 if(ui.quiz.isBusy())return;
 const ids=[...document.querySelectorAll('[data-errand-check]')]
   .filter(n=>n.checked)
   .map(n=>Number(n.dataset.errandCheck))
   .filter(n=>Number.isFinite(n)&&n>0);
 if(!ids.length){ui.toast('请先勾选族人，再点投帖 / 召回','warn',2600);return;}
 if(errandBtn){
   // 确认文案必须写明「在外的人有 X%/时 回不来」——风险要能算，不能只说「有风险」
   const perHour=(ERRAND_DEATH_PER_SEC*3600*100).toFixed(2);
   // ⚠ 用 window.confirm：无头垫片把 confirm 挂在 window 上（没挂到 globalThis），
   //   写裸 window.confirm() 会在 Node 里抛 ReferenceError，被垫片安静吞掉 —— 又是一次假覆盖。
   const ask=typeof window!=='undefined'&&typeof window.confirm==='function'?window.confirm:(()=>true);
   if(!ask(`派这 ${ids.length} 人出门投帖？他们在外的期间不涨修为、不能镇守或探险，每人每小时约有 ${perHour}% 回不来（可随时召回）。`))return;
 }
 const r=immortalAction(state,errandBtn?'errand':'recall',ids.join(','),rng);
 ui.toast(r.reason,r.ok?'ok':'warn',3600);
 if(r.ok){
   // 【修复 t9 缺陷③的配套】派帖/召回成功后**必须清空勾选**：
   //   勾选集合是「本轮要派谁」的选择，动作完成就不该留着 ——
   //   否则「已在外」的人会被继续算进「已勾选 N 人」，按钮文案继续虚高。
   //   （勾选框是活 DOM、不随状态自动清，所以在这里显式清。）
   for(const n of document.querySelectorAll('[data-errand-check]')) n.checked=false;
   writeSave(state);ui.render();
 }
 repaintExpansion(true);
});

/* 【策划 C6 / 任务 T-6】结丹：三档火候都必须把成率与失败后果写在确认框里。 */
document.addEventListener('click',ev=>{
 const btn=ev.target.closest('[data-fold]');if(!btn||btn.disabled)return;
 if(ui.quiz.isBusy())return;
 const foldId=btn.dataset.fold,pid=Number(btn.dataset.person);
 const plan=foldPlan(state,pid,foldId);
 if(!plan.ok){ui.toast(plan.reason,'warn',2800);return;}
 // ⚠ 用 window.confirm：无头垫片把 confirm 挂在 window 上（没挂 globalThis），
 //   裸 window.confirm() 在 Node 里会抛 ReferenceError 并被垫片安静吞掉 —— 那是假覆盖。
 const ask=typeof window!=='undefined'&&typeof window.confirm==='function'?window.confirm:(()=>true);
 if(!ask(`以${plan.foldName}结丹？成算 ${(plan.rate*100).toFixed(0)}%，成则 +${plan.marks} 纹（${plan.cap===null?'无上限':`止于 ${plan.cap} 纹`}）；失败时：${plan.failText}。本层这一次机会用完就没有了。`))return;
 const r=commitFold(state,pid,foldId,Date.now(),rng);
 ui.toast(r.ok
   ? (r.success?`${r.name}结丹成功，得 ${r.gain} 纹（共 ${r.marks} 纹 · ${r.grade}）`
              : (r.warded?`${r.name}结丹失败 —— 护纹挡下，${r.marks} 纹未损`
                         :`${r.name}结丹失败，丹裂掉纹（余 ${r.marks} 纹 · ${r.grade}）`))
   : r.reason,
   r.ok&&r.success?'ok':'warn',4200);
 if(r.ok){writeSave(state);ui.render();}
 repaintExpansion(true);
});

/* 【策划 C4 / 任务 T-5】散功重修：不可逆决策的后悔药，代价要写全。 */
document.addEventListener('click',ev=>{
 const btn=ev.target.closest('[data-dissolve]');if(!btn||btn.disabled)return;
 if(ui.quiz.isBusy())return;
 const plan=dissolveFoundationPlan(state,Number(btn.dataset.dissolve));
 if(!plan.ok){ui.toast(plan.reason,'warn',2800);return;}
 if(!window.confirm(`${plan.name}散去${plan.nodeName}的地气，境界回退到炼气九层、修为清零、`
   +`${plan.hours} 游戏小时不能修炼、家族道心 ${plan.morality}。功法与家业都保留。确认？`))return;
 const r=commitDissolveFoundation(state,Number(btn.dataset.dissolve),Date.now());
 ui.toast(r.ok?`${r.name}散功重修，择地之权仍在手`:'散功失败',r.ok?'warn':'warn',3600);
 if(r.ok){writeSave(state);ui.render();}
 repaintExpansion(true);
});

/* 测灵根。同样不触发答题，但保证「不亏」——测得更差会保留原有的升*/
document.addEventListener('click',ev=>{
 const btn=ev.target.closest('[data-root-reroll]');if(!btn||btn.disabled)return;
 if(ui.quiz.isBusy())return;
 const result=commitRootReroll(state,Number(btn.dataset.rootReroll),rng);
 ui.toast(result.ok
   ? (result.improved?`${result.name}再测灵根；{result.before} 仍${result.after}`
                     :`${result.name}再测灵根，仍（{result.before}（花花${result.cost} 灵石）`)
   : result.reason,
   result.ok&&result.improved?'ok':'warn', 3200);
 if(result.ok){writeSave(state);ui.render();}
 repaintExpansion(true);
});

/* 功法阁的按钮：主主/ 辅修 / 参悟。与炼气篇其他操作一致，不触发答题。*/
document.addEventListener('click',ev=>{
 const btn=ev.target.closest('[data-manual-action]');if(!btn||btn.disabled)return;
 if(ui.quiz.isBusy())return;
 const kind=btn.dataset.manualAction,id=btn.dataset.manual;
 const map={main:'equip',assist:'assist',attune:'attune'};
 const result=immortalAction(state,map[kind]||'',id,rng);
 ui.toast(result.reason,result.ok?'ok':'warn',2800);
 if(result.ok){writeSave(state);ui.render();}
 repaintExpansion(true);
});
document.addEventListener('click',ev=>{
 const btn=ev.target.closest('[data-immortal-action]');if(!btn)return;
 if(ui.quiz.isBusy())return;
 let kind=btn.dataset.immortalAction,param='';
 if(kind==='sect')param=document.getElementById('sect-person')?.value;
 if(kind==='cave'){
  const id=document.getElementById('cave-person')?.value;
  const nodeId=btn.dataset.mapNode;
  const p=findCultivator(state,id),c=mapNode(nodeId);
  if(!p||!c)return;
  if(!mapAccessible(state,nodeId)){ui.toast('与此地不相邻，需先打通沿途','warn',2600);return;}
  const survival=caveSurvival(state,p,c);
  if(!window.confirm(`${p.name}将挑战${c.name}，预估生还率${(survival*100).toFixed(1)}%，失败永久失去修士！确认消耗 ${c.fee} 灵石、${c.clues} 线索吗？`))return;
  param=`${id}:${nodeId}`;
 }
 if(kind==='attack'){
  param=btn.dataset.mapNode;
  const f=mapNode(param);
  if(!f)return;
  if(!mapAccessible(state,param)){ui.toast('与此地不相邻，需先打通沿途','warn',2600);return;}
  const plan=mapPlan(state,param);
  if(!plan.ok){ui.toast(plan.reason,'warn',2600);return;}
  if(!window.confirm(`确认攻伐${f.name}？胜算 ${(plan.rate*100).toFixed(1)}%，战败可能折损修士。`))return;
 }
 if(kind==='garrison'){
  const nodeId=btn.dataset.mapNode;
  const sel=document.querySelector(`[data-garrison-for="${nodeId}"]`);
  const pid=sel&&sel.value?sel.value:'';
  param=pid?`${nodeId}:${pid}`:nodeId;
 }
 if(kind==='rune'){
  param=btn.dataset.rune;
  const plan=runePlan(state,param);
  if(!plan.ok){ui.toast(plan.reason,'warn',2600);return;}
  if(!window.confirm(`画${plan.name}？成功率 ${(plan.rate*100).toFixed(0)}%，失败会损失全部符文；成品 ${RUNE_SHELF_HOURS} 小时内不用即作废。`))return;
 }
 if(kind==='rune-bench'){
  const plan=benchUpgradePlan(state);
  if(!plan.ok){ui.toast(plan.reason,'warn',2600);return;}
  if(!window.confirm(`升级符台到${plan.next.name}？消耗 ${plan.stones} 灵石 + ${plan.next.silver} 两银。`))return;
 }
 if(kind==='rune-use')param=btn.dataset.rune;
 if(kind==='forge'){
  param=btn.dataset.artifact;
  const plan=forgePlan(state,param);
  if(!plan.ok){ui.toast(plan.reason,'warn',2600);return;}
  if(!window.confirm(`开炉铸${plan.name}（${plan.slot}）？成功率 ${(plan.rate*100).toFixed(0)}%，失败会损失全部矿料。`))return;
 }
 if(kind==='forge-level'){
  const plan=forgeUpgradePlan(state);
  if(!plan.ok){ui.toast(plan.reason,'warn',2600);return;}
  if(!window.confirm(`升级锻造台到${plan.next.name}？消耗 ${plan.stones} 灵石 + ${plan.next.silver} 两银。`))return;
 }
 if(kind==='artifact-equip'||kind==='artifact-repair')param=btn.dataset.artifact;
 if(kind==='craft'){
  param=btn.dataset.recipe;
  const plan=recipePlan(state,param);
  if(!plan.ok){ui.toast(plan.reason,'warn',2600);return;}
  if(!window.confirm(`开炉炼${plan.name}？成功率 ${(plan.rate*100).toFixed(0)}%，失败会损失全部材料。`))return;
 }
 if(kind==='furnace'){
  const plan=furnaceUpgradePlan(state);
  if(!plan.ok){ui.toast(plan.reason,'warn',2600);return;}
  if(!window.confirm(`升炉到${plan.next.name}？消耗 ${plan.stones} 灵石 + ${plan.next.silver} 两银。`))return;
 }
 if(kind==='use-human-pill')param=btn.dataset.person;
 if(kind==='mine-workers')param=document.getElementById('mine-workers')?.value;
 if(kind==='equip')param=btn.dataset.manual;
 const result=immortalAction(state,kind,param,rng);
 ui.toast(result.reason,result.ok?'ok':'warn',3600);
 if(result.ok){writeSave(state);ui.render();}
 repaintExpansion(true);
});
document.addEventListener('change',ev=>{if(ev.target?.id==='cave-person')repaintExpansion(true)});
// 百科与炼气篇无关，所以单独挂一个定时刷新（内部有脏检查，不变就不重画。）\nsetInterval(()=>renderCodex(),1300);
setInterval(()=>renderCycle(),1500);
setInterval(()=>repaintExpansion(),1100);
repaintExpansion(true);
renderCodex(true);
renderCycle(true);
window.__xiuxian.immortalAction=(kind,param,random=Math.random)=>{const v=immortalAction(state,kind,param,random);ui.render();repaintExpansion(true);return v;};
