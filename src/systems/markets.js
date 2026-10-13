/**
 * 区块：坊市与通商（规则）
 * 【策划 docs/96-坊市与通商.md、docs/104-凡人篇重构.md §I2】
 *
 * 四件必须记住的事：
 *   ① **秘闻是消耗品**：`state.secrets` 是「累计发现」（下标集合，只增不减），
 *      新加 `state.secretsUsed` 记「已花掉几条」。**一切旧门槛一律读累计**，
 *      所以花费**不会关掉已经打开的门**（这一条是写这段代码的理由）。
 *   ② **抽池判重仍只用 `secrets`**：同一条秘闻永不重复出现（`engine.js` 里那段
 *      不动）。花费只是记账，不与抽池耦合。
 *   ③ **灵石→银两是本块新开的边**：现存代码里没有这条边，所以反套利必须自己守。
 *      守法：卖出价 = 买入价 × `MARKET_SELL_RATIO`（0.8）⇒ 任一回路严格亏 20%，
 *      而且与兑换笔数、与科技培率**都无关**（两侧同除同一个 (1+tradeStoneMult)）。
 *   ④ 【凡人篇 I2】**分段显现**：江南坊市（id `yunshen`）按累计秘闻分六段
 *      （`MARKET_SEGMENTS`）。段门槛只读**累计** `state.secrets.length`；
 *      `secretsUsed` 只用来算「还剩几条可花」。段未显现 ⇒ 段里的货**摆出来但灰着**
 *      （界面不许整段隐藏，见 `marketOverview`）。
 */

/** 当前还剩几条可花的秘闻。 */
function secretsAvailable(state) {
  const total = (state.secrets || []).length;
  const used = Math.max(0, Math.floor(Number(state.secretsUsed) || 0));
  return Math.max(0, total - used);
}

