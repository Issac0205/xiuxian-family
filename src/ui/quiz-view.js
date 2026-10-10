/** 答对/答错后，反馈停留多久（毫秒）。答错停久一点，好让人看清正确答案。 */
const FEEDBACK_MS = { right: 420, wrong: 1400 };

/**
 * 答题弹窗。
 *
 * 只负责「出题 → 收答案 → 显示对错」，不改任何游戏状态：
 * 结算交给调用方传进来的 onAnswer 回调。这样它保持纯展示层。
 */
function createQuizView({ getState, onRender, rng = Math.random }) {
  const $ = (id) => document.getElementById(id);

  const quiz = {
    phase: 'idle',   // idle | answering | feedback
    question: null,
    plan: null,
    picked: -1,
    onAnswer: null,
    timer: null,
  };

  function paint() {
    const host = $('quiz-host');
    const open = quiz.phase !== 'idle';
    host.classList.toggle('is-open', open);
    if (!open) return;

    const state = getState();
    const plan = quiz.plan;
    const question = quiz.question;

    $('quiz-op').textContent = plan?.label || '—';

    const hell = state.settings.difficulty === 'hell';
    const dchip = $('quiz-diff');
    dchip.textContent = hell ? '地狱' : '普通';
    dchip.className = `quiz-diff is-${hell ? 'hell' : 'normal'}`;

    $('quiz-word').textContent = question.word;
    $('quiz-word').classList.toggle('is-custom',Boolean(question.customBankId));
    $('quiz-phonetic').textContent = question.phonetic ? (question.customBankId ? `资料出处：${question.phonetic}` : question.phonetic) : '';
    $('quiz-phonetic').classList.toggle('is-source',Boolean(question.customBankId));
    $('quiz-ask').textContent = question.customBankId ? `当前题库：${currentBankLabel()} · 请选择正确答案` : '选出正确的中文释义';

    const optHost = $('quiz-options');
    optHost.innerHTML = '';
    question.options.forEach((text, i) => {
      const btn = document.createElement('button');
      btn.className = 'quiz-option';
      btn.dataset.action = 'quiz-answer';
      btn.dataset.index = String(i);
      const key=document.createElement('span');key.className='opt-key';key.textContent='ABCD'[i] || '·';
      const value=document.createElement('span');value.className='opt-text';value.textContent=text;
      btn.append(key,value);
      optHost.appendChild(btn);
    });

    const verdict = $('quiz-verdict');
    const cost = $('quiz-cost');
    const costText = plan?.currency === 'stones'
      ? `${fmtStones(plan?.cost || 0)} 枚灵石`
      : `${fmt(plan?.cost || 0)} 两银`;

    const explanation=$('quiz-explanation');
    $('quiz-continue').hidden = !(quiz.phase==='feedback' && question.customBankId);
    explanation.classList.toggle('is-visible', quiz.phase==='feedback' && Boolean(question.customBankId));
    explanation.textContent = quiz.phase==='feedback' && question.customBankId
      ? `正确答案：${'ABCD'[question.correctIndex]} · ${question.answer}` +
        (question.explanation ? `\n解析：${question.explanation}` : '') +
        (question.source ? `\n出处：${question.source}` : '') : '';

    if (quiz.phase === 'feedback') {
      const right = quiz.picked === question.correctIndex;
      for (const btn of optHost.querySelectorAll('.quiz-option')) {
        btn.disabled = true;
        const i = Number(btn.dataset.index);
        if (i === question.correctIndex) btn.classList.add('is-correct');
        else if (i === quiz.picked) btn.classList.add('is-wrong');
      }
      if (right) {
        verdict.textContent = '答对 · 操作已生效';
        cost.textContent = `耗费 ${costText}`;
      } else {
        verdict.textContent = hell ? '答错 · 操作失败，材料不退还' : '答错 · 操作失败，材料已返还';
        cost.textContent = hell
          ? `损失 ${costText}`
          : `未扣除材料`;
      }
      verdict.className = `quiz-verdict is-${right ? 'right' : 'wrong'}`;
    } else {
      verdict.textContent = '';
      verdict.className = 'quiz-verdict';
      cost.textContent = `答对才生效 · 耗费 ${costText}`;
    }
  }

  /**
   * 出题。已有题目未作答时返回 false（防止连点换题）。
   * @param {object} plan engine 给出的操作计划
   * @param {(correct: boolean, question: object, pickedIndex: number) => void} onAnswer
   */
  function ask(plan, onAnswer) {
    if (quiz.phase !== 'idle') return false;

    quiz.question = makeActiveQuestion(getState(), rng);
    quiz.plan = plan;
    quiz.onAnswer = onAnswer;
    quiz.picked = -1;
    quiz.phase = 'answering';
    paint();
    $('quiz-options').querySelector('button.quiz-option')?.focus({ preventScroll:true });
    return true;
  }

  /** 作答。 */
  function answer(index) {
    if (quiz.phase !== 'answering') return;

    const question = quiz.question;
    const correct = index === question.correctIndex;

    quiz.picked = index;
    quiz.phase = 'feedback';

    // 先把状态结算掉，界面上的银两／人口立刻变成结果，再慢慢收反馈
    const cb = quiz.onAnswer;
    quiz.onAnswer = null;
    if (cb) cb(correct, question, quiz.picked);

    paint();

    quiz.timer = setTimeout(finishFeedback,
      question.customBankId ? (correct ? 12000 : 18000) : (correct ? FEEDBACK_MS.right : FEEDBACK_MS.wrong));
  }

  function finishFeedback() {
    if (quiz.phase !== 'feedback') return;
    if (quiz.timer !== null) clearTimeout(quiz.timer);
    quiz.timer = null;
    quiz.phase = 'idle';
    quiz.question = null;
    quiz.plan = null;
    quiz.picked = -1;
    paint();
    onRender?.();
  }

  /** 是否有题在等答案（含反馈停留期）。 */
  function isBusy() {
    return quiz.phase !== 'idle';
  }

  /** 给测试与调试看的快照。 */
  function snapshot() {
    return {
      phase: quiz.phase,
      plan: quiz.plan,
      picked: quiz.picked,
      question: quiz.question && {
        wordId: quiz.question.wordId,
        word: quiz.question.word,
        answer: quiz.question.answer,
        options: quiz.question.options.slice(),
        correctIndex: quiz.question.correctIndex,
      },
    };
  }

  /** 强制清空（重开游戏时用）。 */
  function reset() {
    if (quiz.timer !== null) clearTimeout(quiz.timer);
    quiz.timer = null;
    quiz.phase = 'idle';
    quiz.question = null;
    quiz.plan = null;
    quiz.picked = -1;
    quiz.onAnswer = null;
    paint();
  }

  return { ask, answer, finishFeedback, paint, isBusy, snapshot, reset };
}
