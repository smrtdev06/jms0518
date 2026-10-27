import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  serverExternalPackages: ["pg", "pdfkit", "pdfjs-dist", "puppeteer-core", "@sparticuz/chromium"],
  // Files the Resume Tailor reads at run time that no import points to. A serverless host (Vercel) ships only
  // what is listed or imported, so the fonts, default templates, prompts and serverless Chromium go with the API.
  outputFileTracingIncludes: {
    "/api/**/*": ["./fonts/**/*", "./templates/**/*", "./prompts/**/*", "./node_modules/@sparticuz/chromium/bin/**/*"],
  },
};

export default nextConfig;
