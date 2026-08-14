import { describe, expect, it } from "vitest";
import {
  anchorTaskCollaborationCoordinator,
  createExplicitTaskCollaborationProposal,
  formatTaskCollaborationProposal,
  hasExplicitTaskCollaborationIntent,
  hasValidTaskCollaborationProposal,
  parseTaskCollaborationProposal,
  taskCollaborationProposalProtocol,
} from "./task-collaboration-proposals";

describe("task collaboration proposals", () => {
  it("requires an explicit user request before collaboration is authorized", () => {
    expect(
      hasExplicitTaskCollaborationIntent(
        "按确认的 30 分钟频率、GPG 加密和备份路径开始执行吧。",
      ),
    ).toBe(false);
    expect(
      hasExplicitTaskCollaborationIntent("请介绍多智能体协作的机制和概念。"),
    ).toBe(false);
    expect(
      hasExplicitTaskCollaborationIntent(
        "请进行多智能体协作，Pi 负责实施，Claude 负责复核。",
      ),
    ).toBe(true);
  });

  it("keeps planning and acceptance with the conversation coordinator", () => {
    expect(
      anchorTaskCollaborationCoordinator(
        [
          {
            id: "plan",
            role: "项目负责人",
            runtimeId: "hers",
            responsibility: "规划任务并启动并行分支",
            dependsOn: [],
          },
          {
            id: "frontend",
            role: "前端",
            runtimeId: "pi",
            dependsOn: ["plan"],
          },
          {
            id: "backend",
            role: "后端",
            runtimeId: "claude",
            dependsOn: ["plan"],
          },
          {
            id: "acceptance",
            role: "验收",
            runtimeId: "hers",
            dependsOn: ["frontend", "backend"],
          },
        ],
        "hers-2",
      ),
    ).toEqual([
      expect.objectContaining({
        id: "plan",
        role: "项目负责人",
        runtimeId: "hers-2",
      }),
      expect.objectContaining({ id: "frontend", runtimeId: "pi" }),
      expect.objectContaining({ id: "backend", runtimeId: "claude" }),
      expect.objectContaining({
        id: "acceptance",
        role: "验收",
        runtimeId: "hers-2",
      }),
    ]);
  });
  it("does not steal an implementation role merely because its brief mentions planning or acceptance", () => {
    expect(
      anchorTaskCollaborationCoordinator(
        [
          {
            id: "frontend",
            role: "前端开发",
            runtimeId: "pi",
            responsibility: "依据规划实现页面，完成后交给负责人验收",
          },
        ],
        "hers-2",
      ),
    ).toEqual([
      expect.objectContaining({
        role: "项目负责人",
        runtimeId: "hers-2",
      }),
      expect.objectContaining({
        id: "frontend",
        role: "前端开发",
        runtimeId: "pi",
      }),
    ]);
  });
  it("extracts only configured runtimes and removes the control block from visible output", () => {
    const content = [
      "建议由不同智能体分别实施和测试。",
      "<agents-one-collaboration-proposal>",
      '{"title":"文档协作","reason":"需要独立实施和测试","brief":"生成并验证文档","assignments":[{"role":"实施","runtimeId":"claude","responsibility":"生成文档","context":"任务说明"},{"role":"测试","runtimeId":"hermes","responsibility":"验证文档","context":"产物"}]}',
      "</agents-one-collaboration-proposal>",
    ].join("\n");
    const parsed = parseTaskCollaborationProposal(content, [
      "claude",
      "hermes",
    ]);
    expect(parsed.displayContent).toBe("建议由不同智能体分别实施和测试。");
    expect(parsed.proposal).toMatchObject({
      title: "文档协作",
      assignments: [
        { role: "实施", runtimeId: "claude" },
        { role: "测试", runtimeId: "hermes" },
      ],
    });
  });

  it("does not turn an unknown runtime into a dispatchable proposal", () => {
    const content =
      '<agents-one-collaboration-proposal>{"assignments":[{"role":"实施","runtimeId":"unknown"}]}</agents-one-collaboration-proposal>';
    expect(
      parseTaskCollaborationProposal(content, ["claude"]).proposal,
    ).toBeUndefined();
  });

  it("tells runtimes that only the platform may dispatch registered agents", () => {
    const protocol = taskCollaborationProposalProtocol([
      { id: "pi", name: "Pi", kind: "pi" },
    ]);
    expect(protocol).toContain("不能通过终端、Shell、CLI");
    expect(protocol).toContain("普通任务、继续执行、开始执行");
    expect(protocol).toContain("用户明确要求多个智能体");
    expect(protocol).toContain("不得先调用工具、检查或修改工作区");
    expect(protocol).toContain("询问为何没有出现协作确认界面");
  });

  it("recognizes only a valid proposal that targets registered runtimes", () => {
    const valid = [
      "<agents-one-collaboration-proposal>",
      '{"assignments":[{"role":"执行","runtimeId":"pi"},{"role":"复核","runtimeId":"claude"}]}',
      "</agents-one-collaboration-proposal>",
    ].join("\n");

    expect(hasValidTaskCollaborationProposal(valid, ["pi", "claude"])).toBe(
      true,
    );
    expect(hasValidTaskCollaborationProposal(valid, ["pi"])).toBe(false);
    expect(
      hasValidTaskCollaborationProposal(
        "我会输出 <agents-one-collaboration-proposal> 标签。",
        ["pi", "claude"],
      ),
    ).toBe(false);
  });

  it("builds a deterministic proposal from explicitly named runtime responsibilities", () => {
    const runtimes = [
      { id: "hermes-home2", name: "Hers-2", kind: "hermes" },
      { id: "claude-local", name: "Claude Code", kind: "claude-code" },
      { id: "pi-local", name: "Pi", kind: "pi" },
    ];
    const proposal = createExplicitTaskCollaborationProposal(
      "Agents One 冒烟测试，想测试多智能协助。你负责编排、验收，Pi 负责执行，Claude 负责复核。",
      runtimes[0],
      runtimes,
    );

    expect(proposal).toMatchObject({
      assignments: [
        {
          role: "项目负责人",
          runtimeId: "hermes-home2",
          responsibility: "编排、验收",
        },
        { role: "实施", runtimeId: "pi-local", responsibility: "执行" },
        {
          role: "复核",
          runtimeId: "claude-local",
          responsibility: "复核",
        },
      ],
    });

    const serialized = formatTaskCollaborationProposal(proposal!);
    expect(
      parseTaskCollaborationProposal(
        serialized,
        runtimes.map((runtime) => runtime.id),
      ).proposal,
    ).toEqual(proposal);
  });

  it("does not synthesize collaboration without at least two explicit registered roles", () => {
    const runtimes = [
      { id: "hermes-home2", name: "Hers-2", kind: "hermes" },
      { id: "pi-local", name: "Pi", kind: "pi" },
    ];
    expect(
      createExplicitTaskCollaborationProposal(
        "请让 Pi 负责执行。",
        runtimes[0],
        runtimes,
      ),
    ).toBeUndefined();
    expect(
      createExplicitTaskCollaborationProposal(
        "介绍一下多智能体协作的概念。",
        runtimes[0],
        runtimes,
      ),
    ).toBeUndefined();
  });
});
