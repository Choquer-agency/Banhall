import base from "../../vitest.component.config";
const optimizer = { rolldownOptions: { tsconfig: false, external: [/^node:/] } };
export default {
  ...base,
  optimizeDeps: { ...base.optimizeDeps, ...optimizer },
  environments: {
    __vitest__: { optimizeDeps: optimizer },
    client: { optimizeDeps: optimizer },
    ssr: { optimizeDeps: optimizer },
  },
};
