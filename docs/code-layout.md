# 代码结构

```text
server.py                    本地启动入口，命令保持不变
dashboard/
  assets.py                  三种运行方式共用的资源清单、顺序和 HTML 渲染
  server.py                  本机 HTTP 路由、WFM 请求与刷新任务
  features.py                商品目录、遗物掉落、紫卡与查询任务
  public_data.py             公共货单、历史行情合并与发布元数据
  portable.py                单文件快照导出
static/
  index.html                 共用页面模板
  css/style.css              页面样式
  js/
    app.js                   公共状态、库存表格和商品详情
    core/                    统计窗口、估值和交易决策计算
    pages/                   库存操作、奸商与杜卡德、遗物与紫卡、首页
    ocr/                     截图识别界面、文字匹配与依赖加载
    adapters/                Pages 快照读取、便携 HTML 适配
  ocr/                       未修改的第三方组件、模型、校验清单和许可证
scripts/
  check.py                   本地与 CI 共用的离线检查入口
  build_pages.py             公开站点构建
  refresh_market.py          定时刷新公开行情
tests/                       Python / JavaScript 测试和 OCR 名称样本
data/                        公共数据与本机配置，按 .gitignore 区分
docs/                        使用、计算口径、设计与维护说明
```

## 页面加载

前端保持普通浏览器脚本，没有打包器。`core` 先于主程序，OCR、页面和适配代码依赖前面的公共定义。不要只根据文件名调整加载顺序。

`dashboard/assets.py` 是资源清单的唯一维护入口：本地服务按清单开放静态路径，Pages 构建将同一组脚本复制为带内容哈希的文件，便携快照将脚本和样式内联到 HTML。页面模板只保留样式和脚本的插入标记。新增或移动脚本时，先更新清单，再运行 `python3 scripts/check.py`。

OCR 组件以页面地址定位 `ocr/v5/`，不依赖识别脚本所在的源码目录。便携快照仍从配置的公开站点下载依赖。`static/ocr/` 的文件参与完整性校验，不要用格式化工具改写，也不要把它们当作缓存删除。

## 构建与本机文件

- `_site/` 只放构建产物，不放源文件、库存或日志。构建先写临时目录，成功后整体替换，因此重复构建不会积累旧哈希文件；失败时保留旧站。
- 构建只导出代码和指定的公共数据。旧输出里意外残留的私有文件也不会带入新站；个人配置不参与公开构建。
- 公共商品、遗物、货单映射及行情种子保留在 `data/`；定时查询结果还会使用 Actions Cache。不要因为文件体积大就删除目录数据或 OCR 模型。
- `data/initial_holdings.json`、`data/settings.json`、日志、分享 HTML 和截图属于本机文件，不提交。需要整理时，将无法确认可重建的原始数据和个人导出先移到仓库外归档。
- `__pycache__/`、`.ruff_cache/` 和 `_site/` 都可以删除重建。统一检查入口不生成 Python 字节码缓存。

## 验证

`python3 scripts/check.py` 运行 unittest 测试集。其中 `test_frontend.py` 检查所有项目 JavaScript 的语法，并分进程运行各组 JavaScript 测试，因此现有 CI 入口也会执行完整检查。测试覆盖统计与交易计算、OCR 匹配和生命周期、依赖完整性、本地资源路由、快照导出和重复构建。

变更加载路径后，还应在本地服务和 Pages 预览中分别确认页面能打开，并检查截图导入后的模型地址。部署后以线上 HTML 实际引用的哈希文件核对内容。
