/** Recognize explicit provider rejection, never ordinary silence or tool failures. */
export function runtimeModelFailureKind(
  value: string,
): "quota" | "auth" | "model" | "network" | undefined {
  if (/retrying|will retry|reconnecting|正在重试/i.test(value))
    return undefined;
  if (
    /free usage limit reached|insufficient_quota|quota (?:exceeded|exhausted)|(?:usage|rate) limit (?:reached|exceeded)|insufficient (?:balance|credits)|余额不足|额度(?:已)?(?:用尽|耗尽|不足)/i.test(
      value,
    )
  )
    return "quota";
  if (
    /invalid[_ -]api[_ -]?key|authentication[_ -]error|authentication (?:failed|required)|invalid authentication|api key.*(?:invalid|expired)|unauthorized.*(?:model|provider)|认证失败|密钥无效/i.test(
      value,
    )
  )
    return "auth";
  if (
    /(?:model|provider).*(?:not found|unavailable|does not support|not support)|unsupported.*(?:image|media)|image.*not supported/i.test(
      value,
    )
  )
    return "model";
  if (
    /AI_APICallError.*(?:connect|network|fetch)|ECONNREFUSED|ENOTFOUND|ETIMEDOUT|(?:model|provider).*(?:connection failed|request timed out)/i.test(
      value,
    )
  )
    return "network";
  return undefined;
}
