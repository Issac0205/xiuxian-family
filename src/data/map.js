
/* ────────────────────────────────────────────────────────────────
 * 区块：地图
 * 职责：把原来的「洞天 4 处 + 势力 3 个」两张平表，升级成一张**有位置关系的地图**。
 *       节点摆成 4×2 的网格，相邻才能去；每个节点自带「建议境界」与产出。
 * 依赖：无（纯数据 + 纯查表函数）
 * 调参：
 *   MAP_NODES —— 节点表。col/row 决定位置与相邻关系（上下左右），
 *                kind = 'cave'（可探险）| 'foe'（可攻伐、可占领）
 *   MAP_HOLD_RATIO —— 占领后需要的镇压战力 = 该节点战力 × 这个比例
 * 文档：docs/40-地图与征伐.md
 * ──────────────────────────────────────────────────────────────── */

/** 地图尺寸。col 往东、row 往南。 */
const MAP_COLS = 4;
const MAP_ROWS = 2;

/**
 * 节点表。
 *
 * 洞天（kind:'cave'）
 *   fee/clues  入场消耗（灵石 / 秘闻线索）
 *   realm      建议境界（全局 realmIndex）—— 差距越大生还率越低
 *   stones     基础灵石收益
 *   manual     掉功法概率（掉的是 tier 对应品阶）
 *
 * 势力（kind:'foe'）
 *   power      敌方战力，决定攻伐胜率
 *   stones     攻下时的一次性灵石
 *   manual     缴获功法概率
 *   yield      占领后**每秒**产出的灵石（需要镇守）
 *   herb       占领并有效镇守后每秒产出的药材 id（见 data/alchemy.js）
 *   herbYield  药材的每秒产量
 *   ore        占领并有效镇守后每秒产出的矿料 id（见 data/forge.js）
 *   oreYield   矿料的每秒产量
 *   rune       占领并有效镇守后每秒产出的符文 id（见 data/runes.js）
 *   runeYield  符文的每秒产量
 *
 * 同一个节点同时产一味药材、一种矿料、一样符文 —— 炼丹 / 炼器 / 炼符
 * 三条线共用领地供给，但材料彼此独立，所以玩家不必在三者之间做排他选择。
 *
 * 所有节点都有 tier（1–4）与 lore（百科/提示用）。
 */
