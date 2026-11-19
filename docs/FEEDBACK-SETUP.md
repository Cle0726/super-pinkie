# 正式版反馈收集配置说明（给作者的操作步骤）

正式版内置了「使用场景 + 纠错类型摘要」反馈功能（默认关闭，用户点同意后才开启；开发版永远不会联网上传）。

为了在没有服务器的情况下把反馈安全收到你手里，并且**就算安装包被人拆开也看不懂别人发来的内容**，需要你亲手做下面这几步（**令牌和私钥千万不要发给 AI，也不要放进代码仓库**）。

---

## 第一步：在 GitHub 新建一个私有仓库专门收反馈

1. 打开 GitHub，点右上角 `+` → `New repository`。
2. 仓库名填 `pinkie-feedback`（名字随意，后面配置一致即可）。
3. **一定要选 `Private`（私有）**，点创建。

---

## 第二步：生成一个只给这个仓库用的细粒度令牌（Fine-grained Token）

1. 打开 GitHub 右上角头像 → `Settings` → 左侧最下面 `Developer settings` → `Personal access tokens` → `Fine-grained tokens` → `Generate new token`。
2. 名字填 `super-pinkie-feedback-upload`，过期时间建议选 90 天或半年（以后每次发新版都可以换新令牌，旧的随时能作废）。
3. **Repository access** 选 **`Only select repositories`**，只勾你刚建的 `pinkie-feedback` 这一个仓库。
4. **Permissions（权限）** → 点开 `Repository permissions`：
   - 只把 **`Contents`** 改成 **`Read and write`**（GitHub 上传新文件需要这一项）。
   - 其他所有权限全部保持 **`No access`**。
5. 点生成，把生成的令牌先复制好（页面关掉后就看不到了）。

---

## 第三步：在你自己电脑上生成加密用的「公钥 + 私钥」

在项目目录下运行这一条命令：

```bash
node tools/feedback/read.mjs keygen
```

它会把私钥存到 `~/.config/super-pinkie/feedback-private.pem`（只在你这台电脑上，别删也别传给别人），并在屏幕打印出一串一行的**公钥**。

---

## 第四步：把仓库名、公钥和令牌填进源码仓库的 GitHub Actions 配置

打开**主源码仓库**（`super-pinkie`）的页面 → `Settings` → `Secrets and variables` → `Actions`：

1. 在 **`Secrets`**（密钥）里点 `New repository secret`，新建两条：
   - 名字 `PINKIE_FEEDBACK_TOKEN` → 填第二步生成的细粒度令牌
   - 名字 `PINKIE_FEEDBACK_PUBLIC_KEY` → 填第三步打印出来的那一行公钥
2. 在 **`Variables`**（变量）里点 `New repository variable`，新建一条：
   - 名字 `PINKIE_FEEDBACK_REPO` → 填 `<你的GitHub用户名>/pinkie-feedback`（例如 `Cle0726/pinkie-feedback`）

之后每次通过 GitHub Actions 打包正式版时，配置会自动写进正式安装包并参与签名校验。如果某天想让旧版本停止上传，直接去 GitHub 把对应的旧令牌作废即可。

---

## 第五步：随时在你自己电脑上解密看汇总报告

运行一条命令就能把私有仓库拉下来、用本机私钥解开，并在屏幕打印汇总（或生成一页网页报告）：

```bash
# 直接在终端看汇总
node tools/feedback/read.mjs --repo <你的GitHub用户名>/pinkie-feedback

# 导出成一页能在浏览器打开的报告
node tools/feedback/read.mjs --repo <你的GitHub用户名>/pinkie-feedback --html ~/Desktop/pinkie-feedback-report.html
```

---

## 可选升级：以后想用 Cloudflare Workers 免费中转

如果以后用户多起来、担心令牌限流或不想把 GitHub 令牌放进安装包，可以在 Cloudflare Workers（免费额度即可）放一个小中转接口把令牌留在服务端；只要在主仓库 `Variables` 里加上 `PINKIE_FEEDBACK_RELAY_URL`（填你的 Workers HTTPS 地址），客户端上传层已经写好会自动改走中转，不用改其余代码。
