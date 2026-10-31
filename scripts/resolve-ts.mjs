// Test-only: lets plain Node load the plugin's extensionless relative imports (as the bundler does).
import { register } from "node:module";
register("./resolve-ts-hook.mjs", import.meta.url);
