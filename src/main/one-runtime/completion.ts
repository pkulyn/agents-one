/** Reject protocol-shaped plain text without executing untrusted generated instructions. */
export function validateOneCompletion(output: string): void {
  if (
    /^\s*<\|FunctionCallBegin\|>[\s\S]*<\|FunctionCallEnd\|>\s*$/.test(output)
  )
    throw new Error(
      "模型返回了未执行的工具调用文本，任务未完成；未据此创建文件或执行工具。请重试。",
    );
}
