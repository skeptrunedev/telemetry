import { useState } from "react";
import { Copy, Check } from "lucide-react";

const MCP_URL = `${typeof location !== "undefined" ? location.origin : "https://skcal.skeptrune.com"}/mcp`;

function CopyField({ value }: { value: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <div className="mcp-copy">
      <code>{value}</code>
      <button
        className="nav-icon-btn"
        aria-label="Copy to clipboard"
        onClick={async () => {
          try {
            await navigator.clipboard.writeText(value);
            setCopied(true);
            setTimeout(() => setCopied(false), 1200);
          } catch {
            /* clipboard blocked — user can select manually */
          }
        }}
      >
        {copied ? <Check /> : <Copy />}
      </button>
    </div>
  );
}

// Install instructions for connecting the skcal MCP server to popular clients.
export function McpInstall({ onClose }: { onClose: () => void }) {
  return (
    <div className="sheet-backdrop" onClick={onClose}>
      <div className="sheet mcp-sheet" onClick={(e) => e.stopPropagation()}>
        <h2 className="mcp-title">Install the skcal MCP</h2>
        <p className="meta">
          Connect skcal to an AI client so it can log and query your data. You'll sign in once in the
          browser to authorize — no token to copy.
        </p>

        <div className="mcp-client">
          <h3>Claude Code</h3>
          <p className="meta">Run this in your terminal:</p>
          <CopyField value={`claude mcp add --transport http skcal ${MCP_URL}`} />
        </div>

        <div className="mcp-client">
          <h3>Claude (desktop &amp; claude.ai)</h3>
          <p className="meta">Settings → Connectors → Add custom connector, then paste the URL:</p>
          <CopyField value={MCP_URL} />
        </div>

        <div className="mcp-client">
          <h3>ChatGPT</h3>
          <p className="meta">Settings → Connectors (enable Developer mode) → Add, then paste the URL:</p>
          <CopyField value={MCP_URL} />
        </div>

        <div className="sheet-actions">
          <button className="btn ghost" onClick={onClose}>
            Done
          </button>
        </div>
      </div>
    </div>
  );
}
