# 奸商兑换成本

核对日期：2026-11-11。

目录保存 28 种 WFM 可交易奸商武器和 88 种 MOD 的固定杜卡德、现金成本。
未在 WFM 商品目录中的武器不加入交易榜；外观、消耗品和守护不计入武器数。
当期货单有匹配商品时，网页优先使用当期兑换价；非本期商品使用目录成本。
手动填写的成本仍可覆盖目录参考值。

## 来源

- [Wiki 的 Baro 数据模块](https://wiki.warframe.com/w/Module:Baro/data)。本次 Wiki 直连返回 403，使用下面保存的镜像。
- [2026-11-06 Wiki 抓取快照](https://github.com/erez252/warframe-baro-history/blob/8cf585ad88302f098cb50abb08f42cb931b08eb8/data/warframe_data.json)：包含商品分类、杜卡德、现金成本和历次返场日期。
- [2025-07 TennoCon 货单样本](https://github.com/aldi-f/jeff-discord/blob/29ee299827cf2082dc8b1f55c48e24facf40be18/json_tests/full_baro_json_wfcd.json)：社区保存的世界状态接口响应，作为交叉对照；不是本次直接向 DE 查询所得。
- [较早 Wiki 数据模块镜像](https://github.com/420gaming420/wf-wiki-module-data/blob/ba4eb7ab0f039763160aa9dee83bc96f7a8da820/lua/Module-CroqueTest-BKT_0.lua)：只用于历史对照，不把其中最后一次返场日期当作抓取日期。

2025 样本与 2026 快照同名匹配的 25 种武器，杜卡德和现金成本全部一致。
较早 Wiki 模块中能同名匹配的武器成本也一致。本次未发现武器调价记录；这些样本不能证明所有商品从未调过价。
固定成本适合用于长期囤货比较，购买时仍以游戏内本期货单为准。

## 为什么之前缺成本

初始武器目录只录入了奸商标记，兑换成本保留为空。
`baro_wiki.json` 中保存的历史表只有 MOD；武器成本没有从这张表补入。
当前货单仅在对应活动期间覆盖页面中的成本，没有补齐历史武器目录。
因此有成交记录的武器也无法计算每 100D 回款，并被统一显示为“数据不足”。

本次将武器成本、来源、来源快照时间和返场日期保存到 `data/catalog.json`，不依赖奸商正在到访。
新增或补标记的 11 种武器进入现有挂单、成交统计定时采集范围。
缺成本、成交统计缺失、高位样本不足、波动不足分别给出原因。
