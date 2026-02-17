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
  currentUrl: () => string;
  page: {
    locator: (selector: string) => {
      first: () => {
        textContent: () => Promise<string | null>;
        fill: (text: string) => Promise<void>;
      };
    };
  };
}

interface PluginContextLike {
  pool: {
    getSession: (sessionId: string) => SessionLike | undefined;
  };
}

function getSessionOrThrow(ctx: PluginContextLike, sessionId: string): SessionLike {
  const session = ctx.pool.getSession(sessionId);
  if (!session) {
    throw new Error(`session not found: ${sessionId}`);
  }
  return session;
}

function hostMatches(url: string, hosts: string[]): boolean {
  try {
    const host = new URL(url).hostname.toLowerCase();
    return hosts.includes(host);
  } catch {
    return false;
  }
}

function assertSupportedHost(url: string, hosts: string[]): void {
  if (!hostMatches(url, hosts)) {
    throw new Error(`current page host is not supported: ${url}`);
  }
}

function getRequiredString(params: UnknownRecord, key: string): string {
  const value = params[key];
  if (typeof value !== "string" || value.length === 0) {
    throw new Error(`${key} is required`);
  }
  return value;
}

function getHosts(options: UnknownRecord): string[] {
  const rawHosts = options["hosts"];
  if (
    Array.isArray(rawHosts) &&
    rawHosts.length > 0 &&
    rawHosts.every((host) => typeof host === "string" && host.length > 0)
  ) {
    return rawHosts.map((host) => host.toLowerCase());
  }
  return ["x.com", "www.x.com", "twitter.com", "www.twitter.com"];
}

export const createSitePlugin: SitePluginFactory = (options = {}, logger) => {
  const hosts = getHosts(options);

  const feedTextSelector =
    typeof options["feedTextSelector"] === "string" && options["feedTextSelector"].length > 0
      ? options["feedTextSelector"]
      : 'article [data-testid="tweetText"], article [lang]';

  const composerSelector =
    typeof options["composerSelector"] === "string" && options["composerSelector"].length > 0
      ? options["composerSelector"]
      : '[data-testid="tweetTextarea_0"], [role="textbox"][data-testid="tweetTextarea_0"]';

  const allowDraftWrite = options["allowDraftWrite"] === true;

  const plugin: SitePlugin = {
    meta: {
      id: "twitter_site",
      version: "0.1.0",
      apiVersion: "1",
      domains: hosts
    },
    matches(url: string) {
      return hostMatches(url, hosts);
    },
    createTools(ctx: unknown): ToolDefinition[] {
      const pluginCtx = ctx as PluginContextLike;

      return [
        {
          name: "capture_top_post_text",
          label: "Capture Top Post Text",
          description:
            "Capture text from the first visible post in the feed for the current X/Twitter page.",
          parameters: Type.Object({
            sessionId: Type.String({ description: "Active browser session ID" }),
            selector: Type.Optional(
              Type.String({ description: "Optional CSS selector override for post text" })
            )
          }),
          async execute(params: UnknownRecord): Promise<ToolResult> {
            const sessionId = getRequiredString(params, "sessionId");
            const session = getSessionOrThrow(pluginCtx, sessionId);
            const url = session.currentUrl();
            assertSupportedHost(url, hosts);

            const selectorParam = params["selector"];
            const selector =
              typeof selectorParam === "string" && selectorParam.length > 0
                ? selectorParam
                : feedTextSelector;

            const text = await session.page.locator(selector).first().textContent();

            return {
              content: [
                {
                  type: "text",
                  text: JSON.stringify(
                    {
                      sessionId,
                      url,
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
                url,
                selector,
                text: text ?? ""
              }
            };
          }
        },
        {
          name: "prepare_post_draft",
          label: "Prepare Post Draft",
          description:
            "Fill the composer textbox with draft content. This is disabled unless allowDraftWrite=true.",
          parameters: Type.Object({
            sessionId: Type.String({ description: "Active browser session ID" }),
            text: Type.String({ description: "Draft text to place into composer" })
          }),
          async execute(params: UnknownRecord): Promise<ToolResult> {
            if (!allowDraftWrite) {
              throw new Error(
                "prepare_post_draft is disabled. Enable with sitePlugins[].options.allowDraftWrite=true"
              );
            }

            const sessionId = getRequiredString(params, "sessionId");
            const text = getRequiredString(params, "text");
            const session = getSessionOrThrow(pluginCtx, sessionId);
            const url = session.currentUrl();
            assertSupportedHost(url, hosts);

            await session.page.locator(composerSelector).first().fill(text);
            logger?.info?.(
              { pluginId: "twitter_site", sessionId },
              "draft text filled via twitter example plugin"
            );

            return {
              content: [
                {
                  type: "text",
                  text: JSON.stringify(
                    {
                      ok: true,
                      sessionId,
                      composerSelector
                    },
                    null,
                    2
                  )
                }
              ],
              details: {
                ok: true,
                sessionId,
                composerSelector
              }
            };
          }
        }
      ];
    },
    dispose() {
      logger?.info?.({ pluginId: "twitter_site" }, "twitter example plugin disposed");
    }
  };

  return plugin;
};

export default createSitePlugin;
