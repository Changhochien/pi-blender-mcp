// pi-blender-mcp — Pi extension bridging Blender MCP tools into pi.
//
// Architecture:
//   pi (this extension)  ⇐ MCP/stdio ⇒  blender-mcp (Python)  ⇐ TCP ⇒  Blender Add-on
//
// Prerequisites:
//   1. Install the Blender MCP add-on in Blender (addon/blender_mcp_addon/)
//   2. Install the Python MCP server:  pip install blender-mcp
//   3. Ensure `blender-mcp` is on your PATH
//   4. Start Blender with the add-on enabled (or enable auto-start)

import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";
import { Type, type TSchema } from "typebox";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";

// ---------------------------------------------------------------------------
// JSON Schema → TypeBox conversion
//
// FastMCP (the Python MCP framework blender-mcp uses) auto-generates JSON
// Schema from Python type annotations. We convert the relevant subset:
//   string, number, integer, boolean, array, object, enum (string-only)
// ---------------------------------------------------------------------------

function jsonSchemaToTypeBox(schema: Record<string, unknown>): TSchema {
  const rawType = schema.type;
  const description = (schema.description as string) || undefined;

  // -- enum (string only, from Python Literal) --
  if (rawType === "string" && Array.isArray(schema.enum) && schema.enum.length > 0) {
    const values = schema.enum.map(String);
    return Type.Union(values.map((v) => Type.Literal(v)), { description });
  }

  // -- simple scalars --
  switch (rawType) {
    case "string":
      return Type.String({ description });
    case "number":
      return Type.Number({ description });
    case "integer":
      return Type.Number({ description }); // TypeBox doesn't distinguish int
    case "boolean":
      return Type.Boolean({ description });
  }

  // -- array --
  if (rawType === "array") {
    const items = schema.items
      ? jsonSchemaToTypeBox(schema.items as Record<string, unknown>)
      : Type.Any();
    return Type.Array(items, { description });
  }

  // -- object with properties --
  if (rawType === "object" && schema.properties) {
    const props = schema.properties as Record<string, Record<string, unknown>>;
    const required = new Set<string>((schema.required as string[]) ?? []);
    const entries: Record<string, TSchema> = {};

    for (const [key, propSchema] of Object.entries(props)) {
      const ts = jsonSchemaToTypeBox(propSchema);
      entries[key] = required.has(key) ? ts : Type.Optional(ts as any) as any;
    }

    return Type.Object(entries, { description });
  }

  // -- fallback: accept anything --
  return Type.Any({ description });
}

// ---------------------------------------------------------------------------
// Main extension
// ---------------------------------------------------------------------------

export default async function (pi: ExtensionAPI) {
  // --- Connect to blender-mcp via stdio ---
  const env: Record<string, string> = {};

  // Forward environment variables blender-mcp needs
  for (const key of ["BLENDER_MCP_HOST", "BLENDER_MCP_PORT", "BLENDER_PATH", "PATH"]) {
    const val = process.env[key];
    if (val) env[key] = val;
  }
  if (!env.BLENDER_MCP_HOST) env.BLENDER_MCP_HOST = "127.0.0.1";
  if (!env.BLENDER_MCP_PORT) env.BLENDER_MCP_PORT = "9876";

  let client: Client | null = null;

  try {
    const transport = new StdioClientTransport({
      command: "blender-mcp",
      args: [],
      env,
    });

    client = new Client(
      { name: "pi-blender-mcp", version: "1.0.0" },
      { capabilities: {} },
    );

    await client.connect(transport);
  } catch (err: any) {
    // blender-mcp not available — degrade gracefully
    if (pi.ui) {
      pi.ui.notify(
        `Blender MCP: server unavailable (${err.message ?? err.code ?? "unknown"}). Install with: pip install blender-mcp`,
        "warn",
      );
    }
    return;
  }

  // --- Discover tools ---
  const { tools } = await client.listTools();

  if (pi.ui) {
    pi.ui.notify(`Blender MCP: ${tools.length} tools loaded`, "info");
  }

  // --- Register each MCP tool as a pi custom tool ---
  for (const tool of tools) {
    // Guard against tools missing essential fields
    if (!tool.name) continue;

    const schema = jsonSchemaToTypeBox(
      (tool.inputSchema as Record<string, unknown>) ?? { type: "object", properties: {} },
    );

    pi.registerTool({
      name: `blender_${tool.name}`,
      label: `Blender: ${tool.name}`,
      description: tool.description ?? `Blender MCP tool: ${tool.name}`,

      // One-line snippet for pi's "Available tools" section
      promptSnippet: tool.description
        ? tool.description.split("\n")[0].slice(0, 120)
        : `Blender: ${tool.name}`,

      parameters: schema,

      async execute(_toolCallId, params, signal, onUpdate, _ctx) {
        onUpdate?.({ content: [{ type: "text", text: `Running ${tool.name}...` }] });

        try {
          const result = await client!.callTool(
            { name: tool.name, arguments: params as Record<string, unknown> },
            undefined,
            { signal } as any,
          );

          const textParts: string[] = [];
          const images: Array<{ type: "image"; data: string; mimeType: string }> = [];

          for (const item of result.content as any[]) {
            switch (item.type) {
              case "text":
                textParts.push(item.text);
                break;
              case "image": {
                // MCP images: { type: "image", data: base64, mimeType: "image/png" }
                images.push({
                  type: "image",
                  data: item.data,
                  mimeType: item.mimeType ?? "image/png",
                });
                break;
              }
              case "resource":
                textParts.push(`[resource: ${item.resource?.uri ?? "unknown"}]`);
                break;
              default:
                textParts.push(`[${item.type}]`);
            }
          }

          const text = textParts.join("\n") || "(completed)";

          // Build pi content array. Pi renders images inline in the TUI.
          const content: any[] = [{ type: "text", text }];
          for (const img of images) {
            content.push({
              type: "image",
              source: {
                type: "base64",
                mediaType: img.mimeType,
                data: img.data,
              },
            });
          }

          return {
            content,
            details: {
              toolName: tool.name,
              isError: result.isError ?? false,
            },
          };
        } catch (err: any) {
          return {
            content: [{ type: "text", text: `Error: ${err.message ?? String(err)}` }],
            details: { toolName: tool.name, isError: true },
          };
        }
      },
    });
  }

  // --- Clean shutdown ---
  pi.on("session_shutdown", async () => {
    if (!client) return;
    try {
      await client.close();
    } catch {
      // best-effort
    }
  });
}
