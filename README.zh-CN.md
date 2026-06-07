# Quick Run JS/TS

[English](./README.md)

Quick Run JS/TS 是一个 VS Code 扩展，可以一键运行 JavaScript 和 TypeScript 文件，也可以只运行选中的代码。它支持未保存的临时草稿文件，并会根据当前 Node.js 版本自动选择合适的 TypeScript 运行方式。

## 功能特性

- 通过编辑器标题栏的运行按钮一键执行
- 支持运行整个文件，也支持只运行选中的代码行
- **支持未命名文件** - JavaScript/TypeScript 草稿不需要先保存即可运行
- **智能调试支持** - 当文件中设置了断点时，自动使用 VS Code 调试器运行
- 自动检测 Node.js 版本：
  - **Node.js >= 23.6**：直接原生运行 TypeScript 文件
  - **Node.js >= 22.6**：使用 `--experimental-strip-types`
  - **更低版本**：回退到 `tsx`（可配置）
- 支持 `.js`、`.mjs`、`.cjs`、`.ts`、`.mts`、`.cts` 文件
- 运行结果显示在终端面板中

## 安装

在 VS Code Marketplace 中搜索 **Quick Run JS/TS** 安装，或使用命令行安装：

```bash
code --install-extension banlify.quick-run-js-ts
```

## 用法

### 运行文件

1. 打开 `.js`、`.mjs`、`.cjs`、`.ts`、`.mts` 或 `.cts` 文件。
2. 点击编辑器标题栏中的 **Quick Run JS/TS: Run**。
3. 文件会在共享终端面板中运行。

你也可以新建一个未命名编辑器，将语言模式设置为 JavaScript 或 TypeScript，然后在保存前直接运行。

### 运行选中代码

1. 在 JavaScript 或 TypeScript 编辑器中选中一行或多行代码。
2. 点击编辑器标题栏中的 **Quick Run JS/TS: Run Selection**。
3. 插件会将选中的整行代码复制到临时文件并执行。

> **提示：** 未命名文件和选区内容都会写入临时文件执行，并在任务结束后自动清理。

### 调试模式

扩展可以自动使用 VS Code 调试器运行已保存的文件。

- **`auto`（默认）** - 仅在文件中设置了断点时进入调试模式
- **`always`** - 已保存文件始终以调试模式运行
- **`never`** - 始终以任务形式运行

通过 VS Code 设置中的 `quickRunJsTs.debugMode` 进行配置。

> 调试模式仅适用于已保存的文件。未命名文件和选区内容始终作为任务运行。

### TypeScript 运行策略

Quick Run JS/TS 会根据已安装的 Node.js 版本选择 TypeScript 执行命令：

- **Node.js >= 23.6**：`node <file>`
- **Node.js >= 22.6**：`node --experimental-strip-types <file>`
- **更低版本**：默认使用 `npx --yes tsx <file>`

## 配置

| 设置项                           | 默认值          | 说明                                                                                      |
| -------------------------------- | --------------- | ----------------------------------------------------------------------------------------- |
| `quickRunJsTs.runtime`           | `node`          | 用于执行 JS 文件和受支持 TS 文件的运行时命令。可以设置为 `bun`、`deno` 等其他运行时。     |
| `quickRunJsTs.tsFallbackCommand` | `npx --yes tsx` | 当 Node.js 不支持原生 TypeScript 时使用的 TS 回退命令                                     |
| `quickRunJsTs.debugMode`         | `auto`          | 何时使用 VS Code 调试器运行已保存文件：`auto` = 有断点时，`always` = 总是，`never` = 从不 |
