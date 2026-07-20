# 安全政策

## 支持范围

当前项目处于 Beta 阶段，仅维护默认分支上的最新版本。

## 报告安全问题

请不要在公开 Issue 中披露尚未修复的安全问题。仓库已启用 GitHub Private vulnerability reporting，请通过 **Security → Advisories → Report a vulnerability** 私下报告，并说明受影响版本、复现方法和潜在影响。

本应用目前没有账号、后端或云端数据同步。若报告涉及动作传感器、本地历史记录、构建签名或依赖供应链，请在标题中明确标注。

## 已审查的上游依赖公告

根目录的 `npm audit` 当前为 0 项；`mobile/` 的审计会沿 Expo 构建工具链报告 10 个中危传递条目，这些条目均汇聚到同一条依赖链 `xcode@3.0.1 → uuid@7.0.3` 和同一份 GitHub Advisory Database 公告 [GHSA-w5hq-g745-h8pq](https://github.com/advisories/GHSA-w5hq-g745-h8pq)。

该公告针对 `uuid.v3()`、`uuid.v5()` 和 `uuid.v6()` 接收外部输出缓冲区时的边界校验。当前 `xcode` 依赖在 `lib/pbxProject.js` 中只调用无外部缓冲区的 `uuid.v4()`，公告也明确说明 `v4()` 已执行边界检查，因此当前应用代码和 EAS 配置路径不触发该缺陷。项目没有用不兼容的依赖覆盖或降级 Expo 来掩盖公告，并会继续跟随 Expo SDK 的兼容补丁更新。

仓库同时启用了 GitHub Dependabot alerts 和 security updates，用于在依赖风险状态变化时提供持续提醒和兼容范围内的修复建议。
