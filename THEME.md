# Otter Music · 主题一致性规范（THEME.md）

> 目标：全 App 视觉统一。所有颜色、层级、间距必须来自**语义 token**，禁止散落硬编码色。
> 视觉基准：以 YesPlayMusic（Apple Music/Spotify 风格）的暗黑层次为参考，保持
> otter-music 的绿色品牌主色（`--primary` 翡翠绿）。

## 1. 色彩体系（语义 Token）

| Token | 用途 | 备注 |
|---|---|---|
| `--background` | 页面主背景 | 浅色近白 / 暗黑深蓝灰 |
| `--card` | 卡片 / 弹层 / 分组底 | 比 background 亮一档（暗黑下） |
| `--popover` | 弹窗 / 抽屉 / 菜单底 | 最亮层级 |
| `--foreground` | 主文字 | — |
| `--primary` | **唯一品牌交互色** | 选中态 / 播放态 / 主按钮 / 图标高亮 / 指示条 / 链接 |
| `--primary-foreground` | primary 上的文字 | — |
| `--secondary / --muted` | 次级底 / 弱底 | — |
| `--muted-foreground` | 次级文字（见 3 档规范） | — |
| `--accent` | 强调（hover 底 / 高亮） | 与 primary 同族 |
| `--destructive` | 危险操作 / 删除 / 错误 | — |
| `--border / --input / --ring` | 边框 / 输入框 / 焦点环 | — |
| `--glass-bg / --glass-border` | 毛玻璃（播放栏 / 悬浮层） | — |

### 硬编码色禁令

- **禁止** `text-sky-*` / `bg-sky-*` / `text-amber-*`（文件夹图标）等作为 UI 交互色 → 一律用 `text-primary`。
- **禁止** `text-red-500` 等原始红做错误/删除 → 用 `text-destructive`。
- **允许保留的语义场景**：
  - 音质/格式徽章（`MusicTrackItem`：FLAC=amber、APE=rose 等，徽章色彩区分）；
  - 榜单/奖牌金（`AwardsChart` 的 amber 金/银/铜）；
  - 管理后台状态色（AdminPage 的成功绿 / 错误红，语义状态）；
  - 播放页沉浸式暗黑底（`FullScreenPlayer` 的 zinc-950/black 渐变）；
  - 图表系列色（chart-1..5）。
- 新增 UI 一律只使用 token 类（`bg-background/card/popover`、`text-foreground/muted-foreground`、`border-border`、`text-primary`…）。

## 2. 文字层级（muted-foreground 三档）

次级文字**只允许三档透明度**，禁止 40/60/80/90 等发散档：

| 档位 | 类 | 用途 |
|---|---|---|
| 主要 | `text-muted-foreground` | 次级信息主体（歌手、描述、时间） |
| 强调 | `text-muted-foreground/70` | 需弱化的说明 / 标签 |
| 弱 | `text-muted-foreground/50` | 占位、角标、极弱提示 |
| 极弱 | `text-muted-foreground/30` | 图标装饰、禁用态 |

## 3. 页面模式（统一骨架）

- **页面头部**：`PageHeader`（返回 + 标题 + 右侧操作），所有二级页统一。
- **列表行**：统一 `MusicTrackItem`（序号 + 歌名 + 歌手/专辑 + 三个点菜单），全 App 生效（已落地）。
- **卡片**：`rounded-xl border border-border bg-card`，阴影 `shadow-sm`。
- **抽屉/弹层**：`bg-popover`，圆角 `rounded-t-2xl`，遮罩统一。
- **空状态/加载**：`PageLoader` / `StatusView`（图标 + 文案 + 可选操作）。
- **毛玻璃**：悬浮层用 `bg-glass-bg backdrop-blur border-glass-border`（播放栏已落地）。

## 4. 品牌色使用规则

- **primary 只做"状态/强调"**：选中行、播放指示、主按钮、进度、图标高亮、链接。
- 不做大面积底色（避免喧宾夺主）；hover 用 `accent` 底 + 文字变深。
- 播放中状态全 App 统一：`bg-primary/10 text-primary`（选中行）+ 律动动画。

## 5. 一致性检查命令

```bash
# 检查硬编码交互色（应输出 0 或仅语义白名单文件）
grep -rEoh "text-(sky|blue|amber|orange|purple|indigo)-[0-9]+|bg-(sky|blue|amber|orange|purple|indigo)-[0-9]+" src --include="*.tsx"

# 检查 muted 文字发散档（只应剩 /70 /50 /30）
grep -rEoh "text-muted-foreground/(40|60|80|90)" src --include="*.tsx"
```

## 6. 后续轮次待办（不在本轮范围）

- `text-white` / `bg-white` 在浅色/暗黑下的合理性复查（约 130 处，多为合理用法，需逐处确认后收敛）。
- 图表色 chart-1..5 与品牌色统一。
- 播放页沉浸式视觉与全 App 暗黑层次的进一步对齐。
