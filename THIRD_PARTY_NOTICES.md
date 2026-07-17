# 第三方软件与素材声明

六爻抛币使用开源依赖。2026-07-17 对根目录与 `mobile/` 的锁文件和已安装包进行了许可证清单检查：未发现许可证缺失、AGPL、GPL-only 或其他禁止本项目按 MIT 发布的依赖。

## 主要运行时依赖

| 项目 | 用途 | 许可证 |
| --- | --- | --- |
| React / React DOM | 浏览器界面 | MIT |
| React Native | 原生应用运行时 | MIT |
| Expo SDK | 原生能力与构建 | MIT |
| Async Storage | 本机历史存储 | MIT |
| React Native Safe Area Context | 状态栏与手势区适配 | MIT |
| @expo/vector-icons | 原生图标适配层 | MIT |
| Ionicons | 原生界面实际使用的图标集 | MIT |
| react-icons | 浏览器图标适配层 | MIT |
| Feather Icons | 浏览器界面实际使用的图标集 | MIT |

应用已使用 `@expo/vector-icons/Ionicons` 的直接入口，避免把未使用的其他图标字体打入安装包。

## 构建与传递依赖

- Vite：MIT
- TypeScript：Apache-2.0
- Lightning CSS：MPL-2.0；项目未修改该依赖源码
- node-forge：BSD-3-Clause 或 GPL-2.0 双许可证；本项目按 BSD-3-Clause 选项使用
- caniuse-lite：CC BY 4.0，作为浏览器兼容性构建数据使用
- 其余依赖主要为 MIT、ISC、Apache-2.0、BSD、BlueOak、0BSD、Unlicense 或兼容的双许可证

依赖保留其各自版权和许可证，不因本项目的 MIT License 而改变。完整版本和依赖树以 `package-lock.json` 与 `mobile/package-lock.json` 为准；完整许可证文本可在对应 npm 包及其上游仓库中查看。

主要上游：

- [Expo](https://github.com/expo/expo)
- [React](https://github.com/facebook/react)
- [React Native](https://github.com/facebook/react-native)
- [Ionicons](https://github.com/ionic-team/ionicons)
- [Feather Icons](https://github.com/feathericons/feather)
- [react-icons](https://github.com/react-icons/react-icons)
