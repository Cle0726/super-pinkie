/**
 * Bearer-token guard for /mcp.
 * - missing/invalid/expired token  -> 401 (+ WWW-Authenticate with resource metadata)
 * - valid token for another workspace -> 403
 */
export function bearerAuth(deps) {
    return (req, res, next) => {
        const challenge = (error, description) => `Bearer realm="c2c", error="${error}", error_description="${description}", ` +
            `resource_metadata="${deps.getBaseUrl(req)}/.well-known/oauth-protected-resource/mcp"`;
        const header = req.headers.authorization;
        if (!header || !header.toLowerCase().startsWith("bearer ")) {
            res
                .status(401)
                .set("WWW-Authenticate", challenge("invalid_token", "Missing bearer token"))
                .json({ error: "unauthorized", error_description: "Authentication required" });
            return;
        }
        const token = header.slice(7).trim();
        const verdict = deps.store.verifyAccessToken(token);
        if (!verdict.ok) {
            deps.logger.warn(`Rejected MCP request: token ${verdict.reason}`);
            res
                .status(401)
                .set("WWW-Authenticate", challenge("invalid_token", `Token ${verdict.reason}`))
                .json({ error: "unauthorized", error_description: `Token ${verdict.reason}` });
            return;
        }
        if (verdict.record.workspaceId !== deps.workspaceId) {
            deps.logger.warn("Rejected MCP request: token bound to a different workspace");
            res.status(403).json({
                error: "forbidden",
                error_description: "This token is not authorized for the connected workspace",
            });
            return;
        }
        const authInfo = {
            token,
            clientId: verdict.record.clientId,
            scopes: verdict.record.scopes,
            expiresAt: Math.floor(verdict.record.expiresAt / 1000),
        };
        req.auth = authInfo;
        next();
    };
}
//# sourceMappingURL=middleware.js.map