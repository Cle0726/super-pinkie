export const TUNNEL_PROTOCOLS = ["auto", "quic", "http2"];
export function resolveTunnelProtocol(env = process.env) {
    const raw = env.C2C_TUNNEL_PROTOCOL?.trim();
    if (!raw)
        return null;
    const value = raw.toLowerCase();
    if (TUNNEL_PROTOCOLS.includes(value))
        return value;
    throw new Error(`C2C_TUNNEL_PROTOCOL must be one of ${TUNNEL_PROTOCOLS.join(", ")}`);
}
export function tunnelProtocolArgs(protocol = resolveTunnelProtocol()) {
    return protocol ? ["--protocol", protocol] : [];
}
//# sourceMappingURL=protocol.js.map