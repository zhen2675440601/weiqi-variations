"use strict";

const Go = (() => {
  const size = 19;
  const columns = "ABCDEFGHJKLMNOPQRST";

  function index(point) {
    const x = columns.indexOf(point[0]);
    const y = size - Number(point.slice(1));
    if (x < 0 || !Number.isInteger(y) || y < 0 || y >= size) {
      throw new Error(`棋盘上没有 ${point} 这个交叉点。`);
    }
    return y * size + x;
  }

  function point(x, y) {
    return `${columns[x]}${size - y}`;
  }

  function pointAt(at) {
    return point(at % size, Math.floor(at / size));
  }

  function color(moveNumber) {
    return moveNumber % 2 === 1 ? "black" : "white";
  }

  function neighbors(at) {
    const result = [];
    if (at % size > 0) result.push(at - 1);
    if (at % size < size - 1) result.push(at + 1);
    if (at >= size) result.push(at - size);
    if (at + size < size * size) result.push(at + size);
    return result;
  }

  function group(board, start) {
    const stones = new Set([start]);
    const liberties = new Set();
    for (const at of stones) {
      for (const neighbor of neighbors(at)) {
        const stone = board[neighbor];
        if (!stone) liberties.add(neighbor);
        else if (stone.color === board[start].color) stones.add(neighbor);
      }
    }
    return { stones, liberties };
  }

  function play(board, location, moveNumber, previousBoard) {
    const at = index(location);
    if (board[at]) throw new Error(`${location} 已有棋子，请选择空点。`);

    const next = board.slice();
    const player = color(moveNumber);
    next[at] = { color: player, moveNumber };
    let captured = 0;
    for (const neighbor of neighbors(at)) {
      const stone = next[neighbor];
      if (!stone || stone.color === player) continue;
      const opponent = group(next, neighbor);
      if (opponent.liberties.size === 0) {
        captured += opponent.stones.size;
        for (const prisoner of opponent.stones) next[prisoner] = null;
      }
    }

    if (group(next, at).liberties.size === 0) {
      throw new Error(`${location} 落子后无气，也提不到对手的棋。`);
    }
    if (previousBoard && next.every((stone, i) => stone?.color === previousBoard[i]?.color)) {
      throw new Error(`${location} 是劫点，要先在别处落一手。`);
    }
    return { board: next, captured };
  }

  function emptyFrame() {
    return { board: Array(size * size).fill(null), black: 0, white: 0 };
  }

  function advance(frame, location, moveNumber, previousBoard) {
    if (location === null) return frame;
    const { board, captured } = play(frame.board, location, moveNumber, previousBoard);
    const player = color(moveNumber);
    return { ...frame, board, [player]: frame[player] + captured };
  }

  function replay(moves) {
    const frames = [emptyFrame()];
    for (const [i, move] of moves.entries()) {
      frames.push(advance(frames[i], move.point, i + 1, frames[i - 1]?.board));
    }
    return frames;
  }

  return { size, index, point, pointAt, color, group, play, emptyFrame, advance, replay };
})();
