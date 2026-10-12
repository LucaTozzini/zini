import original from "../remaining-count/check.js";
import type { Check } from "../../../harness/types.js";
const check: Check = async context => {
  const outcome = await original(context);
  const code = await context.readFile("src/App.tsx");
  const preserved = code.includes("Your to-dos");
  return { passed: outcome.passed && preserved, details: `${outcome.details}; upstream heading ${preserved ? "preserved" : "lost"}` };
};
export default check;
