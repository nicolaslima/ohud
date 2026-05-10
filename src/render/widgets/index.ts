// src/render/widgets/index.ts
import type { Widget } from "../widget.js";
import type { HudConfig } from "../../types.js";
import { projectWidget } from "./project.js";
import { contextWidget } from "./context.js";
import { apiTimeWidget } from "./api-time.js";
import { usageWidget } from "./usage.js";
import { costWidget } from "./cost.js";
import { promptCacheWidget } from "./prompt-cache.js";
import { memoryWidget } from "./memory.js";
import { durationWidget } from "./duration.js";
import { toolsWidget } from "./tools.js";
import { agentsWidget } from "./agents.js";
import { todosWidget } from "./todos.js";
import { environmentWidget } from "./environment.js";
import { sessionTimeWidget } from "./session.js";
import { tokensPerSecWidget } from "./tokens.js";
import { errorsWidget } from "./errors.js";

/**
 * All 12 registered widgets, in priority-descending order.
 * RowLayout uses elementOrder from config for final line ordering;
 * this array is the source of truth for registry-level invariants.
 */
export const WIDGETS: readonly Widget[] = [
  projectWidget,    // header,   priority 100
  contextWidget,    // metrics,  priority 90
  apiTimeWidget,    // metrics,  priority 82 (slightly above usage — more frequent updates in Ollama mode)
  usageWidget,      // metrics,  priority 80
  costWidget,       // metrics,  priority 70
  promptCacheWidget,// metrics,  priority 60
  memoryWidget,     // metrics,  priority 50
  durationWidget,   // metrics,  priority 40
  errorsWidget,     // metrics,  priority 35 (Hush prose only)
  sessionTimeWidget,// metrics,  priority 30 (Hush prose only)
  tokensPerSecWidget,// metrics, priority 20 (Hush prose only)
  toolsWidget,      // activity, priority 90
  agentsWidget,     // activity, priority 85
  todosWidget,      // activity, priority 70
  environmentWidget,// activity, priority 30
];

/**
 * Returns the subset of WIDGETS that are gated "visible" by the given config.
 *
 * Visibility mirrors the existing `display.show*` flag checks in src/render/index.ts
 * and each src/render/widgets/<id>.ts exactly. Returning false here means
 * RowLayout will never call w.render(ctx), so the widget never appears.
 *
 * Note: some widgets (cost, context, usage) gate themselves in their own
 * render() using runtime data (mode, usageData, etc.), so they are always
 * included from a config perspective but may still return null at render time.
 */
export function visibleWidgets(config: HudConfig): Widget[] {
  return WIDGETS.filter((w) => isVisible(w, config));
}

function isVisible(w: Widget, config: HudConfig): boolean {
  const d = config.display;
  switch (w.id) {
    // --- header ---
    case "project":
      // Always rendered if present in elementOrder; renderProject never returns null
      return true;

    // --- metrics ---
    case "context":
      // renderContext gates on showContextBar; include widget whenever that flag is on
      return d.showContextBar !== false;

    case "apiTime":
      // renderApiTime gates on mode===ollama AND showApiTime; include when flag is on
      // (mode check happens inside render())
      return d.showApiTime !== false;

    case "usage":
      // renderUsage gates on mode===anthropic AND showUsage; include when flag is on
      return d.showUsage !== false;

    case "cost":
      // renderCost has its own complex gating (showCost OR native cost>0).
      // Always include the widget; renderCost handles the rest.
      return true;

    case "promptCache":
      // renderPromptCache gates on showPromptCache
      return d.showPromptCache === true;

    case "memory":
      // renderMemory gates on showMemoryUsage AND lineLayout==="expanded"
      return d.showMemoryUsage === true;

    case "duration":
      // renderDuration gates on showDuration OR showSpeed
      return d.showDuration === true || d.showSpeed === true;

    case "sessionTime":
    case "tokensPerSec":
    case "errors":
      // Hush-only widgets: their cells are designed for the prose/card
      // layout. Gate on display.layout so they appear automatically when
      // the user is on hush, without needing extra config.
      return d.layout === "hush";

    // --- activity ---
    case "tools":
      // renderTools gates on showTools
      return d.showTools === true;

    case "agents":
      // renderAgents gates on showAgents
      return d.showAgents === true;

    case "todos":
      // renderTodos gates on showTodos
      return d.showTodos === true;

    case "environment":
      // renderEnvironment gates on showConfigCounts
      return d.showConfigCounts === true;

    default:
      return true;
  }
}
