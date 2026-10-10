
/* ────────────────────────────────────────────────────────────────
 * 区块：百科条目
 * 职责：把散落在各区块里的背景文字（建筑的 lore、地图节点的 lore、
 *       丹方/法器/符箓的 desc、境界的 desc）**聚合**成一本可查的志书，
 *       并为每条配一段**从活表里生成**的数据引文。
 * 依赖：无（纯数据 + 纯函数）。条目里的 prose 大量直接引用其它表，
 *       所以**改了那些表，百科会自动跟着变**，不会出现两处说法不一致。
 * 调参：新增条目只要往 CODEX_CHAPTERS 里加一条；
 *       新增体系时用 entriesFrom 之类的批量构造，别手抄。
 * 文档：docs/70-百科.md
 * ──────────────────────────────────────────────────────────────── */

/**
 * 条目结构：
 *   id     唯一键
 *   title  标题
 *   prose  志书正文（代入感）。能引用已有表的就引用，不要重写一遍
 *   lines  数据引文（可查）。**必须是函数**，这样取的是当前活表的数值
 *   seen   何时显现。返回 false 的条目在界面上显示为「？？？」
 *   hint   未显现时给玩家的提示
 *   tags   搜索用的额外关键词
 */

/* ── 批量构造的小工具 ── */

/**
 * 从一张表批量造条目。
 * 传入的每个函数都收到 (row, state)，所以不要在 spec 里用 this。
 */
function codexFromTable(table, spec) {
  return table.map((row) => ({
    id: `${spec.prefix}-${row.id}`,
    title: spec.title(row),
    prose: spec.prose(row),
    lines: (s) => spec.lines(row, s),
    seen: (s) => spec.seen(row, s),
    hint: spec.hint,
    tags: spec.tags ? spec.tags(row) : '',
  }));
}

/* ── 境界：目标里点名要「给人代入感」的部分，所以正文单独写 ── */

const CODEX_REALM_PROSE = {
  0: '未曾引气入体的，都叫凡人。凡人的一生是田垄、婚丧与赋税，寿数不过七十。'
    + '可世家之所以是世家，就在于总有人不甘心——于是有了祛障丹，有了灵池，有了第一代修士。',
  qi: '引天地灵气入体，冲刷经脉，是为炼气。此境尚无瓶颈，气满了自然往上走，'
    + '所以炼气期是修士一生里最痛快的一段：看得见自己一天比一天强。'
    + '九层之后便是关隘——冲得过去才叫筑基，冲不过去，一辈子就在九层上打转。',
  zhuji: '气足而凝，筑成道基。筑基之后寿元渐长，也第一次尝到「不走运」的滋味：'
    + '每一层都要自己冲关，冲不过去修为还要倒退。族里若有一位筑基修士，'
    + '方圆百里的散修便不敢轻慢——但供养他的凡人也要多起来。',
  jindan: '气凝成丹，可离体斗法。金丹修士已经不太需要亲手做事了，'
    + '可家族反而更累：一位金丹背后要养活的人口、要占住的灵脉，都是实打实的账。'
    + '走到这一步，修行就不再只是一个人的事。',
  yuanying: '元婴出窍，肉身可弃。此境的修士已经不太把凡人放在眼里了，'
    + '族中晚辈见他要先跪下行礼。这是修仙世家最风光的一段，也是最危险的一段——'
    + '再往上一步，要拿整个家族的运数去换。',
  huashen: '神游太虚，一念千里。传说走到这一步的人，回头再看凡尘，'
    + '就像看一窝忙忙碌碌的蚂蚁。族谱上添了这一个名字，'
    + '往后千百年，这一族在地方志里都算是有来处了。',
};

/* ── 机制：解释「为什么这样设计」，玩家看了才不会觉得系统在为难他 ── */

