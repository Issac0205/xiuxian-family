/**
 * 区块：坊市与通商（规则）
 * 【策划 docs/96-坊市与通商.md】
 *
 * 三件必须记住的事：
 *   ① **秘闻是消耗品**：`state.secrets` 是「累计发现」（下标集合，只增不减），
 *      新加 `state.secretsUsed` 记「已花掉几条」。**一切旧门槛一律读累计**，
 *      所以花费**不会关掉已经打开的门**（这一条是写这段代码的理由）。
 *   ② **抽池判重仍只用 `secrets`**：同一条秘闻永不重复出现（`engine.js` 里那段
 *      不动）。花费只是记账，不与抽池耦合。
 *   ③ **灵石→银两是本块新开的边**：现存代码里没有这条边，所以反套利必须自己守。
 *      守法：卖出价 = 买入价 × `MARKET_SELL_RATIO`（0.8）⇒ 任一回路严格亏 20%，
 *      而且与兑换笔数、与科技培率**都无关**（两侧同除同一个 (1+tradeStoneMult)）。
 */

/** 当前还剩几条可花的秘闻。 */
function secretsAvailable(state) {
  const total = (state.secrets || []).length;
  const used = Math.max(0, Math.floor(Number(state.secretsUsed) || 0));
  return Math.max(0, total - used);
}

function marketOf(id) {
  return MARKETS.find((m) => m.id === id) || null;
}

function marketGoodOf(id) {
  return MARKET_GOODS.find((g) => g.id === id) || null;
}

function marketGoodsOf(marketId) {
  return MARKET_GOODS.filter((g) => g.market === marketId);
}

/** 已占据的势力城数（剿城开市的判据）。⚠ 用 held 不用 reached。 */
function heldCities(state) {
  return (worldOf(state).held || []).length;
}

/** 该坊市是否已开放。 */
function marketOpen(state, marketId) {
  const m = marketOf(marketId);
  if (!m) return false;
  if ((state.secrets || []).length < (m.requiresSecrets || 0)) return false;
  return heldCities(state) >= (m.requiresHeld || 0);
}

/** 为什么没开放（给界面点名理由用）。 */
function marketBlockReason(state, marketId) {
  const m = marketOf(marketId);
  if (!m) return '无此坊市';
  const need = m.requiresSecrets || 0;
  const have = (state.secrets || []).length;
  if (have < need) return `须先集齐 ${need} 条秘闻（现有 ${have}）`;
  const needHeld = m.requiresHeld || 0;
  const held = heldCities(state);
  if (held < needHeld) return `须先打下 ${needHeld} 座势力城（现有 ${held}）`;
  return '';
}

function goodUnlocked(state, goodId) {
  return (state.marketUnlocks || []).includes(goodId);
}

/** 解锁一件商品的前置检查（不扣秘闻）。 */
function planUnlockGood(state, goodId) {
  const g = marketGoodOf(goodId);
  if (!g) return { ok: false, reason: '无此商品' };
  if (!marketOpen(state, g.market)) {
    return { ok: false, reason: `${marketOf(g.market).name}尚未开放：${marketBlockReason(state, g.market)}` };
  }
  if (goodUnlocked(state, goodId)) return { ok: false, reason: '此条目已解锁' };
  const cost = g.unlockSecrets || MARKET_UNLOCK_SECRETS;
  const have = secretsAvailable(state);
  if (have < cost) {
    return { ok: false, reason: `解锁「${g.name}」需 ${cost} 条秘闻（现有 ${have}，已花 ${state.secretsUsed || 0}）` };
  }
  return { ok: true, cost, name: g.name };
}

/** 花秘闻解锁一件商品 —— **真的消耗**，这是本块的核心规则。 */
function commitUnlockGood(state, goodId) {
  const plan = planUnlockGood(state, goodId);
  if (!plan.ok) return plan;
  state.secretsUsed = Math.max(0, Math.floor(Number(state.secretsUsed) || 0)) + plan.cost;
  state.marketUnlocks = [...(state.marketUnlocks || []), goodId];
  pushLog(state, `在${marketOf(marketGoodOf(goodId).market).name}花掉 ${plan.cost} 条秘闻，解锁了「${plan.name}」。`, 'unlock');
  return { ok: true, ...plan };
}

