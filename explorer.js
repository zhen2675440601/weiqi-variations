"use strict";

const GoExplorer = (() => {
  const edge = Go.size - 1;
  const middle = edge / 2;
  const axes = [[1, 0], [0, 1]];
  const directions = [...axes, [-1, 0], [0, -1]];
  const cornerSpan = 10;
  const coreSpan = 7;
  const area = Array.from({ length: cornerSpan ** 2 }, (_, i) => Math.floor(i / cornerSpan) * Go.size + i % cornerSpan);
  const coreIndices = [...area.keys()].filter((i) => i % cornerSpan < coreSpan && Math.floor(i / cornerSpan) < coreSpan);
  const corners = [
    { id: "nw", label: "左上角" }, { id: "ne", label: "右上角", right: true },
    { id: "sw", label: "左下角", bottom: true }, { id: "se", label: "右下角", right: true, bottom: true },
  ].map((corner) => {
    const views = [false, true].map((transpose) => {
      function transform(at) {
        let x = at % Go.size;
        let y = Math.floor(at / Go.size);
        if (transpose) [x, y] = [y, x];
        if (corner.right) x = edge - x;
        if (corner.bottom) y = edge - y;
        return y * Go.size + x;
      }
      return { indices: area.map(transform), point: (point) => Go.pointAt(transform(Go.index(point))) };
    });
    const core = coreIndices.map((i) => views[0].indices[i]);
    return { ...corner, views, core, scope: new Set(views[0].indices) };
  });

  const labels = { opening: "占角", joseki: "定式", branch: "分支", deviation: "变招示例", counter: "反击", reply: "续着", book: "谱库续着", tactic: "战术", shape: "棋形建议", territory: "围地参考", ai: "KataGo" };
  const rank = { joseki: 1, counter: 2, branch: 3, reply: 4, book: 4, deviation: 5 };
  const openings = [
    { point: "D16", title: "星位", why: "四线占角，两边都有发展空间。对手可以点三三，也可以小飞挂角。" },
    { point: "C16", title: "小目", why: "偏向经营一侧的角地，可以接着看小飞挂或一间高挂。" },
    { point: "D17", title: "小目 · 另一方向", why: "同样是小目，着重经营的方向转向另一条边。" },
    { point: "C17", title: "三三", why: "直接占据角内，接下来可以看对手从星位斜挂时的应法。" },
    { point: "E16", title: "高目", why: "在五四路占角，着重向外发展。可以从棋谱比较对方挂角后的应对。" },
  ];

  function colorName(color) {
    return color === "black" ? "黑" : "白";
  }

  function actualColor(color, owner) {
    if (color === "black") return owner;
    return owner === "black" ? "white" : "black";
  }

  function nextPlayer({ step, owner }) {
    return actualColor(Go.color(step + 1), owner);
  }

  function signature(board, indices, owner) {
    return indices.map((i) => !board[i] ? "." : board[i].color === owner ? "1" : "2").join("");
  }

  function coreKey(key) {
    return coreIndices.map((i) => key[i]).join("");
  }

  function prepareBook(index) {
    const byCore = new Map();
    for (const [key, entries] of index) {
      let right = coreSpan - 1;
      let bottom = coreSpan - 1;
      let stones = 0;
      for (let i = 0; i < key.length; i += 1) {
        if (key[i] === ".") continue;
        stones += 1;
        // Keep two extra lines around the stones, including long extensions outside the core.
        right = Math.max(right, i % cornerSpan + 2);
        bottom = Math.max(bottom, Math.floor(i / cornerSpan) + 2);
      }
      const fringe = [...area.keys()].filter((i) => {
        const x = i % cornerSpan;
        const y = Math.floor(i / cornerSpan);
        return (x >= coreSpan || y >= coreSpan) && x <= right && y <= bottom;
      });
      const core = coreKey(key);
      if (!byCore.has(core)) byCore.set(core, []);
      byCore.get(core).push({ key, entries, stones, fringe });
    }
    return { index, byCore };
  }

  function explain(text, match) {
    const local = text.replace(/\b[A-HJ-T](?:1[0-9]|[1-9])\b/g, match.view.point);
    return match.owner === "black" ? local : local.replace(/[黑白]/g, (color) => color === "黑" ? "白" : "黑");
  }

  function nextKind(line, step) {
    if (!line.deviation) return line.id && line.id !== "main" ? "branch" : "joseki";
    if (step + 1 === line.deviation) return "deviation";
    if (step < line.deviation) return "branch";
    return (step - line.deviation) % 2 === 0 ? "counter" : "reply";
  }

  function followCorner(moves, step) {
    let i = step - 1;
    while (i >= 0 && moves[i].point === null) i -= 1;
    if (i < 0) return corners[1];
    const at = Go.index(moves[i].point);
    let x = at % Go.size;
    let y = Math.floor(at / Go.size);
    if (Math.abs(x - middle) <= 2 && Math.abs(y - middle) <= 2) return null;

    // A line can run onto the middle column or row, such as a K16 extension.
    for (let j = i - 1; j >= 0 && (x === middle || y === middle); j -= 1) {
      if (moves[j].point === null) continue;
      const previous = Go.index(moves[j].point);
      const px = previous % Go.size;
      const py = Math.floor(previous / Go.size);
      if (x === middle && (y > middle) === (py > middle)) x = px;
      if (y === middle && (x > middle) === (px > middle)) y = py;
    }
    return corners[(y > middle ? 2 : 0) + (x > middle ? 1 : 0)];
  }

  function groupsInScope(board, scope) {
    const seen = new Set();
    const groups = [];
    for (const [at, stone] of board.entries()) {
      if (!stone || seen.has(at) || (scope && !scope.has(at))) continue;
      const { stones, liberties } = Go.group(board, at);
      for (const member of stones) seen.add(member);
      groups.push({ at, player: stone.color, stones, size: stones.size, liberties });
    }
    return groups;
  }

  function tacticalMoves(groups, player, tryAt) {
    const tight = groups.filter((group) => group.liberties.size <= 2);
    const tightFriends = new Set(tight.filter((group) => group.player === player).flatMap((group) => [...group.stones]));
    const captures = new Set();
    const suggestions = new Map();
    function add(at, title, why, score) {
      if ((suggestions.get(at)?.score ?? -1) >= score) return;
      suggestions.set(at, { point: Go.pointAt(at), title, why, kind: "tactic", score });
    }

    for (const group of tight) {
      if (group.player === player) continue;
      const target = Go.pointAt(group.at);
      const color = colorName(group.player);
      const libertyFight = [...group.stones].some((stone) => directions.some(([dx, dy]) => tightFriends.has(offset(stone, dx, dy))));
      for (const at of group.liberties) {
        const next = tryAt(Go.pointAt(at));
        if (!next) continue;
        if (!next.board[group.at]) {
          captures.add(at);
          add(at, `提掉${color}棋 ${next.captured} 子`, `${target} 附近的${color}棋只剩这一口气。占住它，就可以提走棋子。`, 115 + next.captured);
        } else if (Go.group(next.board, group.at).liberties.size === 1 && Go.group(next.board, at).liberties.size > 1) {
          const why = libertyFight
            ? `这里双方的棋都紧气。先打吃 ${target} 附近的${color}棋，把这块棋压到只剩一口气。`
            : `这手让对方 ${group.size} 子只剩一口气。对手还可以长出或通过提子解围。`;
          const score = libertyFight ? 97 + Math.min(group.size, 4) : 30 + Math.min(group.size, 8) * 4;
          add(at, `打吃 ${target} 附近的${color}棋`, why, score);
        }
      }
    }
    for (const group of tight) {
      if (group.player !== player) continue;
      const urgent = group.liberties.size === 1;
      const points = urgent ? new Set([...group.liberties, ...captures]) : group.liberties;
      for (const at of points) {
        const next = tryAt(Go.pointAt(at));
        if (!next?.board[group.at]) continue;
        const after = Go.group(next.board, group.at).liberties.size;
        if (after > group.liberties.size) {
          const target = Go.pointAt(group.at);
          const why = `${target} 附近的己方 ${group.size} 子从 ${group.liberties.size} 口气增加到 ${after} 口气。`;
          add(at, urgent ? `给 ${target} 附近的棋解围` : `长出给 ${target} 增气`, why, (urgent ? 100 : 35) + Math.min(after, 8));
        }
      }
    }
    return [...suggestions.values()];
  }

  function distanceToEdge(at) {
    const x = at % Go.size;
    const y = Math.floor(at / Go.size);
    return Math.min(x, y, edge - x, edge - y);
  }

  function offset(at, dx, dy) {
    const x = at % Go.size + dx;
    const y = Math.floor(at / Go.size) + dy;
    return x < 0 || x > edge || y < 0 || y > edge ? null : y * Go.size + x;
  }

  function straightRun(board, start, dx, dy) {
    const color = board[start].color;
    const run = [];
    for (let at = start; at !== null && board[at]?.color === color; at = offset(at, dx, dy)) run.push(at);
    return run;
  }

  function contactMove(at, adjacent, player, tryAt) {
    const friends = adjacent.filter((group) => group.player === player);
    const opponents = adjacent.filter((group) => group.player !== player);
    if (!friends.length && (opponents.length < 2 || !opponents.some((group) => group.liberties.size <= 3))) return null;
    const point = Go.pointAt(at);
    const next = tryAt(point);
    if (!next) return null;
    const after = Go.group(next.board, at).liberties.size;

    if (!friends.length) {
      if (after < 2 || opponents.some((group) => !next.board[group.at])) return null;
      const separated = opponents.map((group) => Go.pointAt(group.at)).join("、");
      return {
        point, kind: "shape", title: "在断点试切", score: after === 2 ? 34 : 47,
        why: `占住对手 ${separated} 附近两块棋的连接点。切入的一子有 ${after} 口气，接下来要读对手的打吃。`,
      };
    }
    if (after < 3) return null;

    const ally = friends[0];
    const target = Go.pointAt(ally.at);
    if (friends.length > 1) {
      const joined = friends.map((group) => Go.pointAt(group.at)).join("、");
      return {
        point, kind: "shape", title: "接实己方棋",
        why: `把 ${joined} 附近的己方棋接成一块。接好后整块有 ${after} 口气。`,
        score: 40 + Math.min(after, 6),
      };
    }
    if (opponents.length > 1 && opponents.every((group) => next.board[group.at])) {
      const separated = opponents.map((group) => Go.pointAt(group.at)).join("、");
      return {
        point, kind: "shape", title: "占住对手的断点",
        why: `卡在 ${separated} 附近两块对手棋的连接点，同时接住己方 ${target} 附近的棋，整块有 ${after} 口气。`,
        score: 50 + Math.min(after, 6),
      };
    }
    const gain = after - ally.liberties.size;
    if (gain <= 0) return null;
    const urgency = Math.max(0, 5 - ally.liberties.size) * 3;
    const score = 12 + urgency + Math.min(gain, 2) * 2 + Math.min(distanceToEdge(at), 2) * 3;
    return {
      point, kind: "shape", title: "顺势长出增气", score,
      why: `连住己方 ${target} 附近的棋，把整块棋从 ${ally.liberties.size} 口气增到 ${after} 口气。`,
    };
  }

  function shapeMoves(groups, player, tryAt, scope) {
    const contacts = new Map();
    for (const group of groups) {
      for (const liberty of group.liberties) {
        if (scope && !scope.has(liberty)) continue;
        if (!contacts.has(liberty)) contacts.set(liberty, []);
        contacts.get(liberty).push(group);
      }
    }
    return [...contacts].map(([at, adjacent]) => contactMove(at, adjacent, player, tryAt))
      .filter(Boolean);
  }

  function haneMove(board, player, tryAt, tryReply, head, at, support, gap, dx, dy) {
    if (board[support]?.color !== player || (board[gap] && board[gap].color !== player)) return null;
    const point = Go.pointAt(at);
    const next = tryAt(point);
    if (!next || !next.board[head] || Go.group(next.board, at).liberties.size < 3) return null;
    const wall = Go.group(next.board, support);
    if (wall.liberties.size < 3) return null;

    const cut = Go.pointAt(gap);
    const reply = board[gap] ? null : tryReply(next.board, cut);
    let ownLibertiesAfterCut = 0;
    if (reply) {
      if (!reply.board[at] || !reply.board[support]) return null;
      ownLibertiesAfterCut = Go.group(reply.board, at).liberties.size;
      if (ownLibertiesAfterCut < 2 || Go.group(reply.board, support).liberties.size < 2) return null;
    }

    let blockedRoom = 1;
    for (let distance = 1; distance <= 3; distance += 1) {
      const ahead = offset(at, -dx * distance, -dy * distance);
      if (ahead === null || board[ahead]) break;
      blockedRoom += 1;
    }
    const runLength = straightRun(board, head, dx, dy).length;
    const score = 65 + Math.min(runLength, 5) * 2 + Math.min(wall.stones.size, 5) + blockedRoom * 4 - (reply ? 6 : 0);
    const risk = reply ? `对手可以在 ${cut} 切断，断后扳子有 ${ownLibertiesAfterCut} 口气。` : `这手有 ${Go.pointAt(support)} 一带的棋接应。`;
    return {
      point, kind: "shape", title: `扳住${colorName(board[head].color)}棋的头`, score,
      why: `绕到 ${Go.pointAt(head)} 的端头，挡住对手向这一侧直长的路。${risk}`,
    };
  }

  function haneMoves(board, player, tryAt, tryReply, scope) {
    const moves = new Map();
    for (const [head, stone] of board.entries()) {
      if (!stone || stone.color === player) continue;
      for (const [dx, dy] of directions) {
        const at = offset(head, -dx, -dy);
        const behind = offset(head, dx, dy);
        if (at === null || board[at] || (scope && !scope.has(at)) || board[behind]?.color !== stone.color) continue;
        for (const side of [1, -1]) {
          const support = offset(head, side * dy, -side * dx);
          const gap = offset(at, side * dy, -side * dx);
          if (support === null || gap === null) continue;
          const move = haneMove(board, player, tryAt, tryReply, head, at, support, gap, dx, dy);
          if (move && move.score > (moves.get(at)?.score ?? -1)) moves.set(at, move);
        }
      }
    }
    return [...moves.values()].sort((a, b) => b.score - a.score).slice(0, 2);
  }

  function openInFront(board, run, dx, dy, width) {
    for (const stone of run) {
      for (let distance = 1; distance <= width; distance += 1) {
        const at = offset(stone, dx * distance, dy * distance);
        if (at === null || board[at]) return false;
      }
    }
    return true;
  }

  function wallMoves(board, player, tryAt, scope) {
    const moves = [];
    for (const [start, stone] of board.entries()) {
      if (stone?.color !== player) continue;
      for (const [dx, dy] of axes) {
        if (board[offset(start, -dx, -dy)]?.color === player) continue;
        const run = straightRun(board, start, dx, dy);
        if (run.length < 4 || Go.group(board, start).liberties.size < 5) continue;
        const reach = run.length >= 5 ? 4 : 3;
        const center = run[Math.floor(run.length / 2)];
        for (const side of [1, -1]) {
          const nx = side * dy;
          const ny = -side * dx;
          const at = offset(center, nx * reach, ny * reach);
          if (at === null || (scope && !scope.has(at)) || distanceToEdge(at) < 2 || !openInFront(board, run, nx, ny, reach)) continue;
          const point = Go.pointAt(at);
          const next = tryAt(point);
          if (!next || Go.group(next.board, at).liberties.size < 4) continue;
          moves.push({
            point, kind: "territory", title: "借外壁向空处展开", score: 38 + Math.min(run.length, 6) * 2,
            why: `${Go.pointAt(start)} 到 ${Go.pointAt(run.at(-1))} 一带已有整排相连的棋。这一手离外壁 ${reach} 格，向空旷的一侧展开，为后续围空留出范围。`,
          });
        }
      }
    }
    return moves;
  }

  function enclosureMoves(board, player, tryAt, scope) {
    const moves = [];
    for (const corner of corners) {
      const occupied = corner.core.filter((at) => board[at]);
      if (occupied.length !== 1 || board[occupied[0]].color !== player) continue;
      const origin = Go.pointAt(occupied[0]);
      for (const view of corner.views) {
        const cornerPoint = origin === view.point("D16") ? "F17" : origin === view.point("C16") ? "E17" : null;
        if (!cornerPoint) continue;
        const point = view.point(cornerPoint);
        if ((scope && !scope.has(Go.index(point))) || !tryAt(point)) continue;
        moves.push({
          point, kind: "territory", title: "小飞守角", score: 49,
          why: `与 ${origin} 形成小飞守角，照应角内与这一侧的边。对手之后仍可在角部试探。`,
        });
      }
    }
    return moves;
  }

  function openCornerMoves(board, tryAt) {
    const suggestions = [];
    for (const corner of corners) {
      const view = corner.views[0];
      const occupied = corner.core.some((at) => board[at]);
      const point = view.point(openings[0].point);
      if (!occupied && tryAt(point)) {
        suggestions.push({
          point, kind: "opening", title: `${corner.label}占星位`,
          why: "这个角还有空间。先占四线星位，保留朝两边发展的余地。",
        });
      }
    }
    return suggestions;
  }

  function approachMoves(groups, tryAt, scope) {
    const suggestions = new Map();
    const offsets = [
      [1, 2], [2, 1], [-1, 2], [-2, 1], [1, -2], [2, -1], [-1, -2], [-2, -1],
      [2, 2], [-2, 2], [2, -2], [-2, -2],
    ];
    for (const group of groups) {
      const x = group.at % Go.size;
      const y = Math.floor(group.at / Go.size);
      for (const [dx, dy] of offsets) {
        const nx = x + dx;
        const ny = y + dy;
        if (nx < 2 || nx > edge - 2 || ny < 2 || ny > edge - 2) continue;
        const at = ny * Go.size + nx;
        if (suggestions.has(at) || (scope && !scope.has(at))) continue;
        const point = Go.pointAt(at);
        const next = tryAt(point);
        if (!next) continue;
        const placed = Go.group(next.board, at);
        if (placed.stones.size !== 1 || placed.liberties.size !== 4) continue;
        suggestions.set(at, {
          point, kind: "shape", title: "从有空间的一侧靠近",
          why: `与对手在 ${Go.pointAt(group.at)} 附近的棋保持距离，新子有 4 口气，可以向空处展开。`,
        });
      }
    }
    return [...suggestions.values()].slice(0, 4);
  }

  function positionMoves(board, player, tryAt, tryReply, corner) {
    const scope = corner?.scope;
    const groups = groupsInScope(board, scope);
    const moves = [
      ...tacticalMoves(groups, player, tryAt),
      ...haneMoves(board, player, tryAt, tryReply, scope),
      ...wallMoves(board, player, tryAt, scope),
      ...enclosureMoves(board, player, tryAt, scope),
      ...shapeMoves(groups, player, tryAt, scope),
    ].sort((a, b) => b.score - a.score);
    const used = new Set();
    const candidates = [];
    for (const move of moves) {
      if (used.has(move.point)) continue;
      candidates.push(move);
      used.add(move.point);
      if (candidates.length === 4) break;
    }
    if (candidates.length) return candidates;

    const openCorners = corner ? [] : openCornerMoves(board, tryAt);
    if (openCorners.length) return openCorners;
    return approachMoves(groups.filter((group) => group.player !== player && group.size <= 3), tryAt, scope);
  }

  function create(courses, extraLines, records = []) {
    const references = records.length
      ? GoSgfBook.create(records, (board) => signature(board, area, "black"), cornerSpan)
      : { index: new Map(), positions: 0 };
    const lines = courses.flatMap((course) => course.paths.map((path) => ({
      ...path,
      family: course.title,
      source: course.source,
    })));
    for (const line of extraLines) lines.push({ ...line, frames: Go.replay(line.moves) });
    const index = new Map();
    for (const line of lines) {
      for (let step = 1; step < line.frames.length; step += 1) {
        const key = signature(line.frames[step].board, area, "black");
        if (!index.has(key)) index.set(key, []);
        index.get(key).push({ first: line.moves[0].point, line, step });
      }
    }

    const teachingBook = prepareBook(index);
    const referenceBook = prepareBook(references.index);

    function findMatches(board, corner, book = teachingBook) {
      const matches = [];
      const fallback = [];
      function add(entries, key, view, owner) {
        // Start with the earliest stone in the matched pattern, ignoring unrelated extra stones.
        let first = null;
        for (let i = 0; i < key.length; i += 1) {
          const at = view.indices[i];
          if (key[i] !== "." && (first === null || board[at].moveNumber < board[first].moveNumber)) first = at;
        }
        for (const entry of entries.values()) {
          const anchored = first !== null && view.point(entry.first) === Go.pointAt(first);
          matches.push({ ...entry, view, owner, anchored });
        }
      }
      for (const view of corner.views) {
        for (const owner of ["black", "white"]) {
          const key = signature(board, view.indices, owner);
          const entries = book.index.get(key);
          if (entries) add(entries, key, view, owner);
          else fallback.push({ key, view, owner });
        }
      }
      if (!matches.length) {
        let mostStones = 0;
        for (const { key, view, owner } of fallback) {
          for (const pattern of book.byCore.get(coreKey(key)) ?? []) {
            if (pattern.stones < mostStones || !pattern.fringe.every((i) => pattern.key[i] === key[i])) continue;
            if (pattern.stones > mostStones) matches.length = 0;
            mostStones = pattern.stones;
            add(pattern.entries, pattern.key, view, owner);
          }
        }
      }
      // The same two stones can arise from a 3-3 invasion or a 3-3 opening.
      const anchored = matches.filter((match) => match.anchored);
      return anchored.length ? anchored : matches;
    }

    function bookMoves(matches, player, tryAt) {
      const moves = new Map();
      for (const match of matches) {
        const { line, step, view } = match;
        const next = line.moves[step];
        if (!next || nextPlayer(match) !== player) continue;
        const point = view.point(next.point);
        const kind = nextKind(line, step);
        if (!tryAt(point) || (moves.has(point) && rank[moves.get(point).kind] <= rank[kind])) continue;
        moves.set(point, { point, kind, title: explain(next.title, match), why: explain(next.why, match) });
      }
      return [...moves.values()].sort((a, b) => rank[a.kind] - rank[b.kind]);
    }

    function referenceMoves(matches, choices, player, tryAt) {
      const moves = new Map();
      const used = new Set(choices.map((choice) => choice.point));
      for (const { view, next, owner } of matches) {
        if (!next || next.kind === "deviation" || actualColor(next.color, owner) !== player) continue;
        const point = view.point(next.point);
        if (used.has(point) || (moves.has(point) && rank[moves.get(point).kind] <= rank[next.kind])) continue;
        const played = tryAt(point);
        if (!played) continue;
        const at = Go.index(point);
        const group = Go.group(played.board, at);
        const atari = directions.map(([dx, dy]) => offset(at, dx, dy)).find((neighbor) => {
          const stone = played.board[neighbor];
          return stone && stone.color !== player && Go.group(played.board, neighbor).liberties.size === 1;
        });
        let title = "棋谱中的续着";
        let why = "这是谱库收录的一个分支。落下可查看接下来的局部交换。";
        if (played.captured) {
          title = `提走 ${played.captured} 子`;
          why = `这手能直接提掉对手 ${played.captured} 子，可继续看谱库中的续着。`;
        } else if (atari != null) {
          title = `打吃 ${Go.pointAt(atari)} 附近的棋`;
          why = "落下后对手这块棋只剩一口气。";
        } else if (next.kind === "counter") {
          title = "应对谱库中的变招";
          why = "这是记录在这手偏离之后的一条应法。可以继续摆出双方的续着。";
        } else if (group.stones.size > 1) {
          why = `这手与己方棋连成 ${group.stones.size} 子，共 ${group.liberties.size} 口气。`;
        }
        moves.set(point, { point, kind: next.kind, title, why });
      }
      return [...choices, ...[...moves.values()].sort((a, b) => rank[a.kind] - rank[b.kind])];
    }

    function analyze({ moves, frames, step, focus }) {
      const frame = frames[step];
      const { board } = frame;
      const player = Go.color(step + 1);
      const corner = focus === "auto" ? followCorner(moves, step) : corners.find((corner) => corner.id === focus);
      const result = { region: corner?.label ?? "全盘", corner: corner?.id ?? null, title: "自由棋形", candidates: [], phase: "", source: null };
      const attempts = new Map();
      function legalPlay(position, point, moveNumber, previousBoard) {
        try { return Go.play(position, point, moveNumber, previousBoard); } catch { return null; }
      }
      function tryAt(point) {
        if (!attempts.has(point)) {
          attempts.set(point, legalPlay(board, point, step + 1, frames[step - 1]?.board));
        }
        return attempts.get(point);
      }
      const tryReply = (position, point) => legalPlay(position, point, step + 2, board);

      if (corner && corner.core.every((at) => !board[at])) {
        result.title = step === 0 ? "从一颗棋子开始" : "这里还是空角";
        result.detail = "可以直接在棋盘任意合法点落子。想试常见角部开局，可从标出的点开始。";
        result.candidates = openings.map((opening) => ({ ...opening, point: corner.views[0].point(opening.point), kind: "opening" }));
        return result;
      }

      const matches = corner ? findMatches(board, corner) : [];
      const library = corner ? findMatches(board, corner, referenceBook) : [];
      const latest = corner && moves.slice(0, step).findLast((move) => move.point && corner.scope.has(Go.index(move.point)));
      if (matches.length) {
        const exact = matches.find((match) => match.view.point(match.line.moves[match.step - 1].point) === latest?.point);
        const match = exact ?? matches[0];
        const { line, step: localStep } = match;
        const applied = line.moves[localStep - 1];
        const inVariation = line.deviation && localStep >= line.deviation;
        const finished = localStep === line.moves.length;
        const candidates = referenceMoves(library, bookMoves(matches, player, tryAt), player, tryAt);
        result.title = localStep === 1 ? explain(applied.title, match) : line.family;
        result.phase = inVariation ? `变招 · ${explain(line.title, match)}` :
          localStep === 1 ? "开局识别" : candidates.filter((candidate) => candidate.kind === "joseki").length > 1 ? "可比较多个定式方向" : line.title;
        if (exact && localStep > 1) result.action = explain(applied.title, match);
        result.detail = finished ? explain(line.result, match) : exact ? explain(applied.why, match) : "已识别当前局部棋形。可以从候选落子比较不同的走势。";
        result.candidates = candidates.length ? candidates : positionMoves(board, player, tryAt, tryReply, corner);
        result.source = line.source;
        if (!finished && !candidates.length && nextPlayer(match) !== player) {
          result.tip = `这条棋谱下一手由${colorName(nextPlayer(match))}棋应。候选落点按当前行棋方计算。`;
        }
        return result;
      }

      if (library.length) {
        const match = library.find(({ view, last }) => view.point(last.point) === latest?.point) ?? library[0];
        const candidates = referenceMoves(library, [], player, tryAt);
        result.title = match.family;
        result.phase = match.last.kind === "deviation" ? "谱库变招" : "Pachi 定式谱";
        result.source = match.source;
        result.detail = match.last.kind === "deviation"
          ? "最后一手是谱库记录的偏离。可以落出一手反击，再继续比较双方续着。"
          : "这个局部已匹配到谱库棋形。可以比较候选落点与后续交换。";
        result.candidates = candidates.length ? candidates : positionMoves(board, player, tryAt, tryReply, corner);
        return result;
      }

      if (corner) {
        for (let i = step - 1; i > 0; i -= 1) {
          const [earlier] = findMatches(frames[i].board, corner);
          const [reference] = earlier ? [] : findMatches(frames[i].board, corner, referenceBook);
          if (!earlier && !reference) continue;
          const name = earlier
            ? earlier.step === 1 ? explain(earlier.line.moves[0].title, earlier) : earlier.line.family
            : reference.family;
          result.title = `${name} · 自由变化`;
          break;
        }
      }
      result.candidates = positionMoves(board, player, tryAt, tryReply, corner);
      result.detail = "当前是自由变化。候选会结合棋块强弱、断点和周围的空间，提示扳头、补棋或围地的方向。";
      return result;
    }

    return { analyze, referencePositions: references.positions };
  }

  return { create, corners: corners.map(({ id, label }) => ({ id, label })), labels };
})();