const CODEX_MECHANICS = [
  {
    id: 'mech-quiz', title: '为何凡事都要答题',
    prose: '家族子弟读书识字，凡事才有章法。营造、研习、通商之前都要先过一道功课——'
      + '答对了才作数。这不是为难人，是因为这个世家还在往上爬：'
      + '底子不牢的时候，任何一步走错都要用几十年去补。'
      + '（设置里可以调成「半数免答」或「免答」，代价是失去答题带来的那部分增益。）',
    lines: (s) => [
      `当前模式：${QUIZ_MODES[String(s.settings?.quizMode)]?.name || '逐事作答'}`,
      `累计答题 ${s.quiz.total} 道，正确率 ${s.quiz.total ? Math.round((s.quiz.right / s.quiz.total) * 100) : 0}%`,
    ],
    seen: () => true,
  },
  {
    id: 'mech-percent', title: '百分比是「百分点」',
    prose: '族中记账的习惯：凡是写着「+N%」的，都是在原有的基础上**再加 N 个百分点**，'
      + '而不是乘一个系数。所以加成是可以直接相加的——'
      + '一本加三成的功法、一件加四成的法器，合起来就是加七成。',
    lines: () => ['面板上的数字可以直接相加，不必换算'],
    seen: () => true,
  },
  {
    id: 'mech-realm', title: '小境界自动，大境界要自己冲',
    prose: '同一个大境界里的小层次，修为到了会自动往上晋；但**跨大境界必须自己点「冲关」**。'
      + '这不是偷懒，是刻意的：如果连跨境界都自动，玩家在整个周目里就不需要做任何境界决策，'
      + '只剩等。冲关有公开的成功率与失败代价，**失败也照样扣材料**，'
      + '所以「备足了再冲」是有意义的。',
    lines: (s) => {
      const idx = s.cultivation?.cultivators?.[0]?.realmIndex;
      const g = idx === undefined ? null : realmGate(idx);
      return [
        '四道大境界门槛：' + [9, 13, 17, 21]
          .map((i) => `${realmName(i)}→${realmName(i + 1)}`)
          .join('、'),
        g ? `当前瓶颈：${realmName(idx)}` : '当前无人卡在瓶颈上',
      ];
    },
    seen: (s) => (s.cultivation?.cultivators || []).length > 0,
    hint: '收得第一位修士后可见',
  },
  {
    id: 'mech-root', title: '灵根决定三件事',
    prose: '一个人有没有灵根、是什么灵根，决定他能走多远。'
      + '**越纯越好**：单系的天灵根修行速度是五灵根的近三倍，还能修到化神圆满；'
      + '五行俱全的「伪灵根」反而样样不精，往往止步元婴。'
      + '灵根还决定能修哪些系别的功法——家族可以装备任意功法，'
      + '但**只有灵根对得上的族人才真吃得到**，所以「族人灵根够杂」本身就是一种资产。',
    lines: (s) => {
      const ps = s.cultivation?.cultivators || [];
      const best = ps.length
        ? ps.reduce((a, b) => (rootRank(b) > rootRank(a) ? b : a))
        : null;
      return [
        ...ROOT_GRADES.map((g) => `${g.name}：速度 ×${g.speed.toFixed(2)} · 冲关 ${g.breakBonus >= 0 ? '+' : ''}${(g.breakBonus * 100).toFixed(0)}% · 上限 ${realmName(g.capIndex)}`),
        '后天抽中：' + ROOT_GRADES.map((g) => `${g.name} ${(g.weight * 100).toFixed(1)}%`).join(' · '),
        best ? `族中最好的灵根：${best.name} — ${rootText(best)}` : '族中尚无修士',
      ];
    },
    seen: (s) => (s.cultivation?.cultivators || []).length > 0,
    hint: '收得第一位修士后可见',
  },
  {
    id: 'mech-garrison', title: '打下来不等于守得住',
    prose: '攻下一处势力只是开始。**占领之后要派修士镇守，才有赋税与材料**；'
      + '镇守战力不够，那块地就一直往里赔——民怨会一点点涨，涨满了就叛离。'
      + '所以战力是双重资源：既决定打不打得过，也决定守不守得住。'
      + '（宗门弟子不受家族调遣，不能派去镇守。）',
    lines: (s) => {
      const w = worldOf(s);
      if (!w.held.length) return ['尚无占领的领地'];
      return w.held.map((id) => {
        const n = mapNode(id);
        return `${n.name}：镇守 ${Math.round(mapHoldStrength(s, id))} / 需 ${mapHoldPower(n)}`
          + ` · ${mapIsPacified(s, id) ? '安定' : `民怨 ${Math.round((w.unrest[id] || 0) * 100)}%`}`;
      });
    },
    seen: (s) => worldOf(s).held.length > 0 || worldOf(s).reached.length > 1,
    hint: '抵达青木寨或黑水门后可见',
  },
  {
    id: 'mech-shelf', title: '符箓为何会过期',
    prose: '符箓是朱砂画在纸上的东西，放久了灵气就散了，所以**画好之后三个时辰内不用就作废**。'
      + '这是刻意的：如果符能无限囤，一次画上一百张就能管一整个周目，'
      + '炼符也就不再是一条需要经营的线，而变成一道一次性工序。'
      + '而且**补货不会把旧的洗成新的**——先画的先过期。',
    lines: () => [
      `保质期：${RUNE_SHELF_HOURS} 小时（游戏内时间，离线也照算）`,
      '四张符分别接在：冲关成功率 / 洞天生还率 / 攻伐胜算 / 全族修炼',
    ],
    seen: (s) => (s.cultivation?.runes?.crafts || 0) > 0 || (s.cultivation?.runes?.mats && Object.keys(s.cultivation.runes.mats).length > 0),
    hint: '占领一处产符文的领地，或画出第一张符后可见',
  },
  {
    id: 'mech-durability', title: '法器为何会磨损',
    prose: '法器不是炼出来就一劳永逸的。攻伐与探险都会磕碰，**耐久越低效果越弱**，'
      + '耗尽则暂时失效，要花矿料重祭。法器的耐久掉得还有讲究：'
      + '护甲在攻伐里掉得快，法宝在洞天里掉得快——所以「带哪件出门」是有区别的。',
    lines: (s) => {
      const f = forgeOf(s);
      if (!f.owned.length) return ['尚未铸成任何法器'];
      return f.owned.map((id) => {
        const it = FORGE_ITEM_MAP[id];
        const eq = f.equipped[it.slot] === id;
        return `${it.name}（${FORGE_SLOT_MAP[it.slot].name}）：耐久 ${Math.round(durabilityOf(s, id))}%${eq ? ' · 已装备' : ''}`;
      });
    },
    seen: (s) => forgeOf(s).owned.length > 0,
    hint: '铸成第一件法器后可见',
  },
  {
    id: 'mech-five', title: '五行各有所司',
    prose: '五行不是摆设。灵根里带哪一种，就直接决定这一族在哪个方向上更省力：'
      + '木主生发，宜炼丹；金主锋锐，宜炼器；火主炎上，宜画符；'
      + '水主流通，宜寻幽探秘；土主厚载，宜经营田产。'
      + '抽到一个天灵根，等于这一族在某一条线上天然快人一步。',
    lines: () => [
      '木 → 炼丹成功率 · 金 → 炼器成功率 · 火 → 炼符成功率',
      '水 → 寻幽（秘闻发现与灵石收益）· 土 → 经营（劳作银两）',
    ],
    seen: (s) => (s.cultivation?.cultivators || []).length > 0,
    hint: '收得第一位修士后可见',
  },
  {
    id: 'mech-sect', title: '送人进宗门不是白送',
    prose: '宗门只收三灵根以上的资质，并且会按资质给一份引荐礼（灵石）。'
      + '听起来是笔好买卖，但进了宗门的族人**不再提供驻守、劳作、探索加成，'
      + '也不能派去镇守领地**——他们不受家族调遣。'
      + '灵石是冲关的硬通货，所以「把一个天灵根换成四道门槛的钱」和'
      + '「把他留在族里冲击化神」，确实是个需要想一想的取舍。',
    lines: (s) => {
      const ps = s.cultivation?.cultivators || [];
      const ok = ps.filter((p) => rootRank(p) >= SECT_MIN_ROOT_RANK);
      return [
        `宗门门槛：${ROOT_GRADE_MAP.triple.name}及以上`,
        `族中可送者 ${ok.length} 人`,
        ...ok.slice(0, 5).map((p) => `${p.name}（${rootText(p)}）：引荐礼约 ${sectReferralReward(p)} 灵石`),
      ];
    },
    seen: (s) => (s.cultivation?.cultivators || []).length > 0,
    hint: '收得第一位修士后可见',
  },
  {
    id: 'mech-offline', title: '关掉页面也在修行',
    prose: '凡尘自有其节律，族人不因你闭眼而停下。离开的这段时间会被折算成一次结算，'
      + `最多补 ${OFFLINE_CAP_HOURS} 个时辰。但有两件事不等你：`
      + '**符箓的保质期照常流逝**，领地民怨该涨还是涨。',
    lines: () => [`离线最多折算 ${OFFLINE_CAP_HOURS} 小时`, `存档每 ${SAVE_INTERVAL_MS / 1000} 秒自动落一次`],
    seen: () => true,
  },
];

