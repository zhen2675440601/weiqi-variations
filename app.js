"use strict";

(() => {
  const byId = (id) => document.getElementById(id);
  const boardGrid = byId("board-grid");
  const timeline = byId("timeline");
  const explanation = byId("explanation");
  const variationList = byId("variation-list");
  const progressDialog = byId("progress-dialog");
  const guideDialog = byId("guide-dialog");
  let boardSpan = 0;
  const courses = lessons.map((lesson) => ({
    ...lesson,
    paths: [lesson.main, ...lesson.variations].map((path) => ({
      ...path,
      key: `yijiao:solved:${lesson.id}:${path.id}`,
      frames: Go.replay(path.moves),
      turns: Math.ceil((path.moves.length - path.drillAt) / 2),
    })),
  }));
  const explorer = GoExplorer.create(courses, explorationLines, pachiJoseki);
  const exploration = { moves: [], frames: [Go.emptyFrame()], step: 0, focus: "auto", boardFocus: "K10", error: null };
  let analysis;
  let aiAnalysis = null;
  let shownCandidates = [];
  const allPaths = courses.flatMap((course) => course.paths);
  const completed = new Set();
  const state = {
    courseIndex: 0,
    pathId: "main",
    mode: "explore",
    step: courses[0].main.preview,
    numbers: byId("move-numbers").checked,
    boardFocus: "F15",
    hint: null,
    mistake: null,
    feedback: null,
  };
  const boardPoints = new Map();
  let playback = null;

  function element(tag, className, text) {
    const result = document.createElement(tag);
    if (className) result.className = className;
    if (text != null) result.textContent = text;
    return result;
  }

  function button(className, text) {
    const result = element("button", className, text);
    result.type = "button";
    return result;
  }

  function markCurrent(node, active, value = "true") {
    if (active) node.setAttribute("aria-current", value);
    else node.removeAttribute("aria-current");
  }

  function currentCourse() {
    return courses[state.courseIndex];
  }

  function currentPath() {
    return currentCourse().paths.find((path) => path.id === state.pathId);
  }

  function colorName(color) {
    return color === "black" ? "黑" : "白";
  }

  function colorDot(color) {
    const dot = element("span", `color-dot ${color}`);
    dot.setAttribute("aria-hidden", "true");
    return dot;
  }

  function placeAt(node, x, y) {
    node.style.setProperty("--x", `${x * 100 / (boardSpan - 1)}%`);
    node.style.setProperty("--y", `${y * 100 / (boardSpan - 1)}%`);
    return node;
  }

  function buildBoard(span) {
    if (span === boardSpan) return;
    boardSpan = span;
    boardGrid.replaceChildren();
    boardGrid.style.setProperty("--cell-size", `${100 / (span - 1)}%`);
    boardPoints.clear();
    const full = span === Go.size;
    for (let i = 0; i < boardSpan; i += 1) {
      boardGrid.append(
        placeAt(element("span", "grid-line grid-horizontal"), 0, i),
        placeAt(element("span", "grid-line grid-vertical"), i, 0),
        placeAt(element("span", "coordinate col-label", Go.point(i, 0)[0]), i, 0),
        placeAt(element("span", "coordinate row-label", Go.point(0, i).slice(1)), 0, i),
      );
      if (full) {
        boardGrid.append(
          placeAt(element("span", "coordinate col-label bottom-label", Go.point(i, 0)[0]), i, 0),
          placeAt(element("span", "coordinate row-label right-label", Go.point(0, i).slice(1)), 0, i),
        );
      }
    }
    const stars = full ? [3, 9, 15] : [3, 9];
    for (const x of stars) {
      for (const y of stars) {
        boardGrid.append(placeAt(element("span", "star-point"), x, y));
      }
    }
    for (const helper of boardGrid.children) helper.setAttribute("aria-hidden", "true");

    for (let y = 0; y < boardSpan; y += 1) {
      for (let x = 0; x < boardSpan; x += 1) {
        const point = Go.point(x, y);
        const tile = placeAt(button("intersection"), x, y);
        const stone = element("span", "stone");
        stone.setAttribute("aria-hidden", "true");
        tile.dataset.point = point;
        tile.append(stone);
        boardGrid.append(tile);
        boardPoints.set(point, { tile, stone, x, y, index: Go.index(point) });
      }
    }
  }

  function buildLessons() {
    return courses.map((course, courseIndex) => {
      const control = button("lesson-button");
      const diagram = element("span", "mini-board");
      diagram.setAttribute("aria-hidden", "true");
      for (const [i, move] of course.main.moves.slice(0, 4).entries()) {
        const piece = element("span", `mini-stone ${Go.color(i + 1)}`);
        const index = Go.index(move.point);
        piece.style.left = `${7 + (index % Go.size) * 7}px`;
        piece.style.top = `${7 + Math.floor(index / Go.size) * 7}px`;
        diagram.append(piece);
      }
      const label = element("span");
      label.append(element("span", "lesson-name", course.title), element("span", "lesson-subtitle", course.subtitle));
      control.append(diagram, label);
      control.addEventListener("click", () => setView(courseIndex, "main", state.mode));
      byId("lesson-list").append(control);
      return control;
    });
  }

  function updateProgress() {
    byId("progress-count").textContent = `${completed.size} / ${allPaths.length}`;
    byId("progress-ring").style.setProperty("--progress", `${completed.size / allPaths.length * 100}%`);
    byId("progress-button").setAttribute("aria-label", `练习进度，已完成 ${completed.size} 道，共 ${allPaths.length} 道`);
  }

  function readProgress() {
    try {
      for (const path of allPaths) {
        if (localStorage.getItem(path.key) === "1") completed.add(path.key);
      }
    } catch {
      // Progress stays available for this session when browser storage is blocked.
    }
    updateProgress();
  }

  function recordProgress(path) {
    completed.add(path.key);
    try {
      localStorage.setItem(path.key, "1");
    } catch {
      // Keep the session progress when the browser declines to save it.
    }
    updateProgress();
  }

  function showProgress() {
    byId("progress-summary").textContent = `已完成 ${completed.size} 道，共 ${allPaths.length} 道。`;
    const groups = courses.map((course, courseIndex) => {
      const group = element("section", "progress-lesson");
      group.append(element("h3", "", course.title));
      for (const path of course.paths) {
        const control = button("progress-exercise");
        control.append(element("span", "", path.id === "main" ? "定式主线" : path.title));
        control.append(element("span", "", completed.has(path.key) ? "已完成" : "待练习"));
        control.addEventListener("click", () => {
          progressDialog.close();
          setView(courseIndex, path.id, "practice");
          byId("board-title").scrollIntoView({ block: "nearest" });
          boardPoints.get(state.boardFocus).tile.focus({ preventScroll: true });
        });
        group.append(control);
      }
      return group;
    });
    byId("progress-list").replaceChildren(...groups);
    progressDialog.showModal();
  }

  function drawPosition(frame, step, { target, canPlay, focus, mistakeAt, choices }) {
    const studying = state.mode === "study";
    for (const [point, { tile, stone, index }] of boardPoints) {
      const piece = frame.board[index];
      const candidate = target === point;
      const choice = !piece && choices?.get(point);
      const mistake = !piece && mistakeAt === point;
      const clickable = canPlay || (studying && candidate);
      tile.classList.toggle("occupied", Boolean(piece));
      tile.classList.toggle("last-stone", Boolean(piece && piece.moveNumber === step));
      tile.classList.toggle("candidate", candidate);
      tile.classList.toggle("hinted", candidate && !studying);
      tile.classList.toggle("mistake", mistake);
      tile.classList.toggle("explore-choice", Boolean(choice));
      if (choice) tile.dataset.kind = choice.kind;
      else tile.removeAttribute("data-kind");
      tile.setAttribute("aria-disabled", String(!clickable));
      tile.tabIndex = (studying ? candidate : canPlay && focus === point) ? 0 : -1;
      stone.className = piece ? `stone stone-${piece.color}` : "stone";
      stone.textContent = piece && state.numbers ? piece.moveNumber : mistake ? "×" : choice?.letter ?? "";
      let label = point;
      if (piece) label += `，第 ${piece.moveNumber} 手${colorName(piece.color)}棋`;
      if (candidate) label += studying ? "，下一手" : "，提示落点";
      if (choice) label += `，候选 ${choice.letter}，${choice.title}`;
      tile.setAttribute("aria-label", label);
    }
    byId("capture-count").textContent = `黑提 ${frame.black} 子 · 白提 ${frame.white} 子`;
  }

  function renderBoard(path) {
    const studying = state.mode === "study";
    const next = path.moves[state.step];
    drawPosition(path.frames[state.step], state.step, {
      target: studying || state.hint ? next?.point : null,
      canPlay: !studying && Boolean(next),
      focus: state.boardFocus,
      mistakeAt: state.mistake,
    });

    const status = byId("board-status");
    if (studying && state.step) {
      const color = Go.color(state.step);
      status.replaceChildren(colorDot(color), `第 ${state.step} / ${path.moves.length} 手 · ${colorName(color)} ${path.moves[state.step - 1].point}`);
    } else if (!studying && next) {
      const side = Go.color(state.step + 1);
      const prompt = `轮到你下${colorName(side)}棋`;
      status.replaceChildren(colorDot(side), state.feedback && !state.feedback.error ? `应手正确 · ${prompt}` : prompt);
    } else {
      status.textContent = studying ? "棋谱起点" : "这道题已完成";
    }
  }

  function note(title, text, className = "result-note") {
    const item = element("div", className);
    item.append(element("strong", "", title), element("p", "", text));
    return item;
  }

  function renderSource(reference) {
    const source = byId("source");
    source.hidden = !reference;
    if (!reference) return;
    const link = element("a", "", reference.title);
    link.href = reference.url;
    link.target = "_blank";
    link.rel = "noopener noreferrer";
    source.replaceChildren("棋谱参考", link);
  }

  function renderExploration() {
    analysis = explorer.analyze(exploration);
    shownCandidates = aiAnalysis?.candidates ?? analysis.candidates;
    const choices = new Map(shownCandidates.map((candidate, i) => [
      candidate.point, { ...candidate, letter: `${i >= 26 ? String.fromCharCode(64 + Math.floor(i / 26)) : ""}${String.fromCharCode(65 + i % 26)}` },
    ]));
    const { step, frames } = exploration;
    const player = Go.color(step + 1);
    byId("goban").classList.toggle("white-to-move", player === "white");
    drawPosition(frames[step], step, {
      canPlay: true,
      focus: exploration.boardFocus,
      mistakeAt: exploration.error?.point,
      choices: byId("show-candidates").checked ? choices : null,
    });
    const previous = exploration.moves[step - 1];
    const last = step ? `第 ${step} 手 · ${colorName(Go.color(step))}${previous.point ? ` ${previous.point}` : "棋虚手"}` : "空棋盘";
    byId("board-status").replaceChildren(colorDot(player), `${colorName(player)}棋走`, element("span", "explore-last-move", last));
    byId("undo-move").disabled = step === 0;
    byId("redo-move").disabled = step === exploration.moves.length;
    byId("clear-board").disabled = exploration.moves.length === 0;
    byId("ai-analyze").textContent = aiAnalysis?.pending ? "取消分析" : aiAnalysis?.candidates ? "回到候选" : "AI 分析";
    byId("variation-title").textContent = aiAnalysis?.candidates ? "KataGo 候选落点" : "候选落点";

    const meta = element("div", "move-meta");
    meta.append(analysis.region);
    if (analysis.phase) meta.append(element("span", "explore-phase", analysis.phase));
    explanation.replaceChildren(meta, element("h3", "move-title", analysis.title));
    if (analysis.action) explanation.append(element("p", "explore-action", analysis.action));
    explanation.append(element("p", "move-why", analysis.detail));
    if (analysis.tip) explanation.append(element("p", "hint-text", analysis.tip));
    if (previous?.reason && (!analysis.source || ["tactic", "shape", "territory", "ai"].includes(previous.reason.kind))) {
      explanation.append(note(previous.reason.title, previous.reason.why));
    }
    if (exploration.error) explanation.append(note("这手不能落下", exploration.error.message, "feedback error"));
    if (aiAnalysis?.message) {
      const status = note("KataGo 分析", aiAnalysis.message);
      if (aiAnalysis.help) {
        const link = element("a", "secondary", "本地 AI 使用说明");
        link.href = window.location.protocol === "https:"
          ? "https://github.com/zhen2675440601/weiqi-variations#可选的本地-ai-分析"
          : "README.md";
        link.target = "_blank";
        link.rel = "noopener noreferrer";
        status.append(link);
      }
      explanation.append(status);
    }

    byId("variation-count").textContent = choices.size ? `${choices.size} 处` : "";
    const controls = [];
    for (const { point, kind, letter, title, why } of choices.values()) {
      const control = button("variation-button candidate-button");
      control.dataset.candidate = point;
      control.dataset.kind = kind;
      const details = element("span");
      const name = element("span", "candidate-name");
      name.append(element("span", "candidate-coordinate", point), element("span", "variation-name", title));
      details.append(name, element("span", "candidate-type", GoExplorer.labels[kind]), element("span", "variation-detail", why));
      control.append(element("span", "variation-mark candidate-letter", letter), details);
      controls.push(control);
    }
    if (!controls.length) controls.push(element("p", "candidate-empty", "当前局部没有标出的应手，可以继续在棋盘上摆放。"));
    variationList.replaceChildren(...controls);
    renderSource(analysis.source);
  }

  function clearAiAnalysis() {
    aiAnalysis?.controller?.abort();
    aiAnalysis = null;
  }

  async function analyzeWithAi() {
    if (aiAnalysis?.pending || aiAnalysis?.candidates) {
      clearAiAnalysis();
      renderExploration();
      return;
    }
    if (window.location.protocol !== "http:" || !["127.0.0.1", "localhost"].includes(window.location.hostname)) {
      aiAnalysis = { message: "请按使用说明配置本地 KataGo，然后从项目目录运行 npm start。", help: true };
      renderExploration();
      return;
    }
    const job = { controller: new AbortController(), pending: true, message: `正在分析${analysis.region === "全盘" ? "全盘" : analysis.region + "的应手"}。` };
    aiAnalysis = job;
    const { step, frames } = exploration;
    const player = Go.color(step + 1);
    const moves = exploration.moves.slice(0, step).map(({ point }) => point);
    renderExploration();
    try {
      const response = await fetch("/api/analysis", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ moves, corner: analysis.corner }), signal: job.controller.signal,
      });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error ?? "本地分析服务暂不可用。");
      if (aiAnalysis !== job) return;
      const letter = player === "black" ? "B" : "W";
      if (result.player !== letter) throw new Error("引擎返回的行棋方与当前棋盘不一致。");
      const currentChoices = new Map(analysis.candidates.map((choice) => [choice.point, choice]));
      const candidates = [];
      for (const move of result.moves) {
        if (move.point === "pass" || !Number.isFinite(move.scoreLead)) continue;
        try { Go.play(frames[step].board, move.point, step + 1, frames[step - 1]?.board); } catch { continue; }
        const estimate = move.scoreLead;
        const leader = estimate >= 0 ? player : player === "black" ? "white" : "black";
        const score = `估计${colorName(leader)}棋领先 ${Math.abs(estimate).toFixed(1)} 目。`;
        const continuation = move.pv.slice(1, 5).map((point) => point === "pass" ? "虚手" : point);
        const reading = continuation.length ? `续着参考 ${continuation.join(" → ")}。` : "";
        const lesson = currentChoices.get(move.point);
        candidates.push({
          point: move.point, kind: "ai", title: lesson?.title ?? "AI 续着",
          why: `${score}${reading}${lesson?.why ?? ""}`,
        });
        if (candidates.length === 4) break;
      }
      const scope = analysis.corner ? `${analysis.region}选点，后续按全盘计算。` : "全盘选点。";
      const pass = result.moves[0]?.point === "pass" ? "引擎首选虚手。" : "";
      aiAnalysis = { candidates, message: `KataGo 搜索 ${result.visits} 次。${scope}${pass}` };
    } catch (error) {
      if (aiAnalysis !== job) return;
      aiAnalysis = { message: error instanceof SyntaxError || error instanceof TypeError ? "请确认项目目录中的 npm start 正在运行。" : error.message, help: true };
    }
    renderExploration();
  }

  function playExploration(point) {
    const { step, frames } = exploration;
    let next;
    try {
      next = Go.advance(frames[step], point, step + 1, frames[step - 1]?.board);
    } catch (error) {
      exploration.error = { point, message: error.message };
      renderExploration();
      return;
    }
    exploration.frames.splice(step + 1, Infinity, next);
    const reason = shownCandidates.find((candidate) => candidate.point === point);
    exploration.moves.splice(step, Infinity, { point, reason });
    if (point) exploration.boardFocus = point;
    setExplorationStep(step + 1);
  }

  function setExplorationStep(step) {
    clearAiAnalysis();
    exploration.step = step;
    exploration.error = null;
    renderExploration();
  }

  function renderStudy(course, path) {
    const current = path.moves[state.step - 1];
    if (current) {
      const color = Go.color(state.step);
      const meta = element("div", "move-meta");
      meta.append(colorDot(color), `${colorName(color)}棋`, element("span", "coordinate-text", current.point));
      meta.append(element("span", "move-number", `第 ${state.step} 手`));
      explanation.replaceChildren(meta, element("h3", "move-title", current.title), element("p", "move-why", current.why));
    } else {
      explanation.replaceChildren(element("h3", "move-title", path.title), element("p", "move-why", course.description));
    }
    explanation.append(note(path.id === "main" ? "局部得失" : "应对结果", path.result));
  }

  function renderPractice(path) {
    const next = path.moves[state.step];
    const activeAction = document.activeElement?.dataset.exerciseAction;
    const turnsPlayed = Math.ceil((state.step - path.drillAt) / 2);
    byId("practice-count").textContent = `已下 ${turnsPlayed} / ${path.turns} 手`;
    if (next) {
      const color = Go.color(state.step + 1);
      const meta = element("div", "move-meta");
      meta.append(colorDot(color), `你执${colorName(color)}`, element("span", "move-number", `第 ${turnsPlayed + 1} / ${path.turns} 手`));
      const prompt = turnsPlayed === 0 ? path.goal : "对手已在棋盘上应了一手。请按当前棋形继续落子。";
      explanation.replaceChildren(meta, element("h3", "move-title", "你会下在哪里？"), element("p", "move-why", prompt));
    } else {
      explanation.replaceChildren(element("h3", "move-title", "练习完成"), element("p", "move-why", path.result));
    }

    if (state.feedback) {
      const { title, text, error } = state.feedback;
      explanation.append(note(title, text, error ? "feedback error" : "feedback"));
    }
    if (next && state.hint === "answer") {
      explanation.append(note(`本谱应手 ${next.point} · ${next.title}`, next.why));
    } else if (next && state.hint === "hint") {
      explanation.append(element("p", "hint-text", `棋盘上已标出本谱的应手 ${next.point}。`));
    }

    if (next) {
      const actions = element("div", "exercise-actions");
      const hint = button("button", state.hint === "hint" ? "收起提示" : "显示提示");
      const answer = button("button", state.hint === "answer" ? "收起应手" : "查看这一手");
      hint.dataset.exerciseAction = "hint";
      hint.setAttribute("aria-pressed", String(state.hint === "hint"));
      answer.dataset.exerciseAction = "answer";
      answer.setAttribute("aria-pressed", String(state.hint === "answer"));
      actions.append(hint, answer);
      explanation.append(actions);
      if (activeAction) actions.querySelector(`[data-exercise-action="${activeAction}"]`)?.focus({ preventScroll: true });
    }
  }

  function renderVariations(course, path, studying) {
    const choices = studying ? course.paths.slice(1) : course.paths;
    byId("variation-title").textContent = studying ? "分支与变招" : "同局练习";
    byId("variation-count").textContent = studying ? `${choices.length} 种` : `${choices.length} 题`;
    variationList.replaceChildren(...choices.map((choice) => {
      const control = button("variation-button");
      const main = choice.id === "main";
      const label = element("span");
      const mark = element("span", main ? "variation-mark main-mark" : "variation-mark", main ? "定式" : choice.motif);
      const detail = studying ? choice.summary : completed.has(choice.key) ? "已完成 · 可重练" : `${choice.turns} 手 · 执${colorName(Go.color(choice.drillAt + 1))}`;
      label.append(element("span", "variation-name", main ? "定式主线" : choice.title), element("span", "variation-detail", detail));
      control.append(mark, label);
      control.dataset.path = choice.id;
      markCurrent(control, path.id === choice.id);
      return control;
    }));
  }

  function buildTimeline(path) {
    timeline.replaceChildren();
    for (let i = 0; i <= path.moves.length; i += 1) {
      const control = button("step-button", i);
      control.dataset.step = i;
      control.setAttribute("aria-label", i ? `第 ${i} 手 ${colorName(Go.color(i))} ${path.moves[i - 1].point}` : "棋谱起点");
      timeline.append(control);
    }
  }

  function renderControls(path) {
    byId("previous").disabled = state.step === 0;
    byId("reset").disabled = state.step === 0;
    byId("next").disabled = state.step === path.moves.length;
    byId("autoplay").textContent = playback === null ? "播放" : "暂停";
    byId("autoplay").setAttribute("aria-pressed", String(playback !== null));
    for (const [i, control] of Array.from(timeline.children).entries()) {
      markCurrent(control, i === state.step, "step");
    }
    const current = timeline.children[state.step];
    if (current) {
      const listBounds = timeline.getBoundingClientRect();
      const bounds = current.getBoundingClientRect();
      if (bounds.right > listBounds.right) timeline.scrollLeft += bounds.right - listBounds.right + 16;
      if (bounds.left < listBounds.left) timeline.scrollLeft -= listBounds.left - bounds.left + 16;
    }
  }

  function renderStep() {
    const path = currentPath();
    renderBoard(path);
    if (state.mode === "study") {
      renderStudy(currentCourse(), path);
      renderControls(path);
    } else {
      renderPractice(path);
    }
  }

  function renderView() {
    const exploring = state.mode === "explore";
    const studying = state.mode === "study";
    buildBoard(exploring ? Go.size : 11);
    byId("workspace").classList.toggle("explorer-workspace", exploring);
    byId("lesson-sidebar").hidden = exploring;
    markCurrent(byId("explore-nav"), exploring, "page");
    markCurrent(byId("study-nav"), studying, "page");
    markCurrent(byId("practice-nav"), state.mode === "practice", "page");
    byId("explore-controls").hidden = !exploring;
    byId("study-controls").hidden = !studying;
    byId("practice-controls").hidden = state.mode !== "practice";
    byId("focus-corner").hidden = !exploring;
    byId("main-action").hidden = exploring;
    byId("ai-analyze").hidden = !exploring;
    byId("lesson-category").hidden = exploring;
    byId("candidate-option").hidden = !exploring;
    byId("board-title").textContent = exploring ? "十九路棋盘" : "局部棋盘";
    byId("board-subtitle").hidden = exploring;
    const goban = byId("goban");
    goban.classList.toggle("full-board", exploring);
    goban.classList.toggle("practice-board", state.mode === "practice");
    goban.setAttribute("aria-label", exploring ? "完整的十九路围棋棋盘" : "十九路围棋棋盘的左上角局部");
    if (exploring) {
      byId("lesson-title").textContent = "自由探索";
      byId("lesson-description").textContent = `自由落子查看定式与变招。已收录 ${explorer.referencePositions.toLocaleString("zh-CN")} 个参考棋形。`;
      byId("explanation-title").textContent = "棋形识别";
      byId("variation-title").textContent = "候选落点";
      byId("back-to-main").hidden = true;
      renderExploration();
      return;
    }

    const course = currentCourse();
    const path = currentPath();
    const main = path.id === "main";
    lessonButtons.forEach((control, i) => markCurrent(control, i === state.courseIndex));
    byId("lesson-category").textContent = studying ? course.category : "落子练习";
    byId("lesson-title").textContent = course.title;
    byId("lesson-description").textContent = main ? course.description : path.title;
    byId("context-title").textContent = studying ? "全局怎么选" : "练习方式";
    byId("lesson-context").textContent = studying ? course.context : "轮到你时在棋盘上落子，对手会按题谱应对。卡住时可以查看提示。";
    byId("main-action").textContent = studying ? (main ? "练习定式" : "练习应对") : "查看棋谱";
    byId("explanation-title").textContent = studying
      ? (main ? "定式讲解" : path.deviation ? "变招讲解" : "分支讲解")
      : "落子任务";
    byId("back-to-main").hidden = !studying || main;
    if (studying) buildTimeline(path);
    renderVariations(course, path, studying);
    renderSource(studying ? course.source : null);
    renderStep();
  }

  function stopPlayback() {
    if (playback !== null) window.clearInterval(playback);
    playback = null;
  }

  function setView(courseIndex, pathId, mode, step) {
    stopPlayback();
    clearAiAnalysis();
    state.courseIndex = courseIndex;
    state.pathId = pathId;
    state.mode = mode;
    const path = currentPath();
    state.step = step ?? (mode === "study" ? path.preview ?? path.drillAt : path.drillAt);
    state.boardFocus = "F15";
    state.feedback = null;
    state.hint = null;
    state.mistake = null;
    renderView();
  }

  function setStep(step, automatic = false) {
    const lastStep = currentPath().moves.length;
    state.step = Math.max(0, Math.min(step, lastStep));
    if (!automatic || state.step === lastStep) stopPlayback();
    renderStep();
  }

  function togglePlayback() {
    if (playback !== null) {
      stopPlayback();
    } else {
      if (state.step === currentPath().moves.length) state.step = 0;
      playback = window.setInterval(() => setStep(state.step + 1, true), 1100);
    }
    renderStep();
  }

  function tryMove(point) {
    const path = currentPath();
    const nextMove = path.moves[state.step];
    if (!nextMove) return;

    if (point !== nextMove.point) {
      let message = "这手可以落下。请结合落子任务，找出符合本谱目标的应手。";
      try {
        Go.play(path.frames[state.step].board, point, state.step + 1, path.frames[state.step - 1]?.board);
      } catch (error) {
        message = error.message;
      }
      state.feedback = { title: "再找一手", text: message, error: true };
      state.mistake = point;
    } else {
      const reply = path.moves[state.step + 1];
      state.step += reply ? 2 : 1;
      state.feedback = { title: `走对了 · ${nextMove.title}`, text: nextMove.why };
      state.mistake = null;
      state.hint = null;
      if (state.step === path.moves.length) {
        recordProgress(path);
        renderVariations(currentCourse(), path, false);
      }
    }
    renderStep();
    if (state.step === path.moves.length) byId("retry").focus({ preventScroll: true });
  }

  const lessonButtons = buildLessons();
  for (const { id, label } of GoExplorer.corners) byId("focus-corner").append(new Option(label, id));
  byId("lesson-note").open = window.matchMedia("(min-width: 981px)").matches;
  byId("lesson-count").textContent = `${courses.length} 个棋形`;
  readProgress();
  renderView();

  function openExploration() {
    if (state.mode === "explore") return;
    stopPlayback();
    state.mode = "explore";
    renderView();
  }

  byId("home").addEventListener("click", openExploration);
  byId("explore-nav").addEventListener("click", openExploration);
  byId("open-guide").addEventListener("click", () => {
    byId("guide-explore").textContent = exploration.moves.length ? "回到我的棋盘" : "在棋盘试摆";
    guideDialog.showModal();
  });
  byId("guide-explore").addEventListener("click", () => {
    guideDialog.close();
    openExploration();
    if (!exploration.moves.length) {
      playExploration("Q16");
      playExploration("R17");
    }
    boardPoints.get(exploration.boardFocus).tile.focus();
  });
  byId("guide-study").addEventListener("click", () => {
    guideDialog.close();
    setView(0, "main", "study", 0);
    byId("next").focus();
  });
  byId("ai-analyze").addEventListener("click", analyzeWithAi);
  byId("study-nav").addEventListener("click", () => {
    if (state.mode !== "study") setView(state.courseIndex, state.pathId, "study", state.step);
  });
  byId("practice-nav").addEventListener("click", () => {
    if (state.mode !== "practice") setView(state.courseIndex, state.pathId, "practice");
  });
  byId("main-action").addEventListener("click", () => {
    if (state.mode === "study") setView(state.courseIndex, state.pathId, "practice");
    else setView(state.courseIndex, state.pathId, "study", state.step);
  });
  byId("back-to-main").addEventListener("click", () => {
    setView(state.courseIndex, "main", "study");
    byId("main-action").focus({ preventScroll: true });
  });
  byId("move-numbers").addEventListener("change", (event) => {
    state.numbers = event.target.checked;
    if (state.mode === "explore") renderExploration();
    else renderBoard(currentPath());
  });
  byId("show-candidates").addEventListener("change", renderExploration);
  byId("focus-corner").addEventListener("change", (event) => {
    clearAiAnalysis();
    exploration.focus = event.target.value;
    renderExploration();
  });
  byId("clear-board").addEventListener("click", () => {
    exploration.moves.length = 0;
    exploration.frames.length = 1;
    exploration.boardFocus = "K10";
    setExplorationStep(0);
  });
  byId("undo-move").addEventListener("click", () => setExplorationStep(exploration.step - 1));
  byId("redo-move").addEventListener("click", () => setExplorationStep(exploration.step + 1));
  byId("pass-move").addEventListener("click", () => playExploration(null));
  byId("reset").addEventListener("click", () => setStep(0));
  byId("previous").addEventListener("click", () => setStep(state.step - 1));
  byId("next").addEventListener("click", () => setStep(state.step + 1));
  byId("autoplay").addEventListener("click", togglePlayback);
  byId("retry").addEventListener("click", () => setView(state.courseIndex, state.pathId, "practice"));
  byId("progress-button").addEventListener("click", showProgress);

  timeline.addEventListener("click", (event) => {
    const step = event.target.closest("[data-step]");
    if (step) setStep(Number(step.dataset.step));
  });

  variationList.addEventListener("click", (event) => {
    if (state.mode === "explore") {
      const candidate = event.target.closest("[data-candidate]");
      if (!candidate) return;
      const point = candidate.dataset.candidate;
      playExploration(point);
      boardPoints.get(point).tile.focus({ preventScroll: true });
      return;
    }
    const choice = event.target.closest("[data-path]");
    if (!choice || choice.dataset.path === state.pathId) return;
    setView(state.courseIndex, choice.dataset.path, state.mode);
    variationList.querySelector("[aria-current]")?.focus({ preventScroll: true });
  });

  explanation.addEventListener("click", (event) => {
    const action = event.target.closest("[data-exercise-action]")?.dataset.exerciseAction;
    if (action !== "hint" && action !== "answer") return;
    state.hint = state.hint === action ? null : action;
    renderStep();
  });

  boardGrid.addEventListener("click", (event) => {
    const tile = event.target.closest("[data-point]");
    if (!tile || tile.getAttribute("aria-disabled") === "true") return;
    if (state.mode === "explore") {
      playExploration(tile.dataset.point);
    } else if (state.mode === "practice") {
      state.boardFocus = tile.dataset.point;
      tryMove(state.boardFocus);
    } else {
      setStep(state.step + 1);
      if (event.detail === 0) {
        const next = currentPath().moves[state.step];
        if (next) boardPoints.get(next.point).tile.focus({ preventScroll: true });
        else byId("previous").focus({ preventScroll: true });
      }
    }
  });

  const directions = { ArrowLeft: [-1, 0], ArrowRight: [1, 0], ArrowUp: [0, -1], ArrowDown: [0, 1] };
  boardGrid.addEventListener("keydown", (event) => {
    const direction = directions[event.key];
    const point = boardPoints.get(event.target.dataset.point);
    if (state.mode === "study" || !direction || !point || event.target.getAttribute("aria-disabled") === "true") return;
    event.preventDefault();
    const x = Math.max(0, Math.min(boardSpan - 1, point.x + direction[0]));
    const y = Math.max(0, Math.min(boardSpan - 1, point.y + direction[1]));
    const active = state.mode === "explore" ? exploration : state;
    boardPoints.get(active.boardFocus).tile.tabIndex = -1;
    active.boardFocus = Go.point(x, y);
    const target = boardPoints.get(active.boardFocus).tile;
    target.tabIndex = 0;
    target.focus({ preventScroll: true });
  });

  document.addEventListener("keydown", (event) => {
    if (state.mode !== "study" || progressDialog.open || guideDialog.open || event.altKey || event.ctrlKey || event.metaKey || event.target.closest("a, input")) return;
    if (event.key !== "ArrowLeft" && event.key !== "ArrowRight") return;
    event.preventDefault();
    setStep(state.step + (event.key === "ArrowLeft" ? -1 : 1));
  });

  window.addEventListener("storage", (event) => {
    if (event.key?.startsWith("yijiao:solved:")) readProgress();
  });
})();
