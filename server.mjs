import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { createServer } from "node:http";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL(".", import.meta.url));
const engine = process.argv[2] ? resolve(process.argv[2]) : resolve(root, "katago", "katago.exe");
const modelPaths = ["model.bin.gz", "model.txt.gz"].map((file) => resolve(root, "katago", file));
const model = process.argv[3] ? resolve(process.argv[3]) : modelPaths.find(existsSync) ?? modelPaths[0];
const config = resolve(root, "katago-analysis.cfg");
const port = Number(process.env.YIJIAO_PORT ?? 8787);
const columns = "ABCDEFGHJKLMNOPQRST";
const pointPattern = /^[A-HJ-T](?:[1-9]|1[0-9])$/;
const corners = new Set(["nw", "ne", "sw", "se"]);
const assets = new Set(["index.html", "styles.css", "app.js", "go.js", "lessons.js", "explorer.js", "sgf-book.js", "pachi-data.js", "COPYING.pachi", "README.md"]);
const mime = { html: "text/html", css: "text/css", js: "text/javascript" };
let busy = false;

function send(response, status, payload) {
  if (response.destroyed) return;
  response.writeHead(status, { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store" });
  response.end(JSON.stringify(payload));
}

async function readPosition(request) {
  let size = 0;
  const chunks = [];
  for await (const chunk of request) {
    size += chunk.length;
    if (size > 12000) throw new Error("棋谱数据超出分析大小限制。");
    chunks.push(chunk);
  }
  const { moves, corner = null } = JSON.parse(Buffer.concat(chunks).toString("utf8"));
  if (!Array.isArray(moves) || moves.length > 1024 || moves.some((move) => move !== null && (typeof move !== "string" || !pointPattern.test(move)))) {
    throw new Error("请提交合法格式的十九路落子坐标。");
  }
  if (corner !== null && !corners.has(corner)) throw new Error("无效的棋盘范围。");
  return { moves, corner };
}

function analysisQuery({ moves, corner }) {
  const query = {
    id: "position", boardXSize: 19, boardYSize: 19, initialPlayer: "B",
    komi: 7.5, rules: "koSIMPLEscoreAREAtaxNONEsui0",
    moves: moves.map((move, i) => [i % 2 ? "W" : "B", move ?? "pass"]),
  };
  if (corner) {
    const left = corner.endsWith("w") ? 0 : 9;
    const top = corner.startsWith("n") ? 0 : 9;
    const points = [];
    for (let y = top; y <= top + 9; y += 1) {
      for (let x = left; x <= left + 9; x += 1) points.push(`${columns[x]}${19 - y}`);
    }
    query.allowMoves = [{ player: moves.length % 2 ? "W" : "B", moves: [...points, "pass"], untilDepth: 1 }];
  }
  return query;
}

function runKataGo(query, signal) {
  return new Promise((resolveResult, reject) => {
    const child = spawn(engine, ["analysis", "-config", config, "-model", model], { cwd: root, windowsHide: true, signal });
    let stdout = "";
    let stderr = "";
    child.stdout.setEncoding("utf8").on("data", (chunk) => { stdout += chunk; });
    child.stderr.setEncoding("utf8").on("data", (chunk) => { stderr = (stderr + chunk).slice(-2400); });
    child.stdin.on("error", () => {});
    child.on("error", reject);
    child.on("close", (exitCode) => {
      if (signal.aborted) {
        reject(new DOMException("分析已取消", "AbortError"));
        return;
      }
      if (exitCode !== 0) {
        console.error(stderr || `KataGo exited with code ${exitCode}`);
        reject(new Error("KataGo 启动或分析失败。请查看终端中的引擎日志。"));
        return;
      }
      try {
        const data = stdout.trim().split(/\r?\n/).filter(Boolean).map((line) => JSON.parse(line))
          .findLast((result) => result.id === query.id && !result.isDuringSearch && (result.moveInfos || result.error));
        if (!data || data.error) throw new Error(data?.error ?? "引擎没有返回该局面的分析结果。");
        const moves = data.moveInfos.slice().sort((a, b) => a.order - b.order).slice(0, 12).map(({ move, scoreLead, winrate, visits, pv }) => ({
          point: move, scoreLead, winrate, visits, pv: (pv ?? []).slice(0, 8),
        }));
        resolveResult({ player: data.rootInfo.currentPlayer, visits: data.rootInfo.visits, scoreLead: data.rootInfo.scoreLead, moves });
      } catch (error) {
        reject(error);
      }
    });
    child.stdin.end(`${JSON.stringify(query)}\n`);
  });
}

const server = createServer(async (request, response) => {
  const address = server.address();
  const localHosts = [`127.0.0.1:${address.port}`, `localhost:${address.port}`];
  if (!localHosts.includes(request.headers.host)) return send(response, 403, { error: "请通过本机地址打开弈角。" });
  const path = request.url.split("?", 1)[0];
  if (request.method === "POST" && path === "/api/analysis") {
    if ((request.headers.origin && !localHosts.some((host) => request.headers.origin === `http://${host}`)) ||
        request.headers["content-type"]?.split(";", 1)[0] !== "application/json") {
      return send(response, 403, { error: "请从弈角页面提交分析。" });
    }
    if (!existsSync(engine) || !existsSync(model)) {
      return send(response, 503, { error: "本地缺少 KataGo 引擎或模型。可按使用说明配置后重启。" });
    }
    if (busy) return send(response, 429, { error: "KataGo 正在分析另一局面，请稍后再试。" });
    let position;
    try { position = await readPosition(request); } catch (error) { return send(response, 400, { error: error.message }); }
    if (busy) return send(response, 429, { error: "KataGo 正在分析另一局面，请稍后再试。" });
    if (response.destroyed) return;
    const cancel = new AbortController();
    response.on("close", () => cancel.abort());
    busy = true;
    try {
      const analysis = await runKataGo(analysisQuery(position), AbortSignal.any([cancel.signal, AbortSignal.timeout(30000)]));
      send(response, 200, analysis);
    } catch (error) {
      if (!cancel.signal.aborted) send(response, 502, { error: error.name === "AbortError" ? "KataGo 分析超时。" : error.message });
    } finally {
      busy = false;
    }
    return;
  }
  const file = path === "/" ? "index.html" : path.slice(1);
  if (!["GET", "HEAD"].includes(request.method) || !assets.has(file)) return send(response, 404, { error: "页面不存在。" });
  const data = await readFile(resolve(root, file)).catch(() => null);
  if (!data) return send(response, 404, { error: "页面不存在。" });
  response.writeHead(200, { "Content-Type": `${mime[file.split(".").at(-1)] ?? "text/plain"}; charset=utf-8`, "Cache-Control": "no-cache" });
  response.end(request.method === "HEAD" ? undefined : data);
});

server.listen(port, "127.0.0.1", () => {
  console.log(`弈角 http://127.0.0.1:${server.address().port}`);
  console.log(existsSync(engine) && existsSync(model) ? "KataGo 已配置。" : "可阅读 README.md 配置 KataGo 引擎和模型。");
});
