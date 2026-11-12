import { expect, it } from "vitest";
import { validateOneCompletion } from "./completion";
// @lat: [[main-process#Main Process#One session resume reconciliation#One completion protocol validation]]
it("does not report a serialized pseudo tool call as a completed task", () => {
  expect(() =>
    validateOneCompletion(
      '<|FunctionCallBegin|>[{"name":"office-edit"}]<|FunctionCallEnd|>',
    ),
  ).toThrow("未执行");
  expect(() => validateOneCompletion("Created test.docx.")).not.toThrow();
  expect(() =>
    validateOneCompletion(
      "Example: <|FunctionCallBegin|>[]<|FunctionCallEnd|>",
    ),
  ).not.toThrow();
});
