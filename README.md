# 弈角 · 围棋定式探索

在十九路棋盘上自由落子。棋盘会识别角部棋形，给出可以试走的应手。遇到对手变招，可以悔棋比较几种下法，再看每手的作用。

[打开在线棋盘](https://zhen2675440601.github.io/weiqi-variations/) · [下载离线版](https://github.com/zhen2675440601/weiqi-variations/archive/refs/heads/main.zip)

## 第一次使用

1. 点「打开在线棋盘」即可开始。需要离线使用时，下载 ZIP 并解压，用浏览器打开 `index.html`。
2. 点 **新手指南 → 在棋盘试摆**。棋盘会摆出右上角黑 Q16、白 R17，这是「星位点三三」。点一个字母候选试走，再用「悔棋」比较另一侧的挡法。也可以随时在任意合法点落子。
3. 想看每手的作用，从指南进入 **从星位点三三学起**，点「下一手」阅读中文讲解。看完点 **练习定式** 自己试走，或在「分支与变招」里比较不同应法。练习时点「查看这一手」，可以在当前棋盘看应手和理由。

摆棋、查谱和练习可离线使用。键盘操作时，用 Tab 进入棋盘，方向键选点，回车落子。研习模式下，左右方向键翻到上一手或下一手。练习进度保存在当前浏览器对应的访问地址下。

## 候选点怎么读

- **空角落点**覆盖三三、小目、星位、目外、高目、大目外、大高目和五五。非对称点可以从角的两个朝向开始。三六和四六等少见布局有标注为「局部试走」的参考线路。
- **棋谱续着**来自精选定式或 Pachi 棋谱。当前谱库能识别 1,948 个参考棋形，包含同一定式的不同阶段和分支。
- **实战应手**会与棋谱续着一起出现。落点会结合周边接应、当前提子或救棋的机会排序，候选说明会标出试算到的对手提子、打吃或长出解围。
- **变招示例**标出棋谱记录的偏离，方便摆出双方应对。脱离棋谱后，也可以用棋形建议比较切断、补棋和围地。
- **KataGo 候选**来自本机 AI 搜索，可以比较目差和后续变化。当前小模型采用快速搜索，复杂死活和征子需要结合续着判断。

## 可选的本地 AI 分析

KataGo 在本地版运行。先下载离线版并解压，再按以下步骤配置。步骤适用于带 AVX2 的 64 位 Windows 电脑。已安装 Node.js 且引擎和模型放在 `katago` 目录的用户可从第 3 步开始。

1. 安装 [Node.js 22 或更高版本](https://nodejs.org/zh-cn/download)。下载 [KataGo v1.18.1 Windows CPU 版](https://github.com/lightvector/KataGo/releases/download/v1.18.1/katago-v1.18.1-eigenavx2-windows-x64.zip)。在项目目录创建 `katago` 文件夹，将压缩包里的 `katago.exe` 和同包 DLL 解压到这个文件夹。
2. 下载 [g170 小模型](https://huggingface.co/salty-flower/weiqi-models/resolve/4e432c4280c6a447c264084f825ee512e91a21e3/payload/kata1-b6c96.txt.gz)，保留压缩格式，将文件改名为 `model.txt.gz`，放在 `katago.exe` 同一目录。
3. 在项目目录打开终端，运行 `npm start`。保留终端窗口，在浏览器打开 [本地弈角](http://127.0.0.1:8787)。自由摆棋后点「AI 分析」。终端按 `Ctrl+C` 可结束服务。

在右侧选择一个角时，AI 首手在该角选点，后续结合全盘计算。选择「全盘建议」可比较其他角或边上的大场。棋谱通过本机回环地址送给分析服务。

| 遇到的问题 | 怎么处理 |
| --- | --- |
| 终端找不到 `npm` | 安装 Node.js 后重新打开终端。若 PowerShell 阻止 `npm.ps1`，执行 `npm.cmd start`。 |
| 提示缺少引擎或模型 | 检查 `katago/katago.exe` 和 `katago/model.txt.gz`，确认模型扩展名没有重复。 |
| 直接双击页面后 AI 未启动 | 用 `npm start` 启动服务，再进入 [本地弈角](http://127.0.0.1:8787)。 |

已有其他平台的 KataGo 或模型时，可以指定自己的路径。

```sh
node server.mjs "路径/katago" "路径/model.bin.gz"
```

## 开发与贡献

在项目目录运行 `npm test`，校验教学棋谱能完整重放，以及常见定式和偏离后的推荐。浏览器页面不需要构建，也不需要安装 npm 依赖。

| 文件 | 用途 |
| --- | --- |
| `index.html`、`app.js`、`styles.css` | 棋盘交互、研习、练习和新手指南 |
| `go.js`、`explorer.js` | 落子规则、局部棋形识别和候选点 |
| `lessons.js` | 带逐手注解的教学棋谱 |
| `pachi-data.js`、`sgf-book.js` | Pachi 棋谱数据和读取逻辑 |
| `server.mjs`、`katago-analysis.cfg` | 本地 AI 服务和引擎配置 |

报告候选点问题时，可以附上落子顺序、当前行棋方、所选角部和预期的应手。补充讲解时，请说明这一手解决了什么问题，以及对手有什么有力反击。

## 来源与许可

项目自有代码的开源许可证待定。下列许可适用于对应的第三方文件。

- `pachi-data.js` 保留来源 SGF 数据，按 Pachi 的 GPL-2.0 许可使用。[Pachi 棋谱原文件](https://github.com/pasky/pachi/tree/master/joseki) · [Pachi 许可原文](licenses/pachi.txt)
- KataGo 引擎和模型由用户单独下载。引擎主代码采用 MIT，所用的 `g170` 模型采用 CC0。[KataGo 引擎许可](https://github.com/lightvector/KataGo/blob/v1.18.1/LICENSE) · [KataGo 模型许可](https://katagotraining.org/network_license/) · [镜像来源](https://huggingface.co/salty-flower/weiqi-models/blob/4e432c4280c6a447c264084f825ee512e91a21e3/PROVENANCE.md)
