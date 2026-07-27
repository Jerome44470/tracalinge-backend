// Diffuse les événements à tous les postes connectés en même temps (quai, PDA mobiles,
// terminaux de livraison, back-office) pour que chacun voie l'état à jour sans recharger.
let io = null;

export function initRealtime(server, corsOrigins) {
  // import dynamique pour garder ce fichier lisible sans alourdir le point d'entrée
  return import("socket.io").then(({ Server }) => {
    io = new Server(server, { cors: { origin: corsOrigins } });

    io.on("connection", (socket) => {
      // Le client précise à qui il appartient : le personnel rejoint "staff",
      // un client rejoint sa propre room privée pour ne recevoir que ses données.
      socket.on("join", ({ role, clientId }) => {
        if (role === "staff") socket.join("staff");
        if (role === "client" && clientId) socket.join(`client:${clientId}`);
      });
    });

    return io;
  });
}

export function broadcastStaff(event, payload) {
  if (io) io.to("staff").emit(event, payload);
}

export function broadcastClient(clientId, event, payload) {
  if (io) io.to(`client:${clientId}`).emit(event, payload);
}
