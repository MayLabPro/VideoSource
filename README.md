# VideoSource

这个仓库只做一件事：通过 GitHub Actions 每天自动生成可直接调用的配置文件和 API 检测报告。

## 文件说明

| 文件 | 说明 |
| --- | --- |
| `input.json` | 主配置，顶层直接维护所有源 |
| `lite.json` | 检测通过的普通源 |
| `adult.json` | 检测通过的成人源 |
| `full.json` | `lite.json` + `adult.json` 汇总 |
| `report.md` | 每日 API 可用性检测报告 |

## 生成规则

- 主配置只维护 `input.json`，格式为 `{ "源ID": { "name": "...", "api": "...", "detail": "..." } }`。
- 名称以 `🔞` 开头的源被视为成人源，其余为普通源。
- 工作流会检测 `input.json` 里的所有源。
- 检测通过的成人源写入 `adult.json`。
- 检测通过的普通源写入 `lite.json`。
- `full.json` 是 `lite.json` 与 `adult.json` 的汇总。
- 生成文件沿用 `input.json` 的扁平结构，并会移除 `_comment` 字段，方便其他应用直接读取。

## GitHub Actions

工作流文件：`.github/workflows/check-and-build.yml`

触发方式：

- 每天北京时间 01:00 自动运行。
- 修改 `input.json`、脚本或工作流后自动运行。
- 支持在 GitHub Actions 页面手动运行，并可指定搜索关键词。

工作流会依次执行：

1. 校验 `input.json` 是否为合法 JSON。
2. 检测主配置中所有 API 的可用性和搜索结果。
3. 按检测结果生成 `lite.json`、`adult.json`、`full.json`。
4. 写入 `report.md`。
5. 验证生成文件结构和分组规则。
6. 如生成文件有变化，自动提交回仓库。

## 调用地址

把下面链接中的仓库地址按需替换为自己的仓库。

```text
https://raw.githubusercontent.com/MayLabPro/VideoSource/main/lite.json
https://raw.githubusercontent.com/MayLabPro/VideoSource/main/adult.json
https://raw.githubusercontent.com/MayLabPro/VideoSource/main/full.json
```

## 本地运行

```bash
npm run check -- 你好
npm run verify
```

如果本地还没有生成 `lite.json`、`adult.json`、`full.json` 和 `report.md`，先运行 `npm run check -- 你好`，再运行 `npm run verify`。也可以直接运行完整流程：

```bash
npm run test
```
