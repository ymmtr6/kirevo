import { startAppServer } from "./app-server.mjs";

const PORT = Number(process.env.PORT || 4312);
const HOST = process.env.HOST || "127.0.0.1";

const app = await startAppServer({ port: PORT, host: HOST });

for (const signal of ["SIGINT", "SIGTERM"]) {
  process.on(signal, async () => {
    await app.close();
    process.exit(0);
  });
}
