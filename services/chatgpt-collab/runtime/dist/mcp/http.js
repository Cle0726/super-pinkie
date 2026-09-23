import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
/**
 * Stateless Streamable HTTP handler: a fresh McpServer + transport per POST.
 * This maximizes compatibility with remote MCP clients (including ChatGPT)
 * and avoids cross-request session state on a public endpoint.
 */
export function createMcpHttpHandler(makeServer, logger) {
    return async (req, res) => {
        if (req.method === "GET" || req.method === "DELETE") {
            // Stateless mode: no server-initiated streams, no sessions to delete.
            res.status(405).json({
                jsonrpc: "2.0",
                error: { code: -32000, message: "Method not allowed. Use POST." },
                id: null,
            });
            return;
        }
        const server = makeServer();
        const transport = new StreamableHTTPServerTransport({
            sessionIdGenerator: undefined,
            enableJsonResponse: true,
        });
        res.on("close", () => {
            void transport.close();
            void server.close();
        });
        try {
            await server.connect(transport);
            await transport.handleRequest(req, res, req.body);
        }
        catch (error) {
            logger.error("MCP request handling failed", { message: error.message });
            if (!res.headersSent) {
                res.status(500).json({
                    jsonrpc: "2.0",
                    error: { code: -32603, message: "Internal server error" },
                    id: null,
                });
            }
        }
    };
}
//# sourceMappingURL=http.js.map