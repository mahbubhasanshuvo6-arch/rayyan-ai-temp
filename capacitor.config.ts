import type { CapacitorConfig } from "@capacitor/cli";

const config: CapacitorConfig = {
  appId: "com.rayyanai.app",
  appName: "Rayyan",
  webDir: "dist",
  android: {
    captureInput: false,
  },
};

export default config;
