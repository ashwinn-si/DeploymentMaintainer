export function serializeServer(server, status) {
  return {
    id: server._id.toString(),
    name: server.name,
    url: server.url,
    serverId: server.serverId,
    version: status?.version ?? server.version ?? null,
    hostname: status?.hostname ?? server.hostname ?? null,
    status: status?.status ?? server.lastStatus ?? 'offline',
    lastSeenAt: status?.lastSeenAt ?? server.lastSeenAt ?? null,
    createdAt: server.createdAt,
  };
}
