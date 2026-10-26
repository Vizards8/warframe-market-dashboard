# V2 玩家使用流程交付

日期：2026-10-21。对应 [玩家方案](player-improvement-v2.md)。现有站点就地升级，不改变浏览器库存存储键，不上传个人数据。

## 需求与实现地图

| 使用任务 | 主要文件 | 核验 |
| --- | --- | --- |
| 持仓、关注、全局添加与独立观察依据 | `static/js/app.js`、`static/js/pages/desk.js`、`static/js/core/desk-core.js` | UI 添加、买卖、撤销；新鲜度和依据单测 |
| 库存买卖与成本 | `static/js/pages/desk.js`、`static/js/core/desk-core.js` | FIFO、多批成本、未知成本、数量校正不当收入、保留数量 |
| 奸商货单与预算 | `dashboard/public_data.py`、`static/js/pages/desk.js` | 接口失败保留旧时间；手动核对失效；部分未知兑换成本不虚算完整合计 |
| 战斗查核桃与常用组合 | `static/js/pages/extras.js`、`static/css/style.css` | 四人同核桃、统一光辉、保存组合、退出恢复排序；1366×768 与 390×844 检查 |
| 散件凑套 | `data/prime_sets.json`、`static/js/pages/desk.js` | 51 套配方引用验证；导入四散件各 2 / 保留 1 后显示 1 套 |
| 备份及回滚 | `static/js/pages/inventory.js`、`static/js/core/desk-core.js` | UI 下载 / 导入 / 撤销；非法数量、账本数量不一致拒绝 |
| 紫卡轮询 | `scripts/refresh_market.py`、`scripts/build_pages.py`、`static/js/pages/extras.js` | 原有样本去重、0 洗与等级区分测试；候选从已覆盖报价重选 |
| 长期日均价 | `dashboard/public_data.py`、`scripts/build_pages.py` | 旧数据保留、新修正优先、旧 seed 不覆盖新历史、私有键剔除、当日未完结数据剔除 |
| 个人路线效率 | `static/js/pages/desk.js` | 手动记录实际游玩分钟、报价折算、已售收入及成本；独立页面与备份 |
| 公开导出与本地兼容 | `scripts/build_pages.py`、`server.py`、`dashboard/portable.py` | 输出白名单、不读取个人文件、JS/Python 语法与现有便携构建测试 |

`data/catalog.json` 的大量变动主要来自目录从 143 扩到 762 条和元数据，不是交易逻辑。新增的 Prime 部位为可交易蓝图；Prisma / Vandal / Wraith 变体仅作可交易目录，只有有来源标记的商品进入奸商补仓列表。未确认武器不推断为奸商商品。

## 价格与记账口径

- 观察线独立选择在线最低卖单、最高买单、30 天成交均价；数据超过 6 小时或失败即不判断。买卖单最多前 10 条，只对可覆盖数量求和。
- 账本按录入顺序先入先出。日期用于显示已记录买入批次的持有天数，补记日期不自动重排账本。期初、校正新增库存的购买日未知。
- 参考成本不是对历史交易的改写。已实现差额仅包含可追溯白金成本，不含交易税、资源时间和交易等待；资源兑换可写备注，白金成本不明应留空。
- 导入更新同名商品和账本，其余保留；旧版无账本的备份会清除同名当前账本，后续重建期初。最近 20 次库存 / 交易操作可撤销，刷新页面后撤销栈清空。
- 买单、套装拆卖、奸商资源净差均为报价或历史售价情景，不是保证收入。数量校正、购买计划不当作买入 / 卖出。

## 已知限制与后续

- 本机访问世界状态接口及 Wiki 返回 403；GitHub 发布环境已经成功获取世界状态，线上核验为“尚未到访”。到访后尝试获取实际货单，接口失败或过期时显示待核对，允许按游戏手动核对，48 小时后失效。尚未验证到访期间的实际完整货单覆盖。
- 奸商目录包含 88 种 MOD 与 16 种已标记武器，并非全部武器。新增目录中部分武器尚无自动报价；首次更新前散件可能缺价。
- 每次定时更新对主要目录抓订单与统计，对所有不同遗物奖励抓订单；紫卡高价候选与种子较频繁抓取，其余 20 武器 / 次轮询。约 420 种武器理想情况下约 5.25 天轮一遍，调度失败可能延长。
- 长期历史保留真实可得记录日，最多 730 天。当前主要从已获取的近 90 天起步；未补造一年行情，也未实现常规 / TennoCon / 重生活动自动图上标注。
- 核桃已做布局和功能验证；尚未进行十轮真实游戏开奖计时，因此不宣称“两秒选完”已达标。
- 个人赚钱效率为手动实测表，尚未加入游戏配装清单和自动路线推荐。交易等待写备注，不包含于默认游玩时间分母。
- 跨设备同步未上线：继续使用浏览器自动保存与备份。没有把个人库存提交到公开仓库，也未建立账号服务。

## 验证命令

```sh
python3 -m unittest discover -s tests -v
node tests/test_stats.js
node --check static/js/app.js
node --check static/js/core/desk-core.js
node --check static/js/pages/desk.js
node --check static/js/pages/extras.js
node --check static/js/pages/inventory.js
python3 scripts/build_pages.py
git diff --check
```

Python 共 11 项测试；Node 覆盖统计口径和玩家记账 / 预算 / 备份边界。真实行情采集由部署后的定时任务继续执行，接口可用性与发布时间以线上状态为准。
