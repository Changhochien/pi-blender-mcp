# pi-blender-mcp

Pi extension that connects to [blender-mcp](https://projects.blender.org/lab/blender_mcp), registering all Blender tools as native pi tools. The agent can inspect scenes, execute Python in Blender, take screenshots, render, look up API docs, and more — all as first-class pi tool calls.

## Prerequisites

1. **Blender** — Install [Blender](https://www.blender.org/) (4.0+ recommended)
2. **Blender MCP add-on** — Install the add-on from `addon/blender_mcp_addon/` in the [blender-mcp repo](https://projects.blender.org/lab/blender_mcp). Enable it in Blender's preferences (auto-start recommended).
3. **Python MCP server** — Install the `blender-mcp` Python package:
   ```bash
   pip install blender-mcp
   ```
   Ensure `blender-mcp` is on your PATH.
4. **Start Blender** — With the add-on enabled and the server running.

## Install

### Project-local (recommended)

Install only for your Blender project — won't affect other workspaces:

```bash
cd /path/to/your-blender-project
pi install git:github.com/Changhochien/pi-blender-mcp -l
```

This writes to `.pi/settings.json` in that directory. Team members who clone the project get it auto-installed on their first pi startup.

### Global

Available in every project:

```bash
pi install npm:pi-blender-mcp
# or from git:
pi install git:github.com/Changhochien/pi-blender-mcp
```

## Usage

Once installed, restart pi. The extension connects to `blender-mcp` at startup. You'll see:

```
Blender MCP: 24 tools loaded
```

Then just talk to pi about your Blender work. The agent will call Blender tools directly:

- "What objects are in my scene?"
- "Take a screenshot of the 3D viewport"
- "Create a cube at the origin"
- "Render the viewport to /tmp/render.png"
- "Show me the docs for bpy.types.Mesh"

## Tools Registered

Every tool from blender-mcp becomes a pi tool with the `blender_` prefix:

| pi Tool | Description |
|---------|-------------|
| `blender_execute_blender_code` | Run arbitrary Python in Blender |
| `blender_get_objects_summary` | Scene collection hierarchy |
| `blender_get_object_detail_summary` | Detailed object info |
| `blender_get_screenshot_of_window_as_image` | Screenshot entire window |
| `blender_get_screenshot_of_area_as_image` | Screenshot a specific area |
| `blender_get_screenshot_of_window_as_json` | Window layout as JSON |
| `blender_render_viewport_to_path` | Render current view |
| `blender_render_thumbnail_to_path` | Low-quality thumbnail |
| `blender_jump_to_tab_by_name` | Switch workspace tab |
| `blender_jump_to_tab_by_space_type` | Switch workspace by type |
| `blender_jump_to_view3d_object_by_name` | Focus 3D view on object |
| `blender_jump_to_view3d_object_data_by_name` | Focus 3D view on data |
| `blender_get_python_api_docs` | Look up API documentation |
| `blender_search_api_docs` | Search API docs |
| `blender_search_manual_docs` | Search user manual |
| `blender_get_blendfile_summary_*` | Blend file inspection (8 variants) |

## Troubleshooting

**Tools show errors about "No active window" or connection failures:**
- Make sure Blender is running with the add-on enabled
- Check the add-on preferences: host should be `127.0.0.1`, port `9876`
- Verify the server starts: run `blender-mcp` manually in a terminal

**Extension fails to load:**
- Check `blender-mcp` is on your PATH: `which blender-mcp`
- Check Python deps: `pip install blender-mcp`

## How It Works

```
pi                         ← TypeScript extension (this repo)
  │
  ├─ spawns ──► blender-mcp ← Python process (MCP server, over stdio)
  │                 │
  │                 └── TCP ──► Blender add-on (executes code in Blender)
  │
  └─ registers each MCP tool as a pi custom tool
```

The extension converts MCP JSON Schema tool parameters to TypeBox schemas, handles image responses (screenshots are displayed inline in the pi TUI), and cleans up the MCP connection on session shutdown.

## License

MIT
