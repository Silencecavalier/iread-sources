# iread 书源库

iread 的书源库（GitHub Pages 静态站）。只放**规则文件**：不放正文、不放封面、不放书。

- 网页：给你看有哪些书源、一键复制地址
- `manifest.json`：给 iread 订阅的清单（每条带内容指纹 hash，客户端靠它判断有没有更新）
- `sources/*.json`：书源本体，一个文件一个源

---

## 线上地址（已部署）

- 浏览页：https://silencecavalier.github.io/iread-sources/
- 清单（推荐，jsDelivr）：https://cdn.jsdelivr.net/gh/Silencecavalier/iread-sources@main/manifest.json
- 清单（Pages 直连）：https://silencecavalier.github.io/iread-sources/manifest.json

iread 的「内置书源」插件 v1.1.1 起，默认就用上面第一条清单地址，装上插件即可看到这里的全部书源。

---

## 一、加一个书源（三步）

1. 把书源 JSON 丢进 `sources/`，文件名就是它的 id，例如 `sources/my-site.json`
2. （可选）在 `catalog.json` 里补一句描述、标签、版本号；不补也能生成，标题会自动取 `bookSourceName`
3. 跑一次生成脚本，然后提交：

```bash
node scripts/build-manifest.js
git add -A && git commit -m "add: my-site" && git push
```

生成脚本会顺手做校验，以下情况**直接报错退出**，不会把坏源发出去：

- 不是合法 JSON / JSONL
- 缺 `bookSourceUrl` 或 `bookSourceName`
- 既没有 `ruleSearch` 也没有 `ruleExplore`（装上也是搜不到）
- 和已有书源内容完全一样（重复）

一个文件里放多个书源也是可以的（JSON 数组或者一行一个的 JSONL），清单里会拆成多条。

## 二、发布（三条命令，只需一次）

```bash
git init && git add -A && git commit -m "init: iread 书源库"
git branch -M main
git remote add origin https://github.com/<你的用户名>/iread-sources.git
git push -u origin main
```

然后到 GitHub 仓库页面：

1. **Settings → Pages**
2. Build and deployment 的 **Source** 选 `GitHub Actions`
3. 推一次代码（或在 Actions 里点 `Run workflow`），等 1 分钟

线上地址就是 `https://<你的用户名>.github.io/iread-sources/`，
订阅地址是 `https://<你的用户名>.github.io/iread-sources/manifest.json`。

> 第一次部署前先去 Actions 页面把 workflow 启用一下（新仓库默认是开的，保险起见看一眼）。

如果你不想用 Actions，也可以把 Source 选成 `Deploy from a branch` → `main` / `(root)`，
因为 `manifest.json` 已经提交在仓库里了，静态托管直接就能用。

## 三、字段说明

`manifest.json`（自动生成，不用手改）：

| 字段 | 说明 |
|---|---|
| `schema` | 清单格式版本，现在是 `1` |
| `libraryHash` | 整库指纹：所有书源 `id:hash` 的汇总，变了说明库里有更新 |
| `generatedAt` | 生成时间 |
| `count` / `totalSize` | 书源数量 / 总字节数 |
| `groups` | 出现过的分组 |
| `sources[]` | 每个书源一条，见下表 |

| 条目字段 | 说明 |
|---|---|
| `id` | 文件名（不含 `.json`） |
| `name` / `title` | 名称（`title` 是 `catalog.json` 里的覆盖值） |
| `desc` | 描述，取自 `catalog.json` 或书源的 `bookSourceComment` |
| `group` / `tags` | 分组与标签，取自 `bookSourceGroup` + `catalog.json` |
| `site` | 站点域名 |
| `url` | 书源的 `bookSourceUrl` |
| `path` | 文件相对路径（客户端按这个下载） |
| `hash` | **内容指纹**：规范化 JSON 的 sha256 前 16 位。改一个字就变，客户端用它判断更新 |
| `version` | 人类版本号（`catalog.json` 里写），没写就用 hash 前 8 位 |
| `size` | 文件字节数 |
| `updatedAt` | 更新日期（`catalog.json` 里写，可空） |
| `minAppVersion` | 需要的最低 iread 版本，低于此版本的客户端应整条忽略 |

`catalog.json` 是唯一需要手工维护的东西，字段都在文件头的 `_说明` 里写着。

## 四、本地预览

```bash
node scripts/build-manifest.js
npx serve .            # 或者 python -m http.server 8000
```

然后打开 <http://localhost:3000/>（`npx serve` 的默认端口；用 python 就是 8000）。

不要直接双击 `index.html`：浏览器的 `file://` 限制会让它读不到 `manifest.json`。
想强制看某个主题可以加参数：`/?theme=dark` 或 `/?theme=light`。

## 五、注意

- 书源规则里可以带 `@js:` / `{{}}` 片段，等于**在用户机器上运行的代码**。所以这里每一条都算内容指纹、显示站点域名，更新前能先看 diff。
- 这个仓库只放规则。不要放抓下来的正文、封面、缓存文件。
- 有版权争议的站点规则可能被 GitHub 下架；真被下架了，把仓库挪到别处（或让用户自建），iread 里的订阅地址是可改的。

## 六、管理后台（本地网页，点鼠标就能管）

不想敲命令就用它：双击 `admin/启动管理后台.cmd`，浏览器会自动打开。

- 左栏列出全部书源，可搜索、按分组筛选；右栏改名 / 改分组 / 改描述 / 改版本与标签
- 「+ 添加书源」支持粘贴 JSON 或选文件（单个、数组、一包多源都行）
- 「删除这个书源」直接删 `sources/<id>.json` 并清掉 catalog 里的元数据
- 「生成清单并发布」= `build-manifest.js` → `git add/commit` → `git push origin main`，日志显示在弹窗里
- 只监听本机 `127.0.0.1`，地址带一次性令牌，关掉窗口即停止；零依赖，只要 Node.js（细节见 [admin/README.md](admin/README.md)）

改名字会同时改书源本体的 `bookSourceName` 和 `catalog.json` 的 `title`，内容指纹随之变化 → iread 的「内置书源」会显示「更新」；装的时候复用同一个 id，不会变成两条。

## 七、加速地址（国内访问慢就用它）

同一份 `manifest.json` 有四个可用地址，内容完全一样：

| 地址 | 说明 | 实测 |
|---|---|---|
| `https://raw.githubusercontent.com/Silencecavalier/iread-sources/main/manifest.json` | GitHub 原始文件，最快 | 0.76s |
| `https://gh-proxy.com/https://raw.githubusercontent.com/Silencecavalier/iread-sources/main/manifest.json` | gh-proxy 加速（raw 被墙时用） | 1.22s |
| `https://cdn.jsdelivr.net/gh/Silencecavalier/iread-sources@main/manifest.json` | jsDelivr 镜像，**有最长 12 小时缓存** | 1.90s（可能给旧清单） |
| `https://silencecavalier.github.io/iread-sources/manifest.json` | GitHub Pages 直连 | 3.61s |

「内置书源」插件 v1.1.4 起**页面上不用填地址**：默认走 gh-proxy 加速的 raw，失败自动换 raw 直连 → Pages，
三个地址并行比新旧，取最新的一份（jsDelivr 因 12 小时缓存不参与）。