const MAP_NODES = [
  /* ── 第一列：起点区 ── */
  {
    id: 'mosscave', name: '青苔谷', col: 0, row: 0, tier: 1, kind: 'cave',
    realm: 1, fee: 0.2, clues: 1, stones: 0.7, manual: 0.05,
    lore: '谷口终年湿滑，苔痕没膝。谷底有一处天然石穴，灵气比外头稠些，是家族子弟开眼界的头一站。',
  },
  {
    id: 'valley', name: '青木寨', col: 0, row: 1, tier: 1, kind: 'foe',
    power: 110, stones: 3, manual: 0.10, yield: 0.001, herb: 'grass', herbYield: 0.002, ore: 'lingmu', oreYield: 0.0008, rune: 'paper', runeYield: 0.0006,
    lore: '占山为寨的散修百余口，靠劫掠过路商队过活。寨子里没有高手，但人多。',
  },
  /* ── 第二列 ── */
  {
    id: 'mistcave', name: '流霞坡', col: 1, row: 0, tier: 2, kind: 'cave',
    realm: 3, fee: 1, clues: 2, stones: 3, manual: 0.15,
    lore: '坡上常年笼着一层赤霞，据说是前人斗法余烬未散。往里走能拾到烧残的法器碎片。',
  },
  {
    id: 'river', name: '黑水门', col: 1, row: 1, tier: 2, kind: 'foe',
    power: 560, stones: 15, manual: 0.32, yield: 0.003, herb: 'ling', herbYield: 0.0015, ore: 'hantie', oreYield: 0.0006, rune: 'cinnabar', runeYield: 0.00045,
    lore: '盘踞黑水渡口的修士门派，靠收渡钱起家。门主炼气七层，门下弟子都懂些水法。',
  },
  /* ── 第三列 ── */
  {
    id: 'grotto', name: '玄阴涧', col: 2, row: 0, tier: 3, kind: 'cave',
    realm: 6, fee: 4, clues: 3, stones: 12, manual: 0.34,
    lore: '涧底终年不见天日，阴气凝而不散。传闻有人在里面见过完整的古碑。',
  },
  {
    id: 'ridge', name: '玄铁宗', col: 2, row: 1, tier: 3, kind: 'foe',
    power: 2400, stones: 65, manual: 0.7, yield: 0.010, herb: 'iron', herbYield: 0.001, ore: 'xuantie', oreYield: 0.0005, rune: 'ink', runeYield: 0.00035,
    lore: '以炼器立宗的小门派，山门用整块玄铁铸成。宗内弟子皆习金系功法，硬碰硬讨不到好。',
  },
  /* ── 第四列：深处 ── */
  {
    id: 'wastes', name: '太虚原', col: 3, row: 0, tier: 4, kind: 'cave',
    realm: 9, fee: 12, clues: 5, stones: 40, manual: 0.7,
    lore: '一片寸草不生的荒原，据说上古时有大能在此开过一场法会，余威至今未散。',
  },
  {
    id: 'beastnest', name: '万兽谷', col: 3, row: 1, tier: 4, kind: 'foe',
    power: 12000, stones: 240, manual: 0.7, yield: 0.025, herb: 'flame', herbYield: 0.0008, ore: 'yaogu', oreYield: 0.0003, rune: 'blood', runeYield: 0.0002,
    lore: '深谷里盘踞着一头筑基期的妖兽，方圆百里的散修都绕道走。占了这里，商路才算真正打通。',
  },
];

const MAP_NODE_MAP = Object.fromEntries(MAP_NODES.map((n) => [n.id, n]));

/** 玩家踏上仙途时的起点。 */
const MAP_START_ID = 'mosscave';

/** 占领后需要的镇压战力 = 节点战力 × 这个比例。 */
const MAP_HOLD_RATIO = 0.5;

/** 无镇守（或镇守战力不足）时，民怨每秒上涨多少；到 1 就叛离。 */
const MAP_UNREST_PER_SEC = 1 / 900;
/** 有足够镇守时，民怨每秒回落多少。 */
const MAP_CALM_PER_SEC = 1 / 300;

/* ── 查表 ── */

function mapNode(id) { return MAP_NODE_MAP[id] || null; }

/** 该节点需要的镇守战力。 */
function mapHoldPower(node) { return Math.round((node?.power || 0) * MAP_HOLD_RATIO); }

/**
 * 相邻节点：上下左右（不越界）。
 * 邻接关系完全由网格推出，所以改 col/row 就等于改地图。
 */
function mapNeighbors(node) {
  if (!node) return [];
  const out = [];
  for (const [dc, dr] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
    const c = node.col + dc;
    const r = node.row + dr;
    if (c < 0 || c >= MAP_COLS || r < 0 || r >= MAP_ROWS) continue;
    const hit = MAP_NODES.find((n) => n.col === c && n.row === r);
    if (hit) out.push(hit);
  }
  return out;
}

/** 按网格取节点，供界面摆位用。 */
function mapAt(col, row) { return MAP_NODES.find((n) => n.col === col && n.row === row) || null; }

/** 洞天节点（保持旧代码习惯用的视图）。 */
const CAVES = MAP_NODES.filter((n) => n.kind === 'cave');
/** 势力节点。 */
const FOES = MAP_NODES.filter((n) => n.kind === 'foe');
/** 旧代码用数组下标取洞天，这里保留 id → 下标的映射。 */
const CAVE_INDEX = Object.fromEntries(CAVES.map((n, i) => [n.id, i]));
