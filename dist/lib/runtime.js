import { config } from "../config.js";
import os from "node:os";
export const instanceId = config.instanceId || os.hostname();
export const processStartMs = Date.now();
export const processStart = new Date(processStartMs);
