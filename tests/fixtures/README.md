# tests/fixtures/ —— 可入库的测试输入样本

**这里的文件必须脱敏。** 含真实员工姓名/工号/中心归属的导出数据一律放 `tests/tmp/`
（已 gitignore），不要往这里放。

| 文件 | 用途 |
|---|---|
| `report-new.md` | 新版报告格式样本（六节 + 分隔符） |
| `report-old.md` | 旧版报告格式样本（供归一/兼容测试） |
| `sample-report.json` | **脱敏**的报告 JSON（供 poster/render 预览脚本当输入） |

## 真实数据放哪

需要真实报告做端到端验证时（如打标、编辑、发信），**运行时现场从后台拉**：

```bash
node tools/fetch_reports.py json > tests/tmp/full-reports.json   # 或用 admin detail
```

拉下来的文件放 `tests/tmp/`，它已被 gitignore。
`tests/e2e/t-tag-live.js`、`dbg-tag10.js` 读的就是这个位置的现场导出。
