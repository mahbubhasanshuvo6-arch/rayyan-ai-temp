import type { CapacitorConfig } from "@capacitor/cli";

const config: CapacitorConfig = {
  appId: "com.rayyanai.app",
  appName: "Rayyan AI",
  webDir: "dist",
  android: {
    captureInput: true,
  },
};

export default config;
