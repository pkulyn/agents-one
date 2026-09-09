# Agents One 语音输入接入说明

## 目标与范围

语音输入是任务对话框的一种输入方式：用户录音、服务端转写、文字回填输入框，确认或编辑后再沿用原有发送逻辑。v1 不接入语音服务自带的 LLM/TTS，不创建第二套会话链路，也不自动发送转写结果。

## 交互流程

1. 用户点击输入栏中小地球右侧的麦克风，或按 `Ctrl+M`，Agents One 建立流式语音连接并开始采集单声道音频。
2. Renderer 将 Chromium 麦克风样本转换为服务要求的 16kHz、16-bit、裸 PCM，并每约 256ms 通过受控 IPC 送入 Main。
3. Main 以 WebSocket 调用 `/v1/audio/transcriptions/stream`；Qwen3-ASR 以停顿（≥0.8 秒）自动断句，只返回带标点的句级 `final`。
4. 每个 `final` 都是可直接回填的完整句，Renderer 按收到顺序追加到草稿；不再处理或拼接 `partial`。用户再次点击或按 `Ctrl+M` 停止，服务端补齐残余文字后断开。
5. 全部文字只回填草稿，用户可继续编辑或手动发送。

服务 v1.4 是流式、单连接串行推理；客户端持续发送小块 PCM，但发送与接收互不阻塞。为优先保证识别准确率，界面不再逐字预览，而是在每次自然停顿后逐句显示；流式模式没有 120 秒或 25 MB 的整段限制，输入框上方保留已录制时长计时但不显示上限。

## 默认服务与配置

开源桌面版默认关闭语音输入，且不内置大阪或任何第三方服务地址。用户可在“设置 → 语音输入”中填写自行部署或可信任的 OpenAI 兼容服务基础地址、完整文件转写地址，或 v1.4 文档提供的完整 `ws(s)://…/v1/audio/transcriptions/stream` 地址；后者会自动归一为服务基础地址。未启用或未配置时，客户端不会申请麦克风权限或发送音频。Main 进程会优先读取当前 Hermes Profile 的配置与密钥解析链，再读取进程环境变量；流式地址由该 URL 自动推导：`http → ws`、`https → wss`，并使用 `/v1/audio/transcriptions/stream` 路径。

```text
AGENTS_ONE_VOICE_ENABLED=1
AGENTS_ONE_VOICE_API_URL=https://voice.example.com/voice
AGENTS_ONE_VOICE_API_KEY=
```

服务不需要鉴权时，`AGENTS_ONE_VOICE_API_KEY` 可留空。启用 Bearer 鉴权后，设置页只显示“已配置”状态，永不回显密钥；密钥不进入对话、项目、任务或备份。现有的 secrets provider 仍可在运行时提供同名密钥。

在无管理员权限的 Windows 上，可以用 PowerShell 写入用户级环境变量；修改后需完全退出并重启 Agents One：

```powershell
[Environment]::SetEnvironmentVariable('AGENTS_ONE_VOICE_ENABLED', '1', 'User')
[Environment]::SetEnvironmentVariable(
  'AGENTS_ONE_VOICE_API_URL',
  'https://voice.example.com/voice',
  'User'
)
```

本版本已移除本地 Hermes API 与 Python STT 回退；`AGENTS_ONE_VOICE_API_URL=hermes` 不再支持。设置页的“测试连接”仅请求 `/health`，不会采集或上传麦克风音频。正式发布前应先把服务升级为 HTTPS，再配置 Bearer token。当前公网 HTTP 会明文传输录音内容，不适合作为面向普通用户的默认生产配置。

## 错误处理与录音反馈

大阪 ASR 服务不可达、超时、非 2xx 或无效 JSON 时会在输入栏显示错误；已有草稿、附件、任务和历史不会被清除或改写。客户端不移除或自行添加标点，Qwen3-ASR `final` 的标点完全以服务端返回为准；如最终句没有标点，应在 ASR 服务端检查模型或配置。

录音开始后，输入框上方会出现声波动画、“正在录音”、停止提示和已录制时长；再次点击麦克风或按 `Ctrl+M` 后，声波立即消失，服务端会对残余音频返回最终文字。流式服务不再采用 120 秒和 25 MB 的整段限制；服务端以单连接串行推理运行，用户应在一条对话框中只保持一次录音。

## 联调审计

为比对客户端采集、Main 实际送达和大阪服务返回的句子，可在启动桌面进程前设置 `AGENTS_ONE_VOICE_STREAM_AUDIT=1`。每段录音关闭连接时，Main 日志会输出一条 `[voice-stream-audit]` JSON，含 Renderer 采集的块数/字节数/发送失败数、Main 实际写入 WebSocket 的块数/字节数，以及收到的 `final` 文本序列和相对时间。此开关默认关闭，且不写入对话、任务、项目或配置；因日志包含转写文本，联调完成后应关闭并妥善处理日志。

## 后续演进

- 支持多个命名语音服务配置及迁移导入。
- 在首个录音会话前，按服务的隐私标签显示一次确认提示。
- 若未来服务重新提供 `partial`，需以新的显式协议版本单独设计实时预览，不能假设 v1.4 会发送增量文字。
- TTS 应作为独立的“朗读回复”能力评估，不与本次 STT 输入改造绑定。
