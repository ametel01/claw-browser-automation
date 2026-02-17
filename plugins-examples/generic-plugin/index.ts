import { Type } from "@sinclair/typebox";

type UnknownRecord = Record<string, unknown>;

interface LoggerLike {
  info?: (bindings: Record<string, unknown>, message?: string) => void;
}

interface ToolResult {
  content: Array<{ type: "text"; text: string }>;
  details: Record<string, unknown>;
}

interface ToolDefinition {
  name: string;
  description: string;
  label: string;
  parameters: ReturnType<typeof Type.Object>;
  execute: (params: UnknownRecord) => Promise<ToolResult>;
}

interface SitePlugin {
  meta: {
    id: string;
    version: string;
    apiVersion?: string;
    domains?: string[];
  };
  createTools: (ctx: unknown) => ToolDefinition[];
  matches?: (url: string) => boolean;
  dispose?: () => Promise<void> | void;
}

type SitePluginFactory = (
  options?: UnknownRecord,
  logger?: LoggerLike
) => SitePlugin | Promise<SitePlugin>;

interface SessionLike {
  page: {
    locator: (selector: string) => {
      first: () => {
        textContent: () => Promise<string | null>;
      };
    };
  };
}

interface PluginContextLike {
  pool: {
    getSession: (sessionId: string) => SessionLike | undefined;
  };
}

function getStringParam(params: UnknownRecord, key: string): string {
  const value = params[key];
  if (typeof value !== "string" || value.length === 0) {
    throw new Error(`${key} is required`);
  }
  return value;
}

export const createSitePlugin: SitePluginFactory = (options = {}, logger) => {
  const markerSelector =
    typeof options["markerSelector"] === "string" && options["markerSelector"].length > 0
      ? options["markerSelector"]
      : "h1";

  const plugin: SitePlugin = {
    meta: {
      id: "example_site",
      version: "0.1.0",
      apiVersion: "1",
      domains: ["example.com"]
    },
    matches(url: string) {
      try {
        return new URL(url).hostname.includes("example.com");
      } catch {
        return false;
      }
    },
    createTools(ctx: unknown): ToolDefinition[] {
      const pluginCtx = ctx as PluginContextLike;

      return [
        {
          name: "capture_marker_text",
          label: "Capture Marker Text",
          description:
            "Read the first matching element text from the active page (defaults to h1).",
          parameters: Type.Object({
            sessionId: Type.String({ description: "Active browser session ID" }),
            selector: Type.Optional(
              Type.String({ description: "Optional CSS selector override" })
            )
          }),
          async execute(params: UnknownRecord): Promise<ToolResult> {
            const sessionId = getStringParam(params, "sessionId");
            const selectorParam = params["selector"];
            const selector =
              typeof selectorParam === "string" && selectorParam.length > 0
                ? selectorParam
                : markerSelector;

            const session = pluginCtx.pool.getSession(sessionId);
            if (!session) {
              throw new Error(`session not found: ${sessionId}`);
            }

            const text = await session.page.locator(selector).first().textContent();

            return {
              content: [
                {
                  type: "text",
                  text: JSON.stringify(
                    {
                      sessionId,
                      selector,
                      text: text ?? ""
                    },
                    null,
                    2
                  )
                }
              ],
              details: {
                sessionId,
                selector,
                text: text ?? ""
              }
            };
          }
        }
      ];
    },
    dispose() {
      logger?.info?.({ pluginId: "example_site" }, "example site plugin disposed");
    }
  };

  return plugin;
};

export default createSitePlugin;
