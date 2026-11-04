# 管理后台（本地网页）

给书源库用的**本机管理工具**：在浏览器里点鼠标就能改名、改分组、加书源、删书源、生成清单并发布，不用再记命令。

- 只在本机跑：`127.0.0.1`，不对外开端口
- 带一次性令牌：地址形如 `http://127.0.0.1:8131/?t=<随机串>`，别人拿到这个地址也用不了（关了窗口就失效）
- 零依赖：只要 Node.js（18+），没有任何 npm 包

## 怎么启动

Windows 直接双击本目录里的 **`启动管理后台.cmd`**，浏览器会自动打开管理界面。

命令行也行：

```bash
cd D:\DSHWork\iread-sources
node admin/server.js            # 默认 8131 端口，自动开浏览器
NO_OPEN=1 node admin/server.js  # 不想自动开浏览器
PORT=8140 node admin/server.js  # 换端口
```

关掉那个窗口 = 停止服务。

## 界面能干什么

| 区域 | 功能 |
| --- | --- |
| 顶栏 | 库版本、书源数量、清单是否最新、未提交/待推送；「重新检查」「+ 添加书源」「生成清单并发布」 |
| 左栏 | 搜索（名称 / id / 分组 / 域名 / 标签）、按分组筛选 |
| 右栏 | 名称（写进书源 `bookSourceName`）、分组、描述、版本号、标签；「查看 / 编辑原始 JSON」「删除这个书源」 |
| 添加 | 粘贴 JSON 或选文件，支持单个、数组、一包多源；id 留空自动按域名生成 |
| 发布 | 依次跑 `build-manifest.js` → `git add/commit` → `git push origin main`，日志直接显示在弹窗里 |

改名字会同时改 `sources/<id>.json` 的 `bookSourceName`（插件按它显示）和 `catalog.json` 的 `title`——内容指纹随之变化，插件那边就会显示「更新」，本地源用的是同一个 id，不会多出一条。

## 校验口径

点「重新检查」会调用 `node scripts/build-manifest.js --check`，红色提示直接给在顶栏和对应条目上：缺 `bookSourceUrl`、缺 `bookSourceName`、`ruleSearch` 与 `ruleExplore` 都没有、内容重复、清单过期。

## 接口（想脚本化时用）

所有 `/api/*` 都要带 `X-Admin-Token: <令牌>`（令牌印在启动窗口的地址里）：

| 方法 | 路径 | 作用 |
| --- | --- | --- |
| GET | `/api/health` | 探活（不需要令牌） |
| GET | `/api/state` | 全部书源 + 校验结果 + git 状态 |
| GET | `/api/source?id=` | 某个书源的原始 JSON |
| POST | `/api/update` | `{id, fields:{name,group,desc,version,tags,featured}}` |
| POST | `/api/add` | `{text:"<书源 JSON>", id?}` |
| POST | `/api/delete` | `{id}` |
| POST | `/api/build` | 只重新生成清单 |
| POST | `/api/publish` | `{message}` 生成清单 + 提交 + 推送 |

## 注意

- 这个目录**不会**被发布到 GitHub Pages（`.github/workflows/pages.yml` 只复制站点文件到 `_site`）。
- 别把令牌、`.env` 之类敏感文件放进仓库。
