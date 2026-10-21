# 虚空账本 · Warframe Market Dashboard

Warframe 国际服 PC 行情看板：库存管理、Prime 与奸商 MOD 趋势分析、零洗紫卡挂单参考及遗物掉落比价。

**在线使用：[vizards8.github.io/warframe-market-dashboard](https://vizards8.github.io/warframe-market-dashboard/)**

## 功能

- 库存行内增减、目标价、成本与笔记，浏览器自动保存。
- 7 / 30 / 90 天成交量加权均价、记录量及 90 天趋势。挂单与成交记录分别标注查询时间。
- Prime 战甲套装及 88 种历史奸商可交易 MOD；查看返场日期、杜卡德与现金成本，勾选当次货单比较补仓成本。
- 0 洗紫卡按武器家族比较不同卖家的公开直售挂单。零洗不等于零级，挂价不等于成交价。
- 预先选择四个遗物、精炼等级，对照六种掉落与价格；支持金银铜顺序和全屏对照。

## 在线版与本地版

| | GitHub Pages 在线版 | 本地 Python 服务版 |
|---|---|---|
| 使用 | 直接访问上方网址 | 启动后访问 `http://127.0.0.1:18765/` |
| 行情 | GitHub Actions 约每 6 小时更新 | 按需查询 WFM |
| 刷新按钮 | 获取最新已发布快照 | 发起商品行情查询 |
| 紫卡 | 定时更新历史高价候选；其余可跳转 WFM | 可逐个查询全部武器 |
| 遗物掉落 | 定时查询所有不同的可交易奖励 | 按选定的四遗物查询 |
| 库存 | 保存在当前浏览器，不上传 | 保存在当前浏览器，不上传 |

GitHub Pages 是静态托管，不能运行常驻 Python 后端。Actions 定时抓取公开数据后部署静态文件，因此用户不必运行本机服务。在线版不是即时行情：GitHub 调度可能延迟；长期无仓库活动时定时任务也可能被平台停用。价格以各商品显示的查询时间为准，缺价保留“待查询”，失败保留旧值和原时间。

库存不会自动跨设备同步。从本地版搬到在线版，或换浏览器：点击“备份库存”，在新页面点击“导入库存”。文件只在浏览器读取，不上传。导入更新同名商品，保留其他当前记录。公开版本初始库存为空。

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

工作流只需内置 `GITHUB_TOKEN` 的 Pages 部署权限，不需要 WFM 账号、第三方代理或自建服务器。公开行情缓存保存于 Actions Cache，不逐次提交 Git 历史。网络失败保留旧值并显示错误，不更改旧数据时间；全部请求失败时不部署。

公开构建只导出允许的代码和公共数据，不打包 `data/initial_holdings.json`、`data/settings.json`、个人 HTML、日志、截图或浏览器数据。这些路径在 `.gitignore` 中排除。

## 本地构建与验证

```sh
python3 -m unittest discover -s tests -v
node tests/test_stats.js
python3 scripts/build_pages.py
python3 -m http.server 18866 --bind 127.0.0.1 --directory _site
```

`_site` 是 Pages 发布产物。`scripts/refresh_market.py` 会查询全部目录商品、遗物奖励和紫卡候选，使用限速与重试；通常无需在本地手动执行。

## 统计口径与来源

- [Warframe Market](https://warframe.market/)：PC 市场的公开可见在线 / 游戏中 R0 买卖单；成交统计是用户标记记录，并非全服交易总量，也不是保证成交价。
- 7 / 30 / 90 天均价按各商品快照截止日计算，成交量加权；缺少记录的日子不补零。WFM 只提供近 90 天，无法计算完整的前 90 天环比。
- 紫卡候选池来自 2026-10-19 扫描，并非实时全市场排名。其余未显示不能理解为低于 20p；不同词条的紫卡不能用同一成交均价估算。
- [WARFRAME Wiki 历史货单](https://wiki.warframe.com/w/Baro_Ki%27Teer/Trades)：兑换成本及常规返场记录，核对于 2026-10-21。目录和返场日期不会自动更新；TennoCon 也会增加供应。最近返场不等于当前在售，长期缺货不保证上涨。
- [WFCD / Warframe Items](https://github.com/WFCD/warframe-items)：遗物目录及备用图片，目录核对于 2026-10-21，后续新物品需更新。

代码沿用 [MIT License](LICENSE)。Wiki 派生数据（`data/baro_wiki.json` 及目录里的奸商货单字段）依据来源的 **CC BY-NC-SA 3.0** 使用，保留来源及相同方式共享要求；第三方数据和游戏图片不因本项目 MIT 许可而重新授权。Warframe 为 Digital Extremes 的商标，本项目非官方。
