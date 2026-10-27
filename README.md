# 虚空账本 · Warframe Market Dashboard

Warframe 国际服 PC 行情看板：库存管理、Prime 与奸商 MOD 趋势分析、零洗紫卡挂单参考及遗物掉落比价。

**在线使用：[vizards8.github.io/warframe-market-dashboard](https://vizards8.github.io/warframe-market-dashboard/)**

## 功能

- **持仓与关注分开**：全局添加库存，762 种目录商品支持中英文 / 别名搜索；目标观察依据可选卖单、买单或固定 30 天均价，不随图表窗口变化。旧价与失败不判断达线。
- **买卖与撤销**：记录买入、卖出和数量校正，按记录顺序先入先出计算已知成本差额；未知成本不算利润。自用保留、参考成本、持有天数、交易备注和备份迁移。
- **奸商补仓**：自动读取 DE 官方本次货单和兑换成本，直接展示武器、活跃 Prime MOD 的购买参考，按历史毛回款 / 百杜卡德或成交记录量排序。预算和补货计划为可选项；自动来源失败时才需手动核对。并非全部历史奸商武器目录。
- **杜卡德收货**：默认按 150D / 笔筛选，支持 33 笔 / 日的低门槛计划；按同一卖家组合整套和多个散件，最多占 6 槽，并用频道垃圾价基准比较白金 / 百杜卡德成本。
- **核桃准备 / 战斗视图**：四人同核桃、统一精炼、最多 12 个常用组合；战斗视图默认金银铜固定位置，保留部位全名、图片、价格时间；手机用单列显示。
- **网页奖励 OCR（试用）**：共享游戏画面后点击按钮在浏览器本机识别一次（无自动循环），或粘贴 / 导入截图；四格按游戏顺序比价，支持中英名称修正及可选悬浮价格窗。默认定位居中奖励卡、提取蓝字并拼接换行名称，支持手动校准。无需客户端或扩展，截图不上传；可提前准备模型，国内镜像与本站自动换源，校验后缓存。已有一张真实四人截图回放，其他 UI 布局仍需校准。见 [网页 OCR 使用说明](docs/reward-ocr.md)。
- **Prime 散件凑套**：51 套战甲配方，扣除自用保留后计算可凑套数、缺件，并比较整套与散卖报价情景。
- **零洗紫卡**：搜索全武器池，明确已覆盖、未查询、小样本与旧价；热门候选较频繁更新，其余分批轮询，未知不代表低于 20p。
- **趋势与数据状态**：7 / 30 / 90 天量加权成交均价；公开日均价随成功部署积累，最多保留 730 天，不补造过去曲线。显示行情年龄、失败和覆盖情况。
- **个人赚钱效率**：用自己的路线、用时与收入计算报价折算 / 实际卖出 p/h，配置和交易用时可写备注，不提供未经验证的全服排行榜。

详细范围、验证与限制见 [V2 交付说明](docs/v2-release.md)。

## 在线版与本地版

| | GitHub Pages 在线版 | 本地 Python 服务版 |
|---|---|---|
| 使用 | 直接访问上方网址 | 启动后访问 `http://127.0.0.1:18765/` |
| 行情 | GitHub Actions 约每 6 小时更新 | 按需查询 WFM |
| 刷新按钮 | 获取最新已发布快照 | 发起商品行情查询 |
| 紫卡 | 热门候选较频繁更新，其余每次轮询 20 种；可跳转 WFM | 可逐个查询全部武器 |
| 遗物掉落 | 定时查询所有不同的可交易奖励 | 按选定的四遗物查询 |
| 库存 | 保存在当前浏览器，不上传 | 保存在当前浏览器，不上传 |

GitHub Pages 是静态托管，不能运行常驻 Python 后端。Actions 定时抓取公开数据后部署静态文件，因此用户不必运行本机服务。在线版不是即时行情：GitHub 调度可能延迟；长期无仓库活动时定时任务也可能被平台停用。价格以各商品显示的查询时间为准，缺价保留“待查询”，失败保留旧值和原时间。

库存、交易、补货计划和核桃组合不会自动跨设备同步。从本地版搬到在线版，或换浏览器：点击“备份库存”，在新页面点击“导入库存”。文件只在浏览器读取，不上传。导入前验证内容，更新同名商品及其账本，保留其他当前记录；支持撤销。旧备份没有交易记录时，同名商品的现有账本会清除，后续重新建立期初库存。公开版本初始库存为空。

## 本地运行

需要 Python 3.10+ 和 `curl`，无第三方 Python 依赖。

```sh
git clone https://github.com/Vizards8/warframe-market-dashboard.git
cd warframe-market-dashboard
python3 server.py
```

macOS 也可双击 `打开行情.command`，Windows 可双击 `打开行情.bat`（需 `python` 已加入 PATH）。服务只监听 `127.0.0.1`。仅启动服务、不自动打开浏览器：

```sh
python3 server.py --serve
```

## 部署到自己的 GitHub Pages

1. 在自己的仓库进入 **Settings → Pages → Source → GitHub Actions**。
2. 推送到 `main` 会执行 `.github/workflows/pages.yml`。首次部署使用仓库现有公共快照，避免等待全量抓取。
3. 定时任务每 6 小时刷新；也可以在 **Actions → Publish market dashboard → Run workflow** 手动运行。默认更新行情后部署，约需 15 分钟；取消 `refresh` 可直接部署当前缓存。

工作流只需内置 `GITHUB_TOKEN` 的 Pages 部署权限，不需要 WFM 账号、第三方代理或自建服务器。公开行情缓存保存于 Actions Cache，不逐次提交 Git 历史。长期日均价从上次公开部署读取、合并后随站点发布；读取失败（首次 404 除外）会停止发布，避免截断历史。网络失败保留旧值并显示错误，不更改旧数据时间；全部请求失败时不部署。

公开构建只导出允许的代码和公共数据，不打包 `data/initial_holdings.json`、`data/settings.json`、个人 HTML、日志、截图或浏览器数据。这些路径在 `.gitignore` 中排除。

## 本地构建与验证

```sh
python3 scripts/check.py
python3 scripts/build_pages.py
python3 -m http.server 18866 --bind 127.0.0.1 --directory _site
```

`scripts/check.py` 运行与 GitHub Actions 相同的 unittest 测试集。其中 `test_frontend.py` 检查前端语法，并分进程运行各组 JavaScript 测试，不访问外部行情接口。

`_site` 是可删除重建的 Pages 产物。构建先在临时目录完成，成功后替换旧站点，旧脚本和遗留文件不会混入新发布；失败时保留上次构建。自定义输出可用 `--output /tmp/void-ledger-site`，已有的非站点目录会拒绝覆盖。`scripts/refresh_market.py` 负责限速查询公开行情，通常无需在本地手动执行。

## 代码目录

- `dashboard/`：本地服务、行情计算、公共数据和 HTML 快照；根目录 `server.py` 保留启动入口。
- `static/js/`：主程序，以及 `core` 计算、`pages` 页面、`ocr` 识别、`adapters` 在线版和快照适配。
- `static/css/`：页面样式；`static/ocr/`：固定版本的第三方 OCR 资源与许可证。
- `scripts/`：检查、行情更新和 Pages 构建；`tests/`：计算、识别、路由与导出测试。
- `data/`：公共目录与行情快照；个人库存、设置和日志仍被 Git 排除。

三种运行方式共用 `dashboard/assets.py` 的资源清单和脚本顺序。详细依赖与维护步骤见 [代码结构](docs/code-layout.md)。

整理代码格式（只供开发维护，网页用户无需安装）：

```sh
npx --yes prettier@3.6.2 --write 'static/js/**/*.js' static/css/style.css static/index.html 'tests/*.js'
uvx --from ruff==0.14.2 ruff format dashboard server.py scripts tests
```

## 统计口径与来源

- [Warframe Market](https://warframe.market/)：PC 市场的公开可见在线 / 游戏中 R0 买卖单；成交统计是用户标记记录，并非全服交易总量，也不是保证成交价。
- 7 / 30 / 90 天均价按各商品快照截止日计算，成交量加权；缺少记录的日子不补零。WFM 只提供近 90 天，无法计算完整的前 90 天环比。
- 紫卡候选按已覆盖报价重选，种子候选来自 2026-10-19 扫描；并非实时全市场排名。其余未显示不能理解为低于 20p；不同词条的紫卡不能用同一成交均价估算。
- [WARFRAME Wiki 历史货单](https://wiki.warframe.com/w/Baro_Ki%27Teer/Trades)：兑换成本及常规返场记录，核对于 2026-10-21，历史目录和返场日期不会自动更新。本次货单优先从 [DE 官方公开世界状态](https://api.warframe.com/cdn/worldState.php) 获取，使用 [WFCD warframe-items](https://github.com/WFCD/warframe-items) 的精确物品路径映射和已核实的备用名称别名（`data/baro_item_names.json`），备用来源为 WarframeStat。官方返回的未知物品不会模糊匹配为已知商品；目录外外观等商品可在 Wiki 完整货单查看。随 GitHub 定时发布更新，6 小时内快照才用于购买参考；来源均失败时可手动核对（48 小时失效）。近期供应、TennoCon 与特别活动都可能压价，历史均价不保证未来回款。
- [WFCD / Warframe Items](https://github.com/WFCD/warframe-items)：遗物目录及备用图片，目录核对于 2026-10-21，后续新物品需更新。

代码沿用 [MIT License](LICENSE)。Wiki 派生数据（`data/baro_wiki.json` 及目录里的奸商货单字段）依据来源的 **CC BY-NC-SA 3.0** 使用，保留来源及相同方式共享要求；第三方数据和游戏图片不因本项目 MIT 许可而重新授权。Warframe 为 Digital Extremes 的商标，本项目非官方。

### 启航首页

新用户从首页选择库存、奸商补仓或四遗物助手；已有持仓默认进入工作台。侧栏品牌可随时回首页，首页也提供交易账本入口。

库存通过页面手动添加和修改，交易记录由本人填写。本项目不连接 WFM 账号、不读取个人挂单，也不代为改价或上下架；WFM 用于公开行情和查价跳转。
