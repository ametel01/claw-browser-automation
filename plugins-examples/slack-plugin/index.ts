import { Type } from "@sinclair/typebox";

type UnknownRecord = Record<string, unknown>;

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
}

type SitePluginFactory = (options?: UnknownRecord) => SitePlugin | Promise<SitePlugin>;

interface SessionLike {
  currentUrl: () => string;
  page: {
    locator: (selector: string) => {
      first: () => {
        fill: (text: string) => Promise<void>;
        click: () => Promise<void>;
      };
      count: () => Promise<number>;
      nth: (index: number) => {
        innerText: () => Promise<string>;
      };
    };
    keyboard: {
      press: (key: string) => Promise<void>;
    };
  };
}

interface PluginContextLike {
  pool: {
    getSession: (sessionId: string) => SessionLike | undefined;
  };
}

const DEFAULT_HOSTS = ["app.slack.com", "slack.com", "*.slack.com"];

const NOTIFICATION_ITEM_SELECTOR =
  '[aria-label="All activity"] [role="listitem"] [role="document"], [aria-label="Activity"] [role="listitem"] [role="document"]';

const THREAD_REPLY_SELECTORS = [
  '[aria-label="Message #general-engineering"] [role="textbox"]',
  '[data-qa="message_input"] [role="textbox"]',
  '[data-qa="message_input"] div[contenteditable="true"]',
  '[contenteditable="true"][role="textbox"]'
];

function getRequiredString(params: UnknownRecord, key: string): string {
  const value = params[key];
  if (typeof value !== "string" || value.length === 0) {
    throw new Error(`${key} is required`);
  }
  return value;
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
    return hosts.some((h) => (h.startsWith("*.") ? host.endsWith(h.slice(1)) : host === h));
  } catch {
    return false;
  }
}

function assertSupportedHost(url: string, hosts: string[]): void {
  if (!hostMatches(url, hosts)) {
    throw new Error(`current page host is not supported: ${url}`);
  }
}

export const createSitePlugin: SitePluginFactory = (options = {}) => {
  const configuredHosts = Array.isArray(options["hosts"])
    ? (options["hosts"] as string[]).filter((h) => typeof h === "string" && h.length > 0)
    : DEFAULT_HOSTS;

  return {
    meta: {
      id: "slack_site",
      version: "0.1.0",
      apiVersion: "1",
      domains: configuredHosts
    },
    matches(url: string) {
      return hostMatches(url, configuredHosts);
    },
    createTools(ctx: unknown): ToolDefinition[] {
      const pluginCtx = ctx as PluginContextLike;

      return [
        {
          name: "read_activity_notifications",
          label: "Read Slack Activity Notifications",
          description:
            "Extract latest notifications from Slack Activity panel so the agent can summarize actionable updates.",
          parameters: Type.Object({
            sessionId: Type.String({ description: "Active browser session ID" }),
            limit: Type.Optional(Type.Number({ minimum: 1, maximum: 50, default: 10 }))
          }),
          async execute(params: UnknownRecord): Promise<ToolResult> {
            const sessionId = getRequiredString(params, "sessionId");
            const session = getSessionOrThrow(pluginCtx, sessionId);
            const url = session.currentUrl();
            assertSupportedHost(url, configuredHosts);

            const limit = typeof params.limit === "number" ? Math.max(1, Math.min(50, Math.floor(params.limit))) : 10;
            const locator = session.page.locator(NOTIFICATION_ITEM_SELECTOR);
            const total = await locator.count();
            const take = Math.min(limit, total);

            const items: string[] = [];
            for (let i = 0; i < take; i += 1) {
              const text = (await locator.nth(i).innerText()).replace(/\s+/g, " ").trim();
              if (text.length > 0) items.push(text);
            }

            return {
              content: [{ type: "text", text: JSON.stringify({ sessionId, total, returned: items.length, items }, null, 2) }],
              details: { sessionId, total, returned: items.length, items }
            };
          }
        },
        {
          name: "reply_in_open_thread",
          label: "Reply in Open Slack Thread",
          description:
            "Post a reply in the currently open Slack thread/channel composer. Use after opening the target thread.",
          parameters: Type.Object({
            sessionId: Type.String({ description: "Active browser session ID" }),
            text: Type.String({ description: "Reply text to send" }),
            submit: Type.Optional(Type.Boolean({ default: true }))
          }),
          async execute(params: UnknownRecord): Promise<ToolResult> {
            const sessionId = getRequiredString(params, "sessionId");
            const text = getRequiredString(params, "text");
            const submit = params.submit !== false;
            const session = getSessionOrThrow(pluginCtx, sessionId);
            const url = session.currentUrl();
            assertSupportedHost(url, configuredHosts);

            let usedSelector: string | null = null;
            for (const selector of THREAD_REPLY_SELECTORS) {
              const count = await session.page.locator(selector).count();
              if (count > 0) {
                const box = session.page.locator(selector).first();
                await box.click();
                await box.fill(text);
                usedSelector = selector;
                break;
              }
            }

            if (!usedSelector) {
              throw new Error("could not find Slack composer textbox for reply");
            }

            if (submit) {
              await session.page.keyboard.press("Enter");
            }

            return {
              content: [
                {
                  type: "text",
                  text: JSON.stringify({ ok: true, sessionId, submitted: submit, selector: usedSelector }, null, 2)
                }
              ],
              details: { ok: true, sessionId, submitted: submit, selector: usedSelector }
            };
          }
        }
      ];
    }
  };
};

export default createSitePlugin;
