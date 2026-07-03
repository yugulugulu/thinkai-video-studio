import dotenv from "dotenv";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const serverRoot = path.resolve(__dirname, "..");
const mode = process.env.NODE_ENV === "production" ? "production" : "development";
const envPath = path.join(serverRoot, `.env.${mode}`);

dotenv.config({ path: envPath });

export function envString(name, fallback = "") {
  const value = process.env[name];
  return typeof value === "string" && value.trim() ? value.trim() : fallback;
}

export function envNumber(name, fallback) {
  const value = process.env[name];
  if (typeof value !== "string" || !value.trim()) return fallback;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}
