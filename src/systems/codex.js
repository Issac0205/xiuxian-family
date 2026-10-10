
/* ────────────────────────────────────────────────────────────────
 * 区块：百科规则
 * 职责：把 data/codex.js 的条目定义按「玩家见过没有」筛一遍，
 *       算出可见/总数，并支持搜索。
 * 依赖：data/codex.js（条目定义）、以及条目 lines() 里引用的各张表
 * 调参：条目内容在 data/codex.js，本文件只管筛选与统计。
 * 文档：docs/70-百科.md
 * ──────────────────────────────────────────────────────────────── */

/**
 * 取一条条目的可见性。
 * 谓词本身出错时按「不可见」处理 —— 百科是只读的附属面板，
 * 不能因为某一条的数据源有问题就把整个页面搞崩。
 */
function codexEntrySeen(entry, state) {
  try {
    return Boolean(entry.seen ? entry.seen(state) : true);
  } catch (_e) {
    return false;
  }
}

/**
 * 取一条条目的数据引文。
 * 同样做兜底：引文生成失败不影响正文可读性。
 */
function codexEntryLines(entry, state) {
  try {
    const out = entry.lines ? entry.lines(state) : [];
    return (Array.isArray(out) ? out : [out]).filter((x) => x !== undefined && x !== null && x !== '');
  } catch (e) {
    return [`（数据引文暂不可用：${e.message}）`];
  }
}

/**
 * 整本书。返回每一章的 { ...定义, entries:[{...entry, seen, lines}] }。
 * 未解锁的条目仍然返回（界面要显示成「？？？」占位），但带上 seen 标志。
 */
function codexBook(state) {
  return CODEX_CHAPTERS.map((ch) => {
    const entries = ch.entries.map((e) => ({
      id: e.id, title: e.title, prose: e.prose, hint: e.hint || '', tags: e.tags || '',
      seen: codexEntrySeen(e, state),
      lines: codexEntrySeen(e, state) ? codexEntryLines(e, state) : [],
    }));
    return {
      id: ch.id, name: ch.name, icon: ch.icon, intro: ch.intro,
      entries,
      seenCount: entries.filter((e) => e.seen).length,
      total: entries.length,
    };
  });
}

/** 全局进度。 */
function codexStats(state) {
  const book = codexBook(state);
  let seen = 0;
  let total = 0;
  for (const ch of book) { seen += ch.seenCount; total += ch.total; }
  return { seen, total, chapters: book.length, percent: total ? seen / total : 0 };
}

/**
 * 搜索。
 *
 * 搜的是**标题 + 正文 + 数据引文 + 标签**四处的并集，
 * 所以玩家记得「死亡率」三个字也能找到演武台 —— 这正是目标里
 * 「演武场是对外征伐扩张，因此会死人」那条需求的实现方式。
 * 只搜已解锁的条目（不然会剧透）。
 */
function codexSearch(state, query, chapterId) {
  const q = String(query || '').trim().toLowerCase();
  const book = codexBook(state);
  const chapters = chapterId && chapterId !== 'all'
    ? book.filter((c) => c.id === chapterId)
    : book;
  const out = [];
  for (const ch of chapters) {
    for (const e of ch.entries) {
      if (!e.seen) continue;
      const hay = [e.title, e.prose, e.tags, ...e.lines].join(' ').toLowerCase();
      if (q && !hay.includes(q)) continue;
      out.push({ ...e, chapterId: ch.id, chapterName: ch.name, chapterIcon: ch.icon });
    }
  }
  return out;
}

/**
 * 「下一步看什么」——挑一条最近解锁的、玩家大概还没读的条目。
 * 界面上用来在 chip 里提示新内容。
 */
function codexLatestSeen(state) {
  const book = codexBook(state);
  for (let i = book.length - 1; i >= 0; i -= 1) {
    const hit = [...book[i].entries].reverse().find((e) => e.seen);
    if (hit) return { ...hit, chapterName: book[i].name };
  }
  return null;
}
