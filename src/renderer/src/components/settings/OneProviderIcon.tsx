import { Settings2 } from "lucide-react";
import deepseek from "../../assets/providers/deepseek-color.svg";
import openai from "../../assets/providers/openai.svg";
import anthropic from "../../assets/providers/anthropic.svg";
import ark from "../../assets/providers/volcengine-color.svg";
import bigmodel from "../../assets/providers/zhipu-color.svg";
import zai from "../../assets/providers/zai.svg";
import kimi from "../../assets/providers/moonshot.svg";
import minimax from "../../assets/providers/minimax-color.svg";
import bailian from "../../assets/providers/alibabacloud-color.svg";
import { getOneModelProviderPresetId } from "./one-model-provider-presets";
import type { OneModelApiType } from "../../../../shared/one-model-api";

const icons: Record<string, string> = {
  deepseek,
  openai,
  anthropic,
  "ark-agent-plan": ark,
  bigmodel,
  zai,
  kimi,
  minimax,
  bailian,
};
export default function OneProviderIcon({
  endpoint,
  apiType,
}: {
  endpoint: string;
  apiType: OneModelApiType;
}): React.JSX.Element {
  const preset = getOneModelProviderPresetId(endpoint, apiType);
  return icons[preset] ? (
    <img
      src={icons[preset]}
      className="agent-one-provider-brand"
      alt=""
      aria-hidden="true"
    />
  ) : (
    <Settings2 size={22} aria-hidden="true" />
  );
}
