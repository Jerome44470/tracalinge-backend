import "dotenv/config";
import express from "express";
import cors from "cors";
import { createServer } from "node:http";
import { db } from "./db.js";
import { initRealtime } from "./realtime.js";
import { authRouter } from "./routes/auth.js";
import { clientsRouter } from "./routes/clients.js";
import { scanRouter } from "./routes/scan.js";
import { deliveryNotesRouter } from "./routes/deliveryNotes.js";
import { invoicesRouter } from "./routes/invoices.js";
import { itemsRouter, settingsRouter, portalRouter } from "./routes/misc.js";
import { linenTypesRouter } from "./routes/linenTypes.js";
import { clientCategoriesRouter } from "./routes/clientCategories.js";
import { paymentMethodsRouter } from "./routes/paymentMethods.js";
import { prospectsPublicRouter, prospectsStaffRouter } from "./routes/prospects.js";

const app = express();
const corsOrigins = (process.env.CORS_ORIGINS || "").split(",").map((s) => s.trim()).filter(Boolean);

app.use(cors({ origin: corsOrigins.length ? corsOrigins : "*" }));
app.use(express.json());

app.get("/api/health", (req, res) => res.json({ ok: true, time: Date.now() }));

app.use("/api/auth", authRouter);
app.use("/api/clients", clientsRouter);
app.use("/api/scan", scanRouter);
app.use("/api/delivery-notes", deliveryNotesRouter);
app.use("/api/invoices", invoicesRouter);
app.use("/api/items", itemsRouter);
app.use("/api/linen-types", linenTypesRouter);
app.use("/api/settings", settingsRouter);
app.use("/api/portal", portalRouter);
app.use("/api/client-categories", clientCategoriesRouter);
app.use("/api/payment-methods", paymentMethodsRouter);
app.use("/api/prospects", prospectsPublicRouter);
app.use("/api/staff/prospects", prospectsStaffRouter);

app.use((err, req, res, next) => {
  console.error(err);
  res.status(500).json({ error: "Erreur serveur." });
});

const server = createServer(app);
const port = process.env.PORT || 4000;

initRealtime(server, corsOrigins.length ? corsOrigins : "*").then(() => {
  server.listen(port, () => {
    console.log(`Traçalinge API démarrée sur http://localhost:${port}`);
    console.log(`Base de données : ${process.env.DB_FILE || "./data/tracalinge.db"}`);
  });
});
