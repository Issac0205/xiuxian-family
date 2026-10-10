/**
 * 出题与学习统计。
 *
 * 设计要点：
 *  - 干扰项优先取**同词性**的词，否则玩家能靠词性把答案猜出来。
 *  - 选题带权重：错过的词权重最高，没见过的次之，已掌握的最低，
 *    所以错题会反复出现，而新词也不会被淹没。
 *  - 随机源可注入，测试里能复现出一模一样的题。
 */

/** mulberry32：短小的可播种随机数发生器。 */
function createRng(seed = Date.now() >>> 0) {
  let a = seed >>> 0;
  return function rng() {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** 每题的选项数。 */
const OPTION_COUNT = 4;

/**
 * 这一次操作要不要出题？
 *
 * 学习模式必出、免答模式不出、轻松模式掷一次骰子。
 * 随机源可注入，测试里能确定性地走任意分支。
 *
 * @param {object} state
 * @param {() => number} rng
 */
function shouldAsk(state, rng = Math.random) {
  const mode = QUIZ_MODE_MAP[state?.settings?.quizMode] || QUIZ_MODE_MAP.always;
  if (mode.chance >= 1) return true;
  if (mode.chance <= 0) return false;
  return rng() < mode.chance;
}

/** 错题本最多记多少个词。 */
const WRONG_BOOK_LIMIT = 200;

/** 按词性预先分桶，避免每题都遍历全表。 */
const BY_POS = new Map();
for (const w of WORD_LIST) {
  if (!BY_POS.has(w.pos)) BY_POS.set(w.pos, []);
  BY_POS.get(w.pos).push(w);
}

/**
 * 一个词的抽题权重。
 * 没见过 → 3；错过 → 1 + 3×错次；见过且没错过 → 1。
 */
function wordWeight(stat) {
  if (!stat) return 3;
  const wrong = stat.wrong || 0;
  return 1 + wrong * 3 + ((stat.seen || 0) === 0 ? 2 : 0);
}

function weightedPick(list, weightOf, rng) {
  let total = 0;
  for (const item of list) total += weightOf(item);
  if (total <= 0) return list[Math.floor(rng() * list.length)];

  let r = rng() * total;
  for (const item of list) {
    r -= weightOf(item);
    if (r <= 0) return item;
  }
  return list[list.length - 1];
}

function shuffle(arr, rng) {
  const out = arr.slice();
  for (let i = out.length - 1; i > 0; i -= 1) {
    const j = Math.floor(rng() * (i + 1));
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
}

/** 抽 count 个与 target 释义不同的干扰项，优先同词性。 */
function pickDistractors(target, rng, count) {
  const picked = [];
  const used = new Set([target.meaning]);

  const draw = (pool, want) => {
    if (!pool || !pool.length) return;
    let guard = 0;
    while (picked.length < want && guard < 400) {
      guard += 1;
      const w = pool[Math.floor(rng() * pool.length)];
      if (!w || w.id === target.id || used.has(w.meaning)) continue;
      used.add(w.meaning);
      picked.push(w);
    }
  };

  draw(BY_POS.get(target.pos), count);
  if (picked.length < count) {
    // 同词性不够（比如 prep. 只有两个词）时，用全表兜底
    draw(WORD_LIST, count);
  }
  return picked;
}

/**
 * 生成一道选择题。
 * @param {object} state 游戏状态（读 wordStats 决定权重）
 * @param {() => number} rng
 */
function makeQuestion(state, rng = Math.random) {
  const stats = state.wordStats || {};
  const target = weightedPick(WORD_LIST, (w) => wordWeight(stats[w.id]), rng);
  const distractors = pickDistractors(target, rng, OPTION_COUNT - 1);
  const options = shuffle([target, ...distractors], rng);

  return {
    wordId: target.id,
    word: target.word,
    phonetic: target.phonetic,
    pos: target.pos,
    answer: target.meaning,
    options: options.map((o) => o.meaning),
    correctIndex: options.findIndex((o) => o.id === target.id),
  };
}

/**
 * 记录一次作答，并回写学习统计。会就地修改 state。
 * @returns {boolean} 是否答对
 */
function recordAnswer(state, question, pickedIndex) {
  if (question.customBankId) return recordCustomAnswer(state, question, pickedIndex);
  const correct = pickedIndex === question.correctIndex;

  const stats = state.wordStats || (state.wordStats = {});
  const s = stats[question.wordId] || (stats[question.wordId] = { seen: 0, right: 0, wrong: 0 });
  s.seen += 1;

  const quiz = state.quiz;
  quiz.total += 1;

  if (correct) {
    s.right += 1;
    quiz.right += 1;
    quiz.streak += 1;
    if (quiz.streak > quiz.bestStreak) quiz.bestStreak = quiz.streak;
  } else {
    s.wrong += 1;
    quiz.wrong += 1;
    quiz.streak = 0;
    quiz.wrongBook = [question.wordId, ...quiz.wrongBook.filter((id) => id !== question.wordId)]
      .slice(0, WRONG_BOOK_LIMIT);
  }

  return correct;
}

/** 正确率（没答过题时返回 null）。 */
function accuracy(state) {
  const q = state.quiz;
  if (!q || !q.total) return null;
  return q.right / q.total;
}

/** 当前选中题库的错题。 */
function wrongBookWords(state) {
  const bank=activeQuestionBank();
  if (bank) {
    const byId=new Map(bank.questions.map(q=>[q.id,q]));
    const stats=state.customQuizStats?.[bank.id] || {};
    return activeWrongIds(state).map(id=>{
      const q=byId.get(id);
      return q ? { id,word:q.question,phonetic:q.source,meaning:q.options[q.answer],
        seen:stats[id]?.seen || 0,right:stats[id]?.right || 0,wrong:stats[id]?.wrong || 0 } : null;
    }).filter(Boolean);
  }
  const stats=state.wordStats || {};
  return (state.quiz?.wrongBook || []).map(id=>{
    const w=WORD_LIST[id];if(!w)return null;
    const t=stats[id] || {seen:0,right:0,wrong:0};
    return {...w,seen:t.seen,wrong:t.wrong,right:t.right};
  }).filter(Boolean);
}
/**
 * 错题本里某一道题的**完整**内容。
 *
 * 错题本列表只用一行显示「单词 + 释义」，题干一长就看不全，
 * 更看不到当初选错的那几个干扰项和正确答案 —— 所以点开时要给完整的一份。
 *
 * 两类题库能给的深度不同：
 *   自定义题库 —— 题干、四个选项、正确答案、解析，全都有
 *   内置六级词表 —— 只有「单词 / 音标 / 词性 / 释义」。
 *     它的选项是**每次出题现随机生成的**（见 makeQuestion），
 *     所以「当初那四个选项」并没有被保存下来，不可能还原。
 *     这里如实只给单词卡，解析由音标与词性拼出来。
 */
function wrongBookDetail(state, id) {
  const bank = activeQuestionBank();
  if (bank) {
    const q = bank.questions.find((x) => x.id === id);
    if (!q) return null;
    const t = (state.customQuizStats?.[bank.id] || {})[id] || { seen: 0, right: 0, wrong: 0 };
    const opts = Array.isArray(q.options) ? q.options : [];
    return {
      kind: 'custom', id,
      title: q.question || '',
      source: q.source || '',
      options: opts.map((text, i) => ({ text, correct: i === q.answer })),
      answerText: opts[q.answer] || '',
      explanation: q.explanation || '',
      stats: { seen: t.seen || 0, right: t.right || 0, wrong: t.wrong || 0 },
    };
  }
  const w = WORD_LIST[id];
  if (!w) return null;
  const t = (state.wordStats || {})[id] || { seen: 0, right: 0, wrong: 0 };
  return {
    kind: 'builtin', id,
    title: w.word || '',
    phonetic: w.phonetic || '',
    pos: w.pos || '',
    meaning: w.meaning || '',
    options: [],
    answerText: w.meaning || '',
    explanation: `${w.pos ? `词性 ${w.pos}　` : ''}${w.phonetic ? `${w.phonetic}　` : ''}释义：${w.meaning || ''}`,
    stats: { seen: t.seen || 0, right: t.right || 0, wrong: t.wrong || 0 },
  };
}

/** 当前题库学习概览（答题总账仍跨题库累计）。 */
function studySummary(state) {
  const bank=activeQuestionBank();
  const stats=activeStats(state);
  let seenWords=0,mastered=0,weak=0,total=0,right=0;
  for (const stat of Object.values(stats)) {
    if (!stat || !stat.seen) continue;
    seenWords+=1;total+=stat.seen;right+=stat.right||0;
    if (stat.wrong===0) mastered+=1;
    else if (stat.wrong>=stat.right) weak+=1;
  }
  return {
    seenWords,mastered,weak,totalWords:bank ? bank.questions.length:WORD_LIST.length,
    accuracy:total ? right/total:null,answered:total,right,
    streak:state.quiz?.streak || 0,bestStreak:state.quiz?.bestStreak || 0,
    wrongCount:activeWrongIds(state).length,lost:state.quiz?.lost || 0,
  };
}