/** 累计发现了几条秘闻 —— 【I2】分段门槛的唯一判据。 */
function secretTotal(state) {
  return (state.secrets || []).length;
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

/* ────────────────────── 【I2】分段 ────────────────────── */

/** 这座坊市的分段表（没有分段表的坊市返回空数组 —— 它整座就是一个门）。 */
function marketSegmentsOf(marketId) {
  const t = (typeof MARKET_SEGMENTS === 'object' && MARKET_SEGMENTS) || {};
  return Array.isArray(t[marketId]) ? t[marketId] : [];
}

function marketSegmentOf(marketId, segId) {
  return marketSegmentsOf(marketId).find((s) => s.id === segId) || null;
}

/** 商品所属的段；没有分段（或商品没写 segment）时返回 null。 */
function segmentOfGood(goodId) {
  const g = typeof goodId === 'string' ? marketGoodOf(goodId) : goodId;
  if (!g || !g.segment) return null;
  return marketSegmentOf(g.market, g.segment);
}

/** 这一段是否已显现 —— 读**累计**秘闻，不看花掉多少。 */
function segmentRevealed(state, seg) {
  return Boolean(seg) && secretTotal(state) >= (Number(seg.needSecrets) || 0);
}

function goodSegmentRevealed(state, goodId) {
  const seg = segmentOfGood(goodId);
  return !seg || segmentRevealed(state, seg);
}

/** 段门槛的统一文案（界面与 plan 共用一句话，免得两处对不上）。 */
function segmentNeedText(seg) {
  return `需 ${Number(seg && seg.needSecrets) || 0} 条秘闻`;
}

/* ────────────────────── 门槛与解锁 ────────────────────── */

/** 该坊市是否已开放（整座坊市的门；江南坊市现在是 0 条，靠分段把关）。 */
function marketOpen(state, marketId) {
  const m = marketOf(marketId);
  if (!m) return false;
  if (secretTotal(state) < (m.requiresSecrets || 0)) return false;
  return heldCities(state) >= (m.requiresHeld || 0);
}

/** 为什么没开放（给界面点名理由用）。 */
function marketBlockReason(state, marketId) {
  const m = marketOf(marketId);
  if (!m) return '无此坊市';
  const need = m.requiresSecrets || 0;
  const have = secretTotal(state);
  if (have < need) return `须先集齐 ${need} 条秘闻（现有 ${have}）`;
  const needHeld = m.requiresHeld || 0;
  const held = heldCities(state);
  if (held < needHeld) return `须先打下 ${needHeld} 座势力城（现有 ${held}）`;
  return '';
}

/** 一件商品解锁要花几条秘闻（`unlockSecrets: 0` = 免秘闻段，不花也不解）。 */
function goodUnlockCost(g) {
  const n = Number(g && g.unlockSecrets);
  return Number.isFinite(n) ? Math.max(0, Math.floor(n)) : MARKET_UNLOCK_SECRETS;
}

function goodNeedsUnlock(g) {
  return goodUnlockCost(g) > 0;
}

/** 计价货币：'stones'（灵石）/ 'silver'（银两）。 */
function goodCurrency(g) {
  return g && g.currency === 'silver' ? 'silver' : 'stones';
}

/** 价格文案（界面直接印）。 */
function goodPriceText(g) {
  const n = Number(g && g.price) || 0;
  return `${n} ${goodCurrency(g) === 'silver' ? '两' : '灵石'}`;
}

/**
 * 是否已解锁。
 * ⚠ 免秘闻段的货（`unlockSecrets: 0`）**视为已解锁**：那一段的货要是还得先点一次
 *   「解锁」，0 条秘闻的玩家就卡在解锁那一步（`secretsAvailable` 是 0，
 *   若按 1 条收费则永远解不开）—— 门又成了循环门。
 */
function goodUnlocked(state, goodId) {
  const g = marketGoodOf(goodId);
  if (g && !goodNeedsUnlock(g)) return true;
  return (state.marketUnlocks || []).includes(goodId);
}

/** 解锁一件商品的前置检查（不扣秘闻）。 */
function planUnlockGood(state, goodId) {
  const g = marketGoodOf(goodId);
  if (!g) return { ok: false, reason: '无此商品' };
  if (!marketOpen(state, g.market)) {
    return { ok: false, reason: `${marketOf(g.market).name}尚未开放：${marketBlockReason(state, g.market)}` };
  }
  const seg = segmentOfGood(g);
  if (seg && !segmentRevealed(state, seg)) {
    return {
      ok: false,
      reason: `「${seg.name}」这一段尚未显现（${segmentNeedText(seg)}，现有 ${secretTotal(state)}）`,
    };
  }
  if (!goodNeedsUnlock(g)) return { ok: false, reason: `「${g.name}」免秘闻，直接买即可` };
  if (goodUnlocked(state, goodId)) return { ok: false, reason: '此条目已解锁' };
  const cost = goodUnlockCost(g);
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
  // 【I2】段未显现：理由必须点名「需 N 条秘闻」，而且用的是**累计**数
  const seg = segmentOfGood(g);
  if (seg && !segmentRevealed(state, seg)) {
    return {
      ok: false,
      reason: `「${seg.name}」这一段尚未显现（${segmentNeedText(seg)}，现有 ${secretTotal(state)}）`,
    };
  }
  if (!goodUnlocked(state, goodId)) {
    return { ok: false, reason: `须先花 ${goodUnlockCost(g)} 条秘闻解锁「${g.name}」` };
  }
  // 功法是**唯一性**的货：族中已有就别再花冤枉钱
  const e0 = g.effect || {};
  if (e0.kind === 'manual' && familyHasManual(state, e0.manual)) {
    return { ok: false, reason: `《${manualNameOf(e0.manual)}》族中已有，不必再买` };
  }
  const currency = goodCurrency(g);
  const price = Number(g.price) || 0;
  if (currency === 'silver') {
    const have = Math.max(0, Number(state.silver) || 0);
    if (have < price) {
      return { ok: false, reason: `${g.name}需 ${price} 两银两（现有 ${Math.floor(have)}）` };
    }
    return { ok: true, price, currency, name: g.name };
  }
  if ((state.spiritStones || 0) < price) {
    return { ok: false, reason: `${g.name}需 ${price} 灵石（现有 ${(state.spiritStones || 0).toFixed(2)}）` };
  }
  return { ok: true, price, currency, name: g.name };
}

/* ── 货到手时落到哪个字段（只许落在**已有**的字段上）── */

function familyHasManual(state, manualId) {
  return Boolean(manualId) && (state.cultivation?.manuals || []).includes(manualId);
}

function manualNameOf(manualId) {
  const m = typeof CULTIVATION_MANUAL_MAP === 'object' ? CULTIVATION_MANUAL_MAP[manualId] : null;
  return (m && m.name) || manualId;
}

/** 把一门功法记进族中功法名录（已有则不重复）。 */
function grantManualToFamily(state, manualId) {
  const c = state.cultivation;
  if (!c || !manualId) return false;
  if (!Array.isArray(c.manuals)) c.manuals = [];
  if (c.manuals.includes(manualId)) return false;
  c.manuals.push(manualId);
  return true;
}

/**
 * 把符记进符房存货（与 `commitRune` 同一个字段、同一套保质期规矩）：
 * 已有存货时只加数量、**不延长**保质期（先画的先过期）。
 */
function grantRuneToShelf(state, runeId, n = 1, now = Date.now()) {
  if (typeof RUNE_ITEM_MAP !== 'object' || !RUNE_ITEM_MAP[runeId]) return false;
  const r = runesOf(state);
  const add = Math.max(1, Math.floor(Number(n) || 1));
  const shelfMs = RUNE_SHELF_HOURS * 3600 * 1000;
  const entry = r.stock[runeId];
  if (!entry || entry.n <= 0) r.stock[runeId] = { n: add, expiresAt: now + shelfMs };
  else entry.n += add;
  return true;
}

/** 买下并立即生效。 */
function commitBuyGood(state, goodId) {
  const plan = planBuyGood(state, goodId);
  if (!plan.ok) return plan;
  const g = marketGoodOf(goodId);

  if (plan.currency === 'silver') {
    state.silver = Math.max(0, (Number(state.silver) || 0) - plan.price);
  } else {
    state.spiritStones = Math.max(0, (state.spiritStones || 0) - plan.price);
  }

  const e = g.effect || {};
  if (e.kind === 'pill') addPills(state, e.pill, e.n || 1);
  else if (e.kind === 'pool-blueprint') state.cultivation.poolBlueprint = true;
  else if (e.kind === 'clue') state.cultivation.clues = Math.max(0, Math.floor(Number(state.cultivation.clues) || 0) + (e.n || 1));
  else if (e.kind === 'silver') state.silver = Math.max(0, (state.silver || 0) + (e.n || 0));
  else if (e.kind === 'population') {
    state.population = Math.max(0, Math.round((Number(state.population) || 0) + (e.n || 0)));
  } else if (e.kind === 'manual') grantManualToFamily(state, e.manual);
  else if (e.kind === 'rune') grantRuneToShelf(state, e.rune, e.n || 1);

  pushLog(state, `在${marketOf(g.market).name}买入「${g.name}」（${plan.price} ${plan.currency === 'silver' ? '两' : '灵石'}）。`, 'trade');
  return { ok: true, ...plan };
}

/**
 * 反向兑换：**灵石 → 银两**（本块新开的边）。
 *
 * 买入视角：`q.silver` 银两 → `q.stones` 灵石。
 * 卖出按 0.8 折 ⇒ 换出去再换回来**严格亏 20%**，环闭不上。
 *
 * 【I2】门槛改读段 10「隐藏坊市」：灵石交易本来就该和「银两 → 灵石」同开
 * （后者一直是 `CULTIVATOR_MARKET.requiresSecrets` = 10，一个字没动）。
 */
function marketSellQuote(state, n = 1) {
  const q = marketExchangeQuote(state);
  const silverPerStone = q.silver / q.stones;
  const stones = Math.max(1, Math.floor(n));
  return { stones, silver: Math.floor(silverPerStone * MARKET_SELL_RATIO * stones) };
}

function planSellStones(state, n = 1) {
  const quote = marketSellQuote(state, n);
  const seg = marketSegmentOf('yunshen', 'hidden');
  if (seg && !segmentRevealed(state, seg)) {
    return { ok: false, reason: `江南坊市尚未开出灵石交易（${segmentNeedText(seg)}，现有 ${secretTotal(state)}）` };
  }
  if (!marketOpen(state, 'yunshen')) {
    return { ok: false, reason: `江南坊市尚未开放：${marketBlockReason(state, 'yunshen')}` };
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

/**
 * 界面用的一览：每座坊市 + 它的分段 + 它的商品 + 当前状态。
 *
 * 【I2】没到的段**也在这里返回**（`revealed: false`）—— 界面据此把它们灰着画出来
 * 并写明「需 N 条秘闻」，而不是整段藏掉。
 */
function marketOverview(state) {
  return MARKETS.map((m) => {
    const segs = marketSegmentsOf(m.id);
    const goods = marketGoodsOf(m.id);
    const view = (g) => {
      const seg = segmentOfGood(g);
      const revealed = !seg || segmentRevealed(state, seg);
      const unlocked = goodUnlocked(state, g.id);
      const buy = planBuyGood(state, g.id);
      return {
        id: g.id, name: g.name, desc: g.desc,
        segment: g.segment || null,
        segmentName: seg ? seg.name : '',
        revealed,
        needSecrets: seg ? (Number(seg.needSecrets) || 0) : 0,
        needText: seg ? segmentNeedText(seg) : '',
        currency: goodCurrency(g),
        price: Number(g.price) || 0,
        priceText: goodPriceText(g),
        unlockSecrets: goodUnlockCost(g),
        unlocked,
        canUnlock: planUnlockGood(state, g.id).ok,
        canBuy: buy.ok,
        buyReason: buy.ok ? '' : buy.reason,
      };
    };
    return {
      id: m.id,
      name: m.name,
      desc: m.desc,
      open: marketOpen(state, m.id),
      reason: marketBlockReason(state, m.id),
      segments: segs.map((s) => ({
        id: s.id,
        name: s.name,
        desc: s.desc,
        needSecrets: Number(s.needSecrets) || 0,
        needText: segmentNeedText(s),
        revealed: segmentRevealed(state, s),
        goods: goods.filter((g) => g.segment === s.id).map(view),
      })),
      goods: goods.map(view),
    };
  });
}
