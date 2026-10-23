import express from "express";
import { createOutdoorRouter } from "./routes";

const app = express();
const allowedOrigins = new Set((process.env.FRONTEND_ORIGINS || "").split(",").map(value => value.trim()).filter(Boolean));
app.use((req, res, next) => {
  const origin = req.header("origin");
  if (origin && allowedOrigins.has(origin)) {
    res.setHeader("Access-Control-Allow-Origin", origin);
    res.setHeader("Vary", "Origin");
    res.setHeader("Access-Control-Allow-Methods", "GET,POST,OPTIONS");
    res.setHeader("Access-Control-Allow-Headers", "Content-Type,Authorization");
  }
  if (req.method === "OPTIONS") return res.sendStatus(origin && allowedOrigins.has(origin) ? 204 : 403);
  return next();
});
app.use(express.json({ limit: "1mb" }));
app.use(createOutdoorRouter());
const port = Number(process.env.OUTDOORIQ_API_PORT || 3001);
if (!Number.isInteger(port) || port < 1024 || port > 65535) throw new Error("OUTDOORIQ_API_PORT must be a port between 1024 and 65535.");
app.listen(port, "0.0.0.0", () => console.log(`OutdoorIQ API listening on port ${port}`));
