/** Tool layer barrel (AI-02 / EF §3.4). */

export { SeenEntities, type ToolContext } from './context.js';
export {
  TOOL_NAMES,
  TOOL_SPECS,
  executeTool,
  findTool,
  toolDefinitions,
  type ToolExecution,
  type ToolSpec,
} from './registry.js';
