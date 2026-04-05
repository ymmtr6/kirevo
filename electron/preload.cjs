const { contextBridge } = require("electron");

contextBridge.exposeInMainWorld("kirevoDesktop", {
  platform: process.platform,
  runtime: "electron"
});
