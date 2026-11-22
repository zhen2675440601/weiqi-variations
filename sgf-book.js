"use strict";

const GoSgfBook = (() => {
  function readCollection(text, initial, visit) {
    let offset = 0;
    function skipSpace() {
      while (/\s/.test(text[offset] ?? "")) offset += 1;
    }
    function take(token) {
      skipSpace();
      if (text[offset] !== token) throw new Error(`SGF 格式错误，位置 ${offset} 应为 ${token}`);
      offset += 1;
    }
    function value() {
      take("[");
      let result = "";
      while (offset < text.length) {
        const char = text[offset++];
        if (char === "]") return result;
        result += char === "\\" ? text[offset++] ?? "" : char;
      }
      throw new Error("SGF 属性值缺少结束括号");
    }
    function node() {
      take(";");
      const properties = Object.create(null);
      skipSpace();
      while (/[A-Z]/.test(text[offset] ?? "")) {
        const start = offset;
        while (/[A-Z]/.test(text[offset] ?? "")) offset += 1;
        const name = text.slice(start, offset);
        const values = [value()];
        skipSpace();
        while (text[offset] === "[") {
          values.push(value());
          skipSpace();
        }
        properties[name] = values;
      }
      return properties;
    }
    function tree(state) {
      take("(");
      skipSpace();
      while (text[offset] === ";") {
        const properties = node();
        if (state) state = visit(state, properties);
      }
      while (text[offset] === "(") {
        tree(state);
        skipSpace();
      }
      take(")");
    }
    skipSpace();
    while (offset < text.length) {
      tree(initial);
      skipSpace();
    }
  }

  function approachTitle(first, second, family) {
    if (first === "D16" && second === "C17") return "星位点三三";
    if (first === "D16" && ["F17", "C14"].includes(second)) return "星位小飞挂";
    if (first === "D16" && ["F16", "D14"].includes(second)) return "星位一间高挂";
    if (family === "小目" && ((first === "C16" && second === "E17") || (first === "D17" && second === "C15"))) return "小目小飞挂";
    if (family === "小目" && ((first === "C16" && second === "E16") || (first === "D17" && second === "D15"))) return "小目一间高挂";
    return family;
  }

  function create(records, keyFor, span) {
    const index = new Map();
    const edge = Go.size - 1;
    const startingBoard = Go.emptyFrame().board;
    let continuations = 0;
    function add(key, entry) {
      let bucket = index.get(key);
      if (!bucket) index.set(key, bucket = new Map());
      const id = `${entry.first}|${entry.last.point}|${entry.last.kind}|${entry.next?.point ?? ""}|${entry.next?.color ?? ""}|${entry.next?.kind ?? ""}`;
      if (bucket.has(id)) return;
      bucket.set(id, entry);
      if (entry.next) continuations += 1;
    }

    for (const { family, file, sgf } of records) {
      const source = { title: `Pachi ${family}棋谱`, url: `https://github.com/pasky/pachi/blob/master/joseki/${file}` };
      const initial = { board: startingBoard, prev: null, ply: 0, count: 0, first: null, family, source };
      readCollection(sgf, initial, (state, properties) => {
        if (properties.AB || properties.AW || properties.AE || (properties.SZ && properties.SZ[0] !== "19")) return null;
        const value = properties.B?.[0] ?? properties.W?.[0];
        if (value === undefined) return state;
        const rawColor = properties.B ? "black" : "white";
        const owner = state.owner ?? rawColor;
        const color = rawColor === owner ? "black" : "white";
        const ply = state.ply + (Go.color(state.ply + 1) === color ? 1 : 2);
        if (value === "" || value === "tt") return state.count ? { ...state, ply, prev: state.board } : state;
        if (!/^[a-s]{2}$/.test(value)) return null;
        const rawX = value.charCodeAt(0) - 97;
        const rawY = value.charCodeAt(1) - 97;
        const right = state.right ?? rawX > edge / 2;
        const bottom = state.bottom ?? rawY > edge / 2;
        const x = right ? edge - rawX : rawX;
        const y = bottom ? edge - rawY : rawY;
        if (x >= span || y >= span) return null;
        const point = Go.point(x, y);
        let board;
        try {
          board = Go.play(state.board, point, ply, ply === state.ply + 1 ? state.prev : state.board).board;
        } catch {
          // Some source variants depend on setup stones or on a larger local region.
          return null;
        }

        const tag = properties.C?.[0]?.split("\n", 1)[0] ?? "";
        const bad = properties.BM || /<(?:don['’]t|bad|avoid)>/i.test(tag);
        const kind = state.count && bad ? "deviation" : state.last?.kind === "deviation" && state.last.color !== color ? "counter" : "book";
        const move = { point, kind, color };
        if (state.count) add(keyFor(state.board), { first: state.first, last: state.last, family: state.family, source, next: move });
        const first = state.first ?? point;
        const name = state.count === 1 ? approachTitle(first, point, family) : state.family;
        add(keyFor(board), { first, last: move, family: name, source });
        return { board, prev: state.board, ply, count: state.count + 1, first, last: move, family: name, owner, right, bottom };
      });
    }
    return { index, positions: index.size, continuations };
  }

  return { create };
})();
