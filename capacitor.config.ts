import type { CapacitorConfig } from "@capacitor/cli";

const config: CapacitorConfig = {
  appId: "com.rayyanai.app",
  appName: "Rayyan AI",
  webDir: "dist",
  // Use http scheme so the WebView origin is http://localhost — this makes
  // fetches to http://127.0.0.1:8080 same-scheme (no mixed-content block).
  // With https scheme, the WebView would block http://127.0.0.1 calls.
  server: {
    androidScheme: "http",
    cleartext: true,
  },
  android: {
    allowMixedContent: true,
    // Allow the WebView to load over HTTP and make HTTP requests.
    captureInput: true,
  },
};

export default config;
