import { app, BrowserWindow, shell } from "electron";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

let mainWindow = null;
let localServer = null;

async function createWindow() {
  if (!localServer) {
    const { startAppServer } = await import("../src/app-server.mjs");
    localServer = await startAppServer({ port: 0, host: "127.0.0.1", quiet: true });
  }

  mainWindow = new BrowserWindow({
    width: 1440,
    height: 960,
    minWidth: 1080,
    minHeight: 720,
    backgroundColor: "#f4efe7",
    title: "Kirevo",
    webPreferences: {
      preload: path.join(__dirname, "preload.cjs"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true
    }
  });

  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    shell.openExternal(url);
    return { action: "deny" };
  });

  await mainWindow.loadURL(localServer.url);

  mainWindow.on("closed", () => {
    mainWindow = null;
  });
}

app.whenReady()
  .then(async () => {
    process.env.KIREVO_DATA_DIR = path.join(app.getPath("userData"), "data");
    await createWindow();

    app.on("activate", async () => {
      if (BrowserWindow.getAllWindows().length === 0) {
        await createWindow();
      }
    });
  })
  .catch(async (error) => {
    console.error("Failed to start Kirevo desktop", error);
    if (localServer) {
      await localServer.close();
      localServer = null;
    }
    app.quit();
  });

app.on("window-all-closed", async () => {
  if (process.platform !== "darwin") {
    if (localServer) {
      await localServer.close();
      localServer = null;
    }
    app.quit();
  }
});

app.on("before-quit", async () => {
  if (localServer) {
    await localServer.close();
    localServer = null;
  }
});
