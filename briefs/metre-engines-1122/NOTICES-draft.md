# 第三方许可声明（草稿）

给碧琪「关于」页用的草稿。**已经放进去了**（11-23）：设置「关于与更新」最后一行「第三方许可」→「查看」，正文在 `ui/injections/laolao-metre-engine.js` 的 `NOTICES` 段（以那里为准，比这份多一段「更多引擎」）。这是整个项目里唯一可以写这两个项目原名的地方：MIT 许可证要求保留原作者的版权和许可声明；界面和其他文档里一律只说「引擎服务」。

---

## 中文

**引擎服务**

Metre「外部引擎」用到的引擎服务是 T3 Code（https://github.com/pingdotgg/t3code）的官方发布包，固定版本，未经修改。T3 Code 按 MIT 许可证发布，许可证全文见下方「MIT 许可证全文」。

**功能设计借鉴**

Metre 的放手程度分级（审批分级）、乐手（把机器人当成联系人）和「看它干活」这几项设计，借鉴了 OpenMausBot（https://github.com/milind-soni/OpenMausBot）。OpenMausBot 按 Apache-2.0 许可证发布（`enterprise/` 目录除外，那部分不是开源许可）。我们只借鉴了功能和交互设计：没有复制它的 `enterprise/` 目录，也没有搬它的代码。

---

## English

**Engine service**

The engine service used by Metre's external engines is the official, unmodified release package of T3 Code (https://github.com/pingdotgg/t3code), pinned to a fixed version. T3 Code is distributed under the MIT License; the full license text is reproduced below under "MIT License (full text)".

**Design inspiration**

Several Metre features — tiered approval levels, players (bots as contacts), and watching an agent work — were inspired by the design of OpenMausBot (https://github.com/milind-soni/OpenMausBot), which is licensed under the Apache License 2.0 (except for its `enterprise/` directory, which is not open source). We borrowed only the feature and interaction design: nothing from its `enterprise/` directory was copied, and no OpenMausBot source code is included.

---

## MIT 许可证全文 / MIT License (full text)

```
MIT License

Copyright (c) 2026 T3 Tools Inc.

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
```

---

## 核对记录（11-23）

- 版权行和 MIT 全文：和 T3 Code 仓库 v0.1.11 标签下的 `LICENSE` 逐字对过，一致（本机只读源码 `F:\t3probe\src\t3code`，`git show v0.1.11:LICENSE`）。
- 关于页不写版本号：版本只在 `engines.mjs` 的 `T3_VERSION`，升级时不用改许可文字。
- OpenMausBot 没搬代码，Apache-2.0 第 4 条的 NOTICE 要求用不上，这一段算致谢，不附 Apache-2.0 全文。