/* ── 章节 ── */

/**
 * 百科对「功法效果」的措辞 —— 与界面上的标签是两套文案：
 * 界面要短（挤在卡片里），百科可以写全（独立成行）。
 */
const CODEX_EFFECT_LABEL = {
  training: (v) => `闭关修为 +${Math.round(v * 100)}%`,
  power:    (v) => `修士战力 +${Math.round(v * 100)}%`,
  labor:    (v) => `劳作银两 +${Math.round(v * 100)}%`,
  explore:  (v) => `秘闻发现 +${Math.round(v * 100)}%`,
  survive:  (v) => `洞天生还 +${Math.round(v * 100)} 个百分点`,
  stones:   (v) => `洞天灵石 +${Math.round(v * 100)}%`,
};

/** 去掉文案里的 **强调** 标记 —— 百科正文是纯文本，不解析 Markdown。 */
function plainText(str) {
  return String(str == null ? '' : str).replace(/\*\*/g, '');
}

const CODEX_CHAPTERS = [
  {
    id: 'realm', name: '境界', icon: '☯',
    intro: '自凡人至化神，一阶一阶，都是拿年月换来的。',
    entries: [
      {
        id: 'realm-0', title: '凡人',
        prose: CODEX_REALM_PROSE[0],
        lines: () => ['容纳量由房产决定', `每名凡人提供 0.1 战力`],
        seen: () => true,
      },
      ...REALM_TIERS.map((tier) => ({
        id: `realm-${tier.id}`,
        title: tier.name,
        prose: CODEX_REALM_PROSE[tier.id],
        lines: (s) => {
          const reach = (s.cultivation?.cultivators || []).some((p) => (p.realmIndex || 0) >= tier.startIndex);
          return [
            `共 ${tier.stages.length} 小境界：${tier.stages.join('／')}`,
            `修炼基数 ${tier.xpBase} · 第一层战力 ${tier.powerFrom.toLocaleString('zh-CN')}`,
            `跨入此境需：${
              (() => {
                const g = realmGate(tier.startIndex - 1);
                if (!g) return '无需冲关';
                return `${ALCHEMY_RECIPE_MAP[g.pill]?.name || '丹药'}×1 + ${g.stones} 灵石 + ${g.clues} 线索（基础成功率 ${(g.baseRate * 100).toFixed(0)}%）`;
              })()
            }`,
            reach ? '族中已有族人至此' : '族中尚无人至此',
          ];
        },
        seen: (s) => (s.cultivation?.cultivators || []).some((p) => (p.realmIndex || 0) >= tier.startIndex - 1),
        hint: `有族人修至${tier.name}前后可见`,
        tags: tier.stages.join(' '),
      })),
    ],
  },

  {
    id: 'home', name: '家业', icon: '⌂',
    intro: '凡尘的账。修士也要吃饭，也要有地方住。',
    entries: codexFromTable(BUILDINGS, {
      prefix: 'home',
      title: (b) => b.name,
      prose: (b) => `${b.lore}　　${b.tagline}。`,
      lines: (b, s) => {
        const n = Math.floor(s.buildings?.[b.id] || 0);
        const out = [
          `${b.perText}`,
          `现建 ${n} 座`,
          `第 ${n + 1} 座造价：${fmt(b.baseCost * Math.pow(b.growth, n))} 银两`,
        ];
        if (b.tech) out.push(`需研习：${TECH_MAP[b.tech]?.name || b.tech}`);
        if (b.footnote) out.push(b.footnote());
        return out;
      },
      seen: (b, s) => !b.tech || (s.techs || []).includes(b.tech),
      hint: '研习对应技术后可见',
      tags: (b) => b.tagline,
    }),
  },

  {
    id: 'map', name: '舆图', icon: '⛰',
    intro: '方寸之地，也有远近亲疏。',
    entries: MAP_NODES.map((n) => ({
      id: `map-${n.id}`,
      title: n.name,
      prose: n.lore,
      lines: (s) => {
        const st = mapNodeStatus(s, n.id);
        const base = n.kind === 'cave'
          ? [`类型：洞天（可探险）`, `建议境界 ${realmName(n.realm)}`, `消耗 ${n.fee} 灵石 + ${n.clues} 线索`]
          : [`类型：势力（可攻伐 / 可占领）`, `敌方战力 ${n.power.toLocaleString('zh-CN')}`, `攻下即得 ${n.stones} 灵石`,
            `占领后：${(n.yield * 3600).toFixed(1)} 灵石/时 + ${ALCHEMY_HERB_MAP[n.herb]?.name || ''} ${(n.herbYield * 3600).toFixed(1)}/时`
            + ` + ${FORGE_ORE_MAP[n.ore]?.name || ''} ${(n.oreYield * 3600).toFixed(2)}/时`
            + ` + ${RUNE_MATERIAL_MAP[n.rune]?.name || ''} ${(n.runeYield * 3600).toFixed(2)}/时`,
            `镇守需求 ${mapHoldPower(n)} 战力`];
        const state0 = { locked: '尚未打通', open: '已抵达，尚未拿下', cleared: '已探明', held: '已占领' }[st] || st;
        return [...base, `当前状态：${state0}`];
      },
      seen: (s) => mapAccessible(s, n.id),
      hint: '打通相邻的地区后可见',
      tags: n.kind === 'cave' ? '洞天 探险' : '势力 攻伐 占领',
    })),
  },

  {
    id: 'pill', name: '丹药', icon: '⚗',
    intro: '丹道属木。一炉药成，往往要折进去好几倍的药材。',
    entries: ALCHEMY_RECIPES.map((r) => ({
      id: `pill-${r.id}`,
      title: r.name,
      prose: r.desc,
      lines: (s) => [
        `材料：${Object.entries(r.materials).map(([k, v]) => `${ALCHEMY_HERB_MAP[k].name}×${v}`).join('　')}`,
        `基础成功率 ${(r.baseRate * 100).toFixed(0)}% · 每炉出 ${r.yield} 枚 · 需 ${ALCHEMY_FURNACE[r.furnace - 1].name}`,
        `效果：${r.effect}`,
        `现有 ${pillCount(s, r.id)} 枚`,
      ],
      seen: (s) => pillCount(s, r.id) > 0 || (s.cultivation?.alchemy?.crafts || 0) > 0,
      hint: '炼出第一炉丹后可见',
      tags: '炼丹 丹药',
    })),
  },

  {
    id: 'artifact', name: '法器', icon: '🔨',
    intro: '器道属金。铸成只是开始，往后还要一直养。',
    entries: FORGE_ITEMS.map((it) => ({
      id: `art-${it.id}`,
      title: it.name,
      prose: it.desc,
      lines: (s) => {
        const owned = forgeOf(s).owned.includes(it.id);
        return [
          `部位：${FORGE_SLOT_MAP[it.slot].name} · 材料：${Object.entries(it.materials).map(([k, v]) => `${FORGE_ORE_MAP[k].name}×${v}`).join('　')}`,
          `基础成功率 ${(it.baseRate * 100).toFixed(0)}% · 需 ${FORGE_LEVELS[it.forge - 1].name}`,
          `效果：战力 +${(it.power * 100).toFixed(0)}%${it.survive ? ` · 洞天生还 +${(it.survive * 100).toFixed(0)}%` : ''}`,
          owned ? `已铸成 · 当前耐久 ${Math.round(durabilityOf(s, it.id))}%` : '尚未铸成',
        ];
      },
      seen: (s) => forgeOf(s).owned.includes(it.id) || (s.cultivation?.forge?.crafts || 0) > 0,
      hint: '铸成第一件法器后可见',
      tags: `炼器 ${FORGE_SLOT_MAP[it.slot].name}`,
    })),
  },

  {
    id: 'rune', name: '符箓', icon: '📜',
    intro: '符道属火。画在纸上的东西，留不住太久。',
    entries: RUNE_ITEMS.map((r) => ({
      id: `rune-${r.id}`,
      title: r.name,
      prose: r.desc,
      lines: (s) => [
        `材料：${Object.entries(r.materials).map(([k, v]) => `${RUNE_MATERIAL_MAP[k].name}×${v}`).join('　')}`,
        `基础成功率 ${(r.baseRate * 100).toFixed(0)}% · 需 ${RUNE_BENCH_LEVELS[r.bench - 1].name}`,
        `效果：${r.text}`,
        `保质期 ${RUNE_SHELF_HOURS} 小时 · 现有 ${runeCount(s, r.id)} 张`,
      ],
      seen: (s) => runeCount(s, r.id) > 0 || (s.cultivation?.runes?.crafts || 0) > 0,
      hint: '画出第一张符后可见',
      tags: '炼符 符箓',
    })),
  },

  {
    id: 'manual', name: '功法', icon: '📖',
    intro: '五条道途、三个品阶、六个流派。每一本都单独成条 —— 收录了才看得到。',
    // **每本功法各一条**，而不是按道途归并。
    // 流派是「玩法身份」，玩家要能一眼看到「这本属于哪条路、代价是什么」。
    entries: CULTIVATION_MANUALS.map((m) => {
      const sc = schoolOf(m);
      const el = MANUAL_DAO_ELEMENT[m.dao];
      const fx = Object.entries(m.effect || {})
        .map(([k, v]) => (CODEX_EFFECT_LABEL[k] ? CODEX_EFFECT_LABEL[k](v) : `${k} +${Math.round(v * 100)}%`))
        .join(' · ');
      return {
        id: `manual-${m.id}`,
        title: m.name,
        prose: `${MANUAL_TIER_NAME[m.tier]}${MANUAL_DAOS[m.dao].name}法门。${MANUAL_DAOS[m.dao].desc}。`
          + (sc.id === 'orthodox' ? '' : `　　（${sc.name}：${sc.tagline}）`),
        lines: (s) => {
          const owned = (s.cultivation?.manuals || []).includes(m.id);
          return [
            `${MANUAL_TIER_NAME[m.tier]} · 道途「${MANUAL_DAOS[m.dao].name}」· 流派「${sc.name}」`,
            `本功效果：${fx}`,
            `所需灵根：${el ? `${elementName(el)}系（天灵根不受限）` : '无属性，人人可修'}`,
            sc.id === 'orthodox' ? '流派代价：无' : `流派机制：${sc.desc}`,
            sc.id === 'orthodox' ? '' : `流派代价：${plainText(sc.price)}`,
            owned ? '已收录' : '尚未收录',
          ].filter(Boolean);
        },
        seen: (s) => (s.cultivation?.manuals || []).includes(m.id),
        hint: '收录这本功法后可见',
        tags: `${sc.name} ${MANUAL_DAOS[m.dao].name} ${MANUAL_TIER_NAME[m.tier]}`,
      };
    }),
  },

  {
    id: 'school', name: '流派', icon: '⚔',
    intro: '同一部功法，走出不同的路。**只有主修位的流派生效** —— 一个人只能走一条路。',
    entries: MANUAL_SCHOOLS.map((sc) => ({
      id: `school-${sc.id}`,
      title: sc.name,
      prose: sc.lore,
      lines: (s) => {
        const active = mainSchoolOf(s).id === sc.id;
        const own = CULTIVATION_MANUALS.filter((m) => schoolOf(m).id === sc.id);
        return [
          `一句话：${sc.tagline}`,
          `独有机制：${sc.desc}`,
          `代价：${plainText(sc.price)}`,
          `本流派共 ${own.length} 本：${own.map((m) => MANUAL_TIER_NAME[m.tier] + m.name).join('、') || '（暂无）'}`,
          active ? '**当前主修即此流派**' : '',
        ].filter(Boolean);
      },
      seen: (s) => (s.cultivation?.manuals || []).some((id) => schoolOf(CULTIVATION_MANUAL_MAP[id]).id === sc.id),
      hint: '收录本流派的任意一本功法后可见',
      tags: sc.name,
    })),
  },

  {
    id: 'morality', name: '道心', icon: '☯',
    intro: '不是善恶评分，而是你在这个世界里被当成什么人。',
    entries: [
      {
        id: 'morality-what', title: '道心是什么',
        prose: '族中老人管它叫「道心」，外人管它叫「名声」。'
          + '它不评判你做过什么，只记录**你在这个地界上被当成什么人**。'
          + '血债缠身的人凶名在外，镇得住人，也招得来天谴；'
          + '问心无愧的人得天所佑，可下不去狠手。'
          + '**道心不跨周目保留** —— 轮回是重新做人，前世的血债不该跟着走。',
        lines: (s) => {
          const t = moralityTierOf(s);
          return [
            `当前道心：${moralityOf(s).toFixed(1)} / ${MORALITY_MAX}（${t.name}）`,
            `洞天生还修正 ${t.caveBonus >= 0 ? '+' : ''}${(t.caveBonus * 100).toFixed(0)} 个百分点`,
            `攻伐胜算修正 ${t.warBonus >= 0 ? '+' : ''}${(t.warBonus * 100).toFixed(0)} 个百分点`,
            `领地赋税 ×${t.taxMult.toFixed(2)}`,
          ];
        },
        seen: () => true,
        tags: '道德 心魔 天谴 民心',
      },
      {
        id: 'morality-tiers', title: '道心的五个档位',
        prose: '从魔道到道心通明，五个档位各有各的活法。'
          + '**魔道能打但养不起地，正道养得起但打不动** —— 这三条后果是一组真正的取舍。',
        lines: () => MORALITY_TIERS.map((t) =>
          `${t.name}（${t.min}–${t.max}）：生还 ${t.caveBonus >= 0 ? '+' : ''}${(t.caveBonus * 100).toFixed(0)}pp`
          + ` · 胜算 ${t.warBonus >= 0 ? '+' : ''}${(t.warBonus * 100).toFixed(0)}pp · 赋税 ×${t.taxMult.toFixed(2)}`),
        seen: () => true,
      },
      {
        id: 'morality-change', title: '道心怎么变',
        prose: '主修血煞一脉的功法，道心会**持续下坠**，练得越久陷得越深。'
          + '不走邪路时道心**回归中道**（离 50 越远回得越快）—— 所以想守住正道必须主动行善。',
        lines: (s) => [
          `主修流派：${mainSchoolOf(s).name}`,
          `当前漂移：${schoolDrift(s) !== 0
            ? `每秒 ${schoolDrift(s).toFixed(4)}（持续下坠）`
            : '回归中道 50（每秒最多 +' + MORALITY_DRIFT_GOOD.toFixed(4) + '）'}`,
          `施粥赈济：${fmt(GOOD_DEED_SILVER)} 两银 → 道心 +${GOOD_DEED_GAIN}`,
          '炼一枚人丹：道心 ' + MORALITY_HUMAN_PILL_COST,
        ],
        seen: (s) => moralityOf(s) !== MORALITY_START || (s.cultivation?.manuals || []).length > 0,
        hint: '收录任意一本功法后可见',
      },
      {
        id: 'morality-human-pill', title: '人丹',
        prose: '血煞一门的看家手段。把凡人炼成一枚丹，服下者修为暴涨。'
          + '话说得漂亮——「与其老死田垄，不如把这点灵气还给修士」——'
          + '做的事却难看：族中人口一年比一年少，而修为什么都不缺。'
          + '**原料是人**，所以这是全篇最重的代价。',
        lines: (s) => [
          `解锁条件：主修「血煞魔功」一脉的功法`,
          `炼一枚：献祭凡人 ${HUMAN_PILL_MORTALS} 口 + ${HUMAN_PILL_STONES} 灵石，道心 ${MORALITY_HUMAN_PILL_COST}`,
          `服下：修为 +${Math.round(HUMAN_PILL_XP_RATIO * 100)}%（该修士当前一层所需）`,
          `现有人丹 ${humanPillCount(s)} 枚`,
        ],
        seen: (s) => schoolUnlocks(s, 'humanPill') || humanPillCount(s) > 0
          || (s.cultivation?.manuals || []).some((id) => schoolOf(CULTIVATION_MANUAL_MAP[id]).id === 'demonic'),
        hint: '收录血煞一脉的功法后可见',
        tags: '邪修 血煞 献祭',
      },
    ],
  },

  {
    id: 'job', name: '职责', icon: '⚑',
    intro: '一个人只能做一件事。派去哪里，就是取舍。',
    entries: Object.entries(CULTIVATOR_JOBS).map(([id, def]) => ({
      id: `job-${id}`,
      title: def.name,
      prose: def.desc,
      lines: (s) => {
        const ps = (s.cultivation?.cultivators || []).filter((p) => p.job === id);
        return [`族中现有 ${ps.length} 人`, ...ps.slice(0, 8).map((p) => `${p.name}（${realmName(p.realmIndex)}）`)];
      },
      seen: (s) => (s.cultivation?.cultivators || []).some((p) => p.job === id),
      hint: '有人担任此职后可见',
    })),
  },

  {
    id: 'mech', name: '规矩', icon: '✎',
    intro: '这些是这个世界的规矩。看不懂数值的时候，先来这里。',
    entries: CODEX_MECHANICS,
  },
];

/* ── 索引 ── */

const CODEX_CHAPTER_MAP = Object.fromEntries(CODEX_CHAPTERS.map((c) => [c.id, c]));
