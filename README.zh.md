# dsh-block-placeholder-edits

[English](README.md) | 中文

模型有个会悄悄毁掉文件的习惯：懒得重写的代码，它就用 `// ... existing code ...` 代替，而编辑工具会照字面写进去。原来四十行真代码的地方，现在只剩一行注释。等你发现时构建已经挂了，更糟的是构建根本没挂。

这个 [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness) 插件会在每次 `write` 和 `edit` 落地之前检查一遍。如果新内容用占位注释代替了代码，或者整文件重写丢掉了一个大文件的大半内容，这次调用会被拒绝，文件保持原样。模型会被告知具体是哪一行有问题（提示是英文的，模型能看懂）：

```
dsh-block-placeholder-edits blocked this edit to src/app.ts: the new text contains
placeholder comments that stand in for code instead of the code itself. Writing them
would delete whatever they replace.
  line 2: // ... rest of the function unchanged
Fix: write out the full code in place of each placeholder, or use a smaller `edit`
that replaces only the lines you are changing (old_string/new_string) so untouched
code stays as it is.
```

实际用下来，模型对这个提示反应不错：它会改用范围更小的 `edit`，或者老老实实把代码写完整。

## 安装

```sh
dsh plugin --profile web add dsh-block-placeholder-edits
```

这里用的是 `web` 配置（profile），也就是用 `dsh web` 打开的浏览器界面。如果你用别的方式运行 DSH，就换成 `headless`（脚本和 CI）或 `acp`（编辑器集成）。每个配置有自己的插件列表，你用到哪个就装到哪个。装好就生效。卸载用 `dsh plugin --profile web remove dsh-block-placeholder-edits`。

### 从源码安装

想试本地改动的话，打个包再装：

```sh
git clone https://github.com/acus9345/dsh-block-placeholder-edits
cd dsh-block-placeholder-edits
npm install
npm pack
dsh plugin --profile web add ./dsh-block-placeholder-edits-0.2.0.tgz
```

## 什么算占位符

指的是这样的注释：用任何常见注释写法（`//`、`#`、`/* */`、`<!-- -->`、`--`、`;`、JSX 的 `{/* */}`），说的是代码，而不是代码本身：

```
// ... existing code ...
# rest of the file unchanged
/* ... */
// keep the rest as is
// ... other methods
{/* ... */}
```

单独一行 `...` 也算，但在 Python、Markdown 等 `...` 有实际含义的文件里除外。

普通注释会放行，提到"已有代码"的注释也一样。旧内容里本来就有的占位符不算，所以插件不会因为文件原本就带一个而去烦模型。

第二项检查针对整文件的 `write`。如果一个 40 行以上的文件被替换成不到原来一半的行数，这次写入会被拒绝。这种情况几乎总是模型凭记忆重写了文件，漏掉了一大块。局部修改不受这项检查影响，新文件也不受影响。

## 模型是有意的怎么办

有时候删掉文件的大部分就是目的。模型会被告知，可以把同样的调用原样重发一次来确认，第二次会放行。这样真正的重构不会被卡住，但模型必须是有意这么做。如果你想让人来决定，就设 `mode: ask`。

## 设置

最简单的办法：在 DSH 侧边栏打开 **插件**，点 **dsh-block-placeholder-edits**，改好后点 **保存**。下一次工具调用就生效，不用重启。

或者在 `~/.dsh/profiles/<profile>/cordis.patch.yml` 里加一行这样的配置（只影响一个配置），或者加到 `~/.dsh/cordis.patch.yml`（影响所有配置）。没写的项保持默认值。

```yaml
- id: block-placeholder-edits
  config:
    mode: deny                 # 或 `ask`，改为弹出审批
    shrinkRatio: 0.5           # 0 关闭大段删除检查
    minLinesForShrink: 40      # 比这短的文件不做删减检查
    allowIdenticalRetry: true  # false：拒绝后不能再重试通过
    extraPatterns: []          # 额外的正则，匹配你自己的占位写法
    ignore: ['docs/**']        # 完全跳过的 glob
```

## 开发

```sh
npm install
npm test           # 检测逻辑的单元测试
npm run test:e2e   # 用脚本模拟的本地模型跑真实的 dsh，不需要 API Key
```

安装测试会执行 `dsh plugin add`，需要 PATH 里有 `pnpm`。

MIT 许可。作者 [acus9345](https://github.com/acus9345)。欢迎在 issues 里报 bug 或提想法。
