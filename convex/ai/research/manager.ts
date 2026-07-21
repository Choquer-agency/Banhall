import { WorkflowManager } from "@convex-dev/workflow";
import { components } from "../../_generated/api";

/** Dedicated pool: two external researchers plus the optional Brain lookup. */
export const researchWorkflowManager = new WorkflowManager(
  components.researchWorkflow,
  {
    workpoolOptions: {
      maxParallelism: 3,
      // Provider calls can incur charges and are not safely repeatable after an
      // ambiguous network failure. A writer starts a fresh run explicitly.
      retryActionsByDefault: false,
    },
  }
);