/** 买一件商品的前置检查（不扣钱）。 */
function planBuyGood(state, goodId) {
  const g = marketGoodOf(goodId);
  if (!g) return { ok: false, reason: '无此商品' };
  if (!marketOpen(state, g.market)) {
    return { ok: false, reason: `${marketOf(g.market).name}尚未开放：${marketBlockReason(state, g.market)}` };
  }
  if (!goodUnlocked(state, goodId)) {
    return { ok: false, reason: `须先花 ${g.unlockSecrets || MARKET_UNLOCK_SECRETS} 条秘闻解锁「${g.name}」` };
  }
  const stones = g.price || 0;
  if ((state.spiritStones || 0) < stones) {
    return { ok: false, reason: `${g.name}需 ${stones} 灵石（现有 ${(state.spiritStones || 0).toFixed(2)}）` };
  }
  return { ok: true, price: stones, name: g.name };
}

/** 买下并立即生效。 */
function commitBuyGood(state, goodId) {
  const plan = planBuyGood(state, goodId);
  if (!plan.ok) return plan;
  const g = marketGoodOf(goodId);
  state.spiritStones = Math.max(0, (state.spiritStones || 0) - plan.price);

  const e = g.effect || {};
  if (e.kind === 'pill') addPills(state, e.pill, e.n || 1);
  else if (e.kind === 'pool-blueprint') state.cultivation.poolBlueprint = true;
  else if (e.kind === 'clue') state.cultivation.clues = Math.max(0, Math.floor(Number(state.cultivation.clues) || 0) + (e.n || 1));
  else if (e.kind === 'silver') state.silver = Math.max(0, (state.silver || 0) + (e.n || 0));

  pushLog(state, `在${marketOf(g.market).name}买入「${g.name}」（${plan.price} 灵石）。`, 'trade');
  return { ok: true, ...plan };
}

/**
 * 反向兑换：**灵石 → 银两**（本块新开的边）。
 *
 * 买入视角：`q.silver` 银两 → `q.stones` 灵石。
 * 卖出按 0.8 折 ⇒ 换出去再换回来**严格亏 20%**，环闭不上。
 */
function marketSellQuote(state, n = 1) {
  const q = marketExchangeQuote(state);
  const silverPerStone = q.silver / q.stones;
  const stones = Math.max(1, Math.floor(n));
  return { stones, silver: Math.floor(silverPerStone * MARKET_SELL_RATIO * stones) };
}

function planSellStones(state, n = 1) {
  const quote = marketSellQuote(state, n);
  if (!marketOpen(state, 'yunshen')) {
    return { ok: false, reason: `云深谷坊市尚未开放：${marketBlockReason(state, 'yunshen')}` };
  }
  if ((state.spiritStones || 0) < quote.stones) {
    return { ok: false, reason: `须有 ${quote.stones} 灵石（现有 ${(state.spiritStones || 0).toFixed(2)}）` };
  }
  return { ok: true, ...quote };
}

function commitSellStones(state, n = 1) {
  const plan = planSellStones(state, n);
  if (!plan.ok) return plan;
  state.spiritStones = Math.max(0, (state.spiritStones || 0) - plan.stones);
  state.silver = Math.max(0, (state.silver || 0) + plan.silver);
  state.marketSellCount = Math.max(0, Math.floor(Number(state.marketSellCount) || 0)) + 1;
  pushLog(state, `把 ${plan.stones} 枚灵石折成 ${plan.silver} 两白银（折价 ${Math.round((1 - MARKET_SELL_RATIO) * 100)}%）。`, 'trade');
  return { ok: true, ...plan };
}

/** 界面用的一览：每座坊市 + 它的商品 + 当前状态。 */
function marketOverview(state) {
  return MARKETS.map((m) => ({
    id: m.id,
    name: m.name,
    desc: m.desc,
    open: marketOpen(state, m.id),
    reason: marketBlockReason(state, m.id),
    goods: marketGoodsOf(m.id).map((g) => {
      const unlocked = goodUnlocked(state, g.id);
      const buy = planBuyGood(state, g.id);
      return {
        id: g.id, name: g.name, desc: g.desc,
        price: g.price, unlockSecrets: g.unlockSecrets || MARKET_UNLOCK_SECRETS,
        unlocked,
        canUnlock: planUnlockGood(state, g.id).ok,
        canBuy: buy.ok,
      };
    }),
  }));
}
